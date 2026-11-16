import asyncio
import re
import shutil
import time
import logging
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import List, Dict, Any, Optional, Tuple
import fitz  # PyMuPDF
import pymupdf
from openai import AsyncOpenAI
from pydantic import BaseModel
import base64
from google import genai
from google.genai import types
from app.core.config import settings

log = logging.getLogger("jurion.parser")

# PyMuPDF is not thread-safe and untrusted PDFs can hang or crash it, so reading runs in worker processes:
# uploads don't block each other, a crash can't take the API down, and a stuck read is killed after PARSE_TIMEOUT_S.
# ponytail: one pool per API process; move to a job queue (Celery/arq) when parsing should outlive the HTTP request
_pool: Optional[ProcessPoolExecutor] = None


async def run_pdf(fn, *args):
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(settings.PARSE_WORKERS, mp_context=multiprocessing.get_context("spawn"))
    try:
        return await asyncio.wait_for(asyncio.get_running_loop().run_in_executor(_pool, fn, *args), settings.PARSE_TIMEOUT_S)
    except (asyncio.TimeoutError, BrokenProcessPool) as e:
        pool, _pool = _pool, None  # drop the pool; the next call starts fresh workers
        for p in list(getattr(pool, "_processes", {}).values()):  # ponytail: private attr, the only way to kill a stuck worker
            p.terminate()
        pool.shutdown(wait=False, cancel_futures=True)
        log.warning("PDF worker %s", type(e).__name__)
        raise ValueError(
            f"Reading the PDF took longer than {settings.PARSE_TIMEOUT_S}s" if isinstance(e, asyncio.TimeoutError)
            else "The PDF reader crashed on this file"
        ) from e


def _open(pdf_bytes: bytes):
    """Opens a PDF, refusing encrypted files and very long ones."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if doc.needs_pass:
        raise ValueError("PDF is password-protected")
    if len(doc) > settings.MAX_PAGES:
        raise ValueError(f"PDF has {len(doc)} pages; the limit is {settings.MAX_PAGES}")
    return doc


def clause_boxes(pdf_bytes: bytes, spans: List[Tuple[int, float, float, float]]) -> List[Dict[str, float]]:
    """One highlight rectangle per page for a clause. `spans` is (page, left, top, bottom) from the stored lines, which keep no
    right edge, so it is found here as the right-most word inside that band. PDF points, origin top-left, like the stored lines."""
    doc = _open(pdf_bytes)
    out = []
    for page_no, left, top, bottom in spans:
        page = doc[page_no - 1]
        words = [w for w in page.get_text("words") if w[1] >= top - 1 and w[3] <= bottom + 1 and w[0] >= left - 2]
        # ponytail: on a two-column page the band can include the other column's words; per-line boxes would fix that
        right = max((w[2] for w in words), default=page.rect.x1 - 36)
        out.append({"page": page_no, "x0": left, "y0": top, "x1": right, "y1": bottom, "w": page.rect.width, "h": page.rect.height})
    return out


def count_pages(pdf_bytes: bytes) -> int:
    """Opens the PDF once to validate it; raises on corrupt, encrypted or too long files."""
    return len(_open(pdf_bytes))

# ---------------------------------------------------------
# 1. Local Fast-Path Heuristic Engine (< 50ms)
# ---------------------------------------------------------
FAST_HEADER_PATTERN = re.compile(
    r"^(?P<id>(?:ARTICLE|SECTION|CLAUSE|SCHEDULE|EXHIBIT|(?-i:ATTACHMENT|APPENDIX|ANNEX))\s+[IVXLCDM\d]+\b(?:\.\d+)*|\d{1,3}(?:\.\d{1,3})+|\d{1,3}\.)\s*[:\-\.]?\s*(?P<title>.*)$",
    re.IGNORECASE,
)
# Looser heading styles, tried ONLY when the normal rules find no structure at all (so no contract that parses today can change):
# "1) Duties of the Provider" (a closing parenthesis), and bold run-in headings with no number ("MEMBERSHIP. The person named...").
PAREN_HEADING = re.compile(r"^(?P<id>\d{1,3})\)\s+(?P<title>[A-Z][^.]{2,70})$")
RUN_IN_HEADING = re.compile(r"^(?P<title>[A-Z][A-Z0-9 ,&/'’-]{3,60})[.:]\s")
# Starts an attachment: the end of the signature block, and a fresh numbering scope ("1." restarts inside it).
ATTACHMENT_PATTERN = re.compile(r"(?:ATTACHMENT|APPENDIX|ANNEX|SCHEDULE|EXHIBIT)\s+[IVXLCDM\d]+\b")  # capitals only: "see Attachment 1." is body text
PAGE_NUMBER_PATTERN = re.compile(r"^(?:page\s+)?\d{1,3}(?:(?:\s+of\s+|\s*/\s*)\d{1,3})?$", re.IGNORECASE)
# "a.", "(b)", "iv." at the start of a line: an enumerated sub-item that deserves its own line.
LIST_ITEM_PATTERN = re.compile(r"^(?:[a-z]|[ivx]{1,4})[.)](?:\s|$)|^\((?:[a-z]|[ivx]{1,4})\)(?:\s|$)", re.IGNORECASE)


def _strip_page_noise(lines_meta: List[Dict[str, Any]], page_count: int) -> List[Dict[str, Any]]:
    """Drops page numbers and running headers/footers, but only from the top/bottom page margins,
    so a body line that happens to repeat across pages is never removed."""
    pages_per_text: Dict[str, set] = {}
    for l in lines_meta:
        if l["in_margin"]:
            pages_per_text.setdefault(l["text"], set()).add(l["page_number"])
    repeat_threshold = max(3, page_count // 2)

    def is_noise(l: Dict[str, Any]) -> bool:
        # A bare "11" on page 11 is a page number even when a signature block pushed it out of the margin.
        if l["text"] == str(l["page_number"]):
            return True
        return l["in_margin"] and (
            bool(PAGE_NUMBER_PATTERN.match(l["text"]))
            or len(pages_per_text[l["text"]]) >= repeat_threshold
        )

    return [l for l in lines_meta if not is_noise(l)]


MAX_PDF_BYTES = 25 * 1024 * 1024
LLM_TIMEOUT_S = 60  # one attempt, no retries: a hung or failing LLM call must not block the upload
MIN_CONFIDENCE = 0.6  # below this the local parse is distrusted and Gemini is tried (if a key is set)


def _numbering_score(ids: List[str]) -> float:
    """Share of expected clause numbers actually found: ids 1,2,4 under one parent span 4 and find 3.
    Only plain numeric ids ("10", "10.2") are judged; keyword ids (ARTICLE I) are ignored."""
    groups: Dict[str, set] = {}
    for clause_id in ids:
        m = re.fullmatch(r"(?:(\d+(?:\.\d+)*)\.)?(\d+)", clause_id)
        if m:
            groups.setdefault(m.group(1) or "", set()).add(int(m.group(2)))
    # A stray number far above the rest ("22314", a zip code) must not stretch the expected range to thousands.
    groups = {k: kept for k, g in groups.items() if (kept := {v for v in g if v <= 5 * len(g) + 20})}
    expected = sum(max(g) - min(g) + 1 for g in groups.values())  # gaps only; an excerpt may not start at 1
    return sum(len(g) for g in groups.values()) / expected if expected >= 3 else 1.0


def _ocr_note(conf: Dict[str, Any], lines: List[Dict[str, Any]]) -> Dict[str, Any]:
    """OCR text can be wrong in small ways: say so beside the result."""
    n = len({l["page_number"] for l in lines if l.get("ocr")})
    if n:
        conf["issues"] = [*conf.get("issues", []), f"{n} page{'s' if n > 1 else ''} had no text layer and {'were' if n > 1 else 'was'} read by OCR, so the text may contain recognition errors. Check it against the PDF."]
    return conf


def _confidence(clauses: List[Dict[str, Any]], line_chars: int, pages: int = 1) -> Dict[str, Any]:
    """0-1 scores for whether the local parse kept the text and found the structure.
    coverage: clause text vs. text on the pages; numbering: gaps in 1,2,3...; titled: headings with a real title;
    unique: clause numbers used once; balanced: no one clause hoards the text (a missed heading swallows the rest).
    `issues` are plain-language warnings for the UI."""
    coverage = min(1.0, sum(len(c["content"]) for c in clauses) / max(line_chars, 1))
    numbering = _numbering_score([c["clause_identifier"] for c in clauses])
    titled = 1 - sum(c["title"].startswith("Section ") for c in clauses) / len(clauses)

    first: Dict[str, Dict[str, Any]] = {}
    repeats, issues = 0, []
    for c in clauses:
        if ATTACHMENT_PATTERN.match(c["clause_identifier"]):
            first.clear()  # numbering restarts inside an attachment
        prev = first.setdefault(c["clause_identifier"], c)
        if prev is not c:
            repeats += 1
            if "." not in c["clause_identifier"] and len(issues) < 3:
                issues.append(
                    f"Number {c['clause_identifier']} is used twice: \u201c{prev['title']}\u201d (p.{prev['page_number']}) "
                    f"and \u201c{c['title']}\u201d (p.{c['page_number']}). The contract reuses it."
                )
    unique = 1 - repeats / len(clauses)

    total = max(sum(len(c["content"]) for c in clauses), 1)
    big = max(clauses, key=lambda c: len(c["content"]))
    share = len(big["content"]) / total
    balanced = 1.0 if pages < 4 or share <= 0.4 else round(0.4 / share, 2)  # short documents may be one big clause
    if balanced < 1:
        issues.append(
            f"One section holds {share:.0%} of the text: \u201c{big['title']}\u201d (p.{big['page_number']}). "
            "A heading was probably missed, so the clauses after it are merged into it."
        )

    return {
        "score": round(coverage * numbering * titled * unique * balanced, 2),
        "balanced": balanced,
        "coverage": round(coverage, 2),
        "numbering": round(numbering, 2),
        "titled": round(titled, 2),
        "unique": round(unique, 2),
        "issues": issues,
    }


def _layout(lines: List[Dict[str, Any]], pitch: float) -> str:
    """Rebuilds a block as a character grid: x0 -> column, vertical gaps -> blank lines.
    Meant for a monospace <pre>; used for signature blocks where position carries meaning."""
    left = min(l["x0"] for l in lines)
    char_w = max(l["font_size"] for l in lines) * 0.5  # ponytail: assumes ~0.5em average glyph width
    rows: List[List[Dict[str, Any]]] = []
    for l in lines:
        if rows and rows[-1][0]["page_number"] == l["page_number"] and abs(rows[-1][0]["y0"] - l["y0"]) < 3:
            rows[-1].append(l)
        else:
            rows.append([l])
    out: List[str] = []
    prev = None
    for row in rows:
        if prev:
            same_page = prev[0]["page_number"] == row[0]["page_number"]
            steps = round((row[0]["y0"] - prev[0]["y0"]) / pitch)  # 1 = next line; 2+ = blank lines between
            out.extend([""] * (min(3, steps - 1) if same_page else 1))
        text = ""
        for c in sorted(row, key=lambda c: c["x0"]):
            text += " " * max(1 if text else 0, round((c["x0"] - left) / char_w) - len(text)) + c["text"]
        out.append(text)
        prev = row
    return "\n".join(out)


def _reflow(lines: List[Dict[str, Any]], pitch: float) -> str:
    """Joins PDF visual lines into paragraphs. A paragraph break is a vertical gap bigger than
    the document's normal line pitch (so double-spaced contracts don't break on every line); block boundaries are ignored because hanging-indent numbering
    ("2.6.   The Services…") splits one paragraph into several PyMuPDF blocks."""
    out = ""
    prev = None
    for l in lines:
        text = l["text"]
        if not out:
            out = text
        # ponytail: a paragraph that starts at the top of a new page gets joined to the previous one
        elif l.get("table") or prev.get("table"):
            out += "\n\n" + text
        elif LIST_ITEM_PATTERN.match(text):
            out += "\n" + text  # ponytail: an inline "(ii)" that wraps onto a new line is also split
        elif l["page_number"] == prev["page_number"] and l["y0"] - prev["y0"] > 1.5 * pitch:
            out += "\n\n" + text
        elif out.endswith("-") and text[:1].islower():
            out = out[:-1] + text  # mend "manu-\nfacture"
        else:
            out += " " + text
        prev = l
    return out.strip()


# A line that is only a clause or list marker: "1.", "2.1", "(a)", "b)"
MARKER_PATTERN = re.compile(r"^(?:\d{1,3}(?:\.\d{1,3})*\.?|\(?(?:[a-zA-Z]|[ivxIVX]{2,4})[.)])$")  # not "TERM." (a heading)


def _reorder_markers(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Some PDFs store the number column apart from its text, so the text stream reads "1.", "2.", "2.1" first and the
    titles later. Moves each such marker to just before the line on the same baseline to its right. A marker that is
    already followed by its text, the normal case, is untouched, so ordinary and two-column pages are not disturbed."""
    claimed: Dict[int, List[int]] = {}  # partner index -> its markers
    moved: set = set()
    for i, m in enumerate(lines):
        if not MARKER_PATTERN.match(m["text"]) or m.get("table"):
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        if nxt and abs(nxt["y0"] - m["y0"]) <= 3 and nxt["x0"] > m["x0"]:
            continue  # already next to its text
        partners = [
            j for j, l in enumerate(lines)
            if j != i and not l.get("table") and abs(l["y0"] - m["y0"]) <= 3 and l["x0"] > m["x0"] + 5 and not MARKER_PATTERN.match(l["text"])
        ]
        if partners:
            j = min(partners, key=lambda j: lines[j]["x0"])  # the nearest text to the right
            claimed.setdefault(j, []).append(i)
            moved.add(i)
    out: List[Dict[str, Any]] = []
    for j, l in enumerate(lines):
        if j in moved:
            continue
        out.extend(lines[i] for i in sorted(claimed.get(j, []), key=lambda i: lines[i]["x0"]))
        out.append(l)
    return out


def _clean_cell(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").replace("|", "/").strip()


def _usable(rows: List[List[str]]) -> bool:
    """A real table has at least two columns that actually hold text. A grid whose second column is empty is the
    detector joining everything into one column."""
    if len(rows) < 2:
        return False
    need = max(2, -(-len(rows) * 15 // 100))  # a column counts when it has text in 15% of the rows (at least 2)
    return sum(sum(bool(r[c]) for r in rows if c < len(r)) >= need for c in range(max(map(len, rows)))) >= 2


def _rows_from_words(page, bbox) -> Optional[List[List[str]]]:
    """Rebuilds a table from where its words sit, for tables with no ruled grid (only underlines), where the line-based
    detector gives one wide column. Rows are words on one baseline. A column gutter is a gap of 12pt+ that (almost) no
    row crosses; a row that does cross one (a footer, a title) is kept whole in the first cell instead of being torn
    apart. Page headers and footers in the margins are left out. Returns None if no two columns come out."""
    height = page.rect.height
    words = [w for w in page.get_text("words", clip=pymupdf.Rect(bbox)) if 0.12 * height < (w[1] + w[3]) / 2 < 0.88 * height]
    if len(words) < 4:
        return None
    hs = sorted(w[3] - w[1] for w in words)
    tol = hs[len(hs) // 2] * 0.5  # same row if the vertical centres are within half a line height
    words.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows: List[List[Any]] = []
    for w in words:
        cy = (w[1] + w[3]) / 2
        if rows and abs(cy - rows[-1][0]) <= tol:
            rows[-1][1].append(w)
        else:
            rows.append([cy, [w]])

    # coverage[x] = how many rows have a word over x; gutters are wide runs of (almost) zero coverage between text
    lo, hi = int(min(w[0] for w in words)), int(max(w[2] for w in words)) + 1
    cover = [0] * (hi - lo + 1)
    for _, ws in rows:
        for x in {x for w in ws for x in range(int(w[0]) - lo, int(w[2]) - lo + 1)}:
            cover[x] += 1
    limit = len(rows) // 10 or (1 if len(rows) >= 6 else 0)  # about one stray row in ten may cross a gutter
    gutters, start = [], None
    for x, c in enumerate(cover + [limit + 1]):
        if c <= limit and start is None:
            start = x
        elif c > limit and start is not None:
            if start > 0 and x < len(cover) and x - start >= 12:  # interior only, 12pt or wider
                gutters.append((start + lo, x + lo))
            start = None
    edges = [lo] + [e for g in gutters for e in g] + [hi]
    cols = [(edges[i], edges[i + 1]) for i in range(0, len(edges) - 1, 2)]
    if not 2 <= len(cols) <= 8:
        return None

    def col_of(x: float) -> int:
        return next((i for i, (a, b) in enumerate(cols) if a <= x <= b), len(cols) - 1)

    grid = []
    for _, ws in rows:
        ws = sorted(ws, key=lambda w: w[0])
        cells = [""] * len(cols)
        if any(g0 + 1 < w[2] and w[0] < g1 - 1 for w in ws for g0, g1 in gutters):  # crosses a gutter: keep the row whole
            cells[col_of(ws[0][0])] = " ".join(w[4] for w in ws)
        else:
            for w in ws:
                ci = col_of((w[0] + w[2]) / 2)
                cells[ci] = f"{cells[ci]} {w[4]}".strip()
        grid.append([_clean_cell(c) for c in cells])

    # a column with almost nothing in it (a stray page number) is folded into its neighbour
    need = max(2, -(-len(grid) * 15 // 100))
    for ci in range(len(cols) - 1, -1, -1):
        if len(cols) > 2 and sum(bool(r[ci]) for r in grid) < need:
            into = ci - 1 if ci else 1
            for r in grid:
                r[into] = " ".join(x for x in ((r[ci], r[into]) if ci < into else (r[into], r[ci])) if x)
                del r[ci]
            cols.pop(ci)
    return grid if _usable(grid) else None


def _table_rows(page, t) -> Optional[List[List[str]]]:
    """Cell text of a detected table, or None when it is not really a table (then its lines stay plain text)."""
    # cell text from the page words: Table.extract() drops the spaces in some PDFs
    rows = [[_clean_cell(page.get_text("text", clip=c, sort=True) if c else "") for c in r.cells] for r in t.rows]
    return rows if _usable(rows) else _rows_from_words(page, t.bbox)


Read = Tuple[List[Dict[str, Any]], float, float, int]  # lines, median font size, line pitch, page count


def _ocr_ready() -> bool:
    try:
        return bool(shutil.which("tesseract")) and bool(pymupdf.get_tessdata())
    except Exception:
        return False


def _scanned_pages(doc) -> set:
    """Pages that are only a picture (no text layer), when the document is mostly scans, few enough to OCR here, and Tesseract exists.
    A normal contract with one scanned signature page is left alone: OCR on a signature would only add noise."""
    blank = {i for i, p in enumerate(doc) if not p.get_text().strip() and p.get_images()}
    return blank if blank and len(blank) * 2 >= len(doc) and len(blank) <= settings.OCR_MAX_PAGES and _ocr_ready() else set()


def _read_lines(pdf_bytes: bytes) -> Optional[Read]:
    """Visual lines of the PDF (tables folded into single lines, page noise removed), or None if there is no text."""
    doc = _open(pdf_bytes)
    lines_meta = []
    scanned = _scanned_pages(doc)  # read by OCR, so a scan gets real line positions (and the clause highlight) like any other PDF

    for page_idx, page in enumerate(doc):
        if page_idx in scanned:
            page_dict = page.get_text("dict", textpage=page.get_textpage_ocr(language="eng", dpi=settings.OCR_DPI, full=True))
        else:
            page_dict = page.get_text("dict")
        # ponytail: ruled tables only (the default "lines" strategy); borderless tables stay as flowing text
        # ponytail: ruled or underlined tables only (the default "lines" strategy); a page with no lines at all is skipped
        found = [t for t in page.find_tables().tables if t.col_count >= 2 and t.row_count >= 2] if len(page.get_drawings()) >= 4 else []
        built = [(t, rows) for t in found if (rows := _table_rows(page, t))]
        tables = [t for t, _ in built]
        placed: set = set()

        def table_at(b):  # index of the table containing this line's centre
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            return next((i for i, t in enumerate(tables) if t.bbox[0] - 2 <= cx <= t.bbox[2] + 2 and t.bbox[1] - 2 <= cy <= t.bbox[3] + 2), None)

        def table_line(i):
            t, rows = built[i]
            md = "\n".join("| " + " | ".join(r) + " |" for r in rows if any(r))
            return {"text": md, "font_size": 0.0, "is_bold": False, "page_number": page_idx + 1, "x0": t.bbox[0],
                    "y0": t.bbox[1], "y1": t.bbox[3], "in_margin": False, "table": True}

        page_start = len(lines_meta)
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                ti = table_at(line["bbox"])
                if ti is not None:  # the table replaces its text lines, at the spot of the first one
                    if ti not in placed:
                        placed.add(ti)
                        lines_meta.append(table_line(ti))
                    continue
                # Word exports put zero-width spaces after clause numbers ("1.\u200b PURPOSE"); \s doesn't match them.
                line_text = re.sub(
                    r"[\s\u200b-\u200d\u2060\ufeff]+", " ", "".join([span["text"] for span in line.get("spans", [])])
                ).strip()
                if not line_text:
                    continue
                spans = line.get("spans", [])
                max_size = max([s["size"] for s in spans], default=10.0)
                is_bold = any(
                    [bool(s["flags"] & 2) or "bold" in s["font"].lower() for s in spans]
                )

                lines_meta.append(
                    {
                        "text": line_text,
                        "font_size": max_size,
                        "is_bold": is_bold,
                        "page_number": page_idx + 1,
                        "x0": line["bbox"][0],
                        "y0": line["bbox"][1],
                        "y1": line["bbox"][3],
                        # ponytail: fixed 12% margin bands; tune if headers/footers sit further in on some templates
                        "in_margin": line["bbox"][1] < page.rect.height * 0.12
                        or line["bbox"][3] > page.rect.height * 0.88,
                        **({"ocr": True} if page_idx in scanned else {}),
                    }
                )

        lines_meta[page_start:] = _reorder_markers(lines_meta[page_start:])

    lines_meta = _strip_page_noise(lines_meta, len(doc))
    if not lines_meta:
        return None

    # Calculate median body text size
    all_sizes = sorted([l["font_size"] for l in lines_meta if not l.get("table")])
    median_size = all_sizes[len(all_sizes) // 2]
    for l in lines_meta:
        if l.get("table"):
            l["font_size"] = median_size

    # Drop text far smaller than the body: e-signature stamps ("Date: 28/10/2026 15:36:23 IST"),
    # footnote markers, printer marks. These are overlays stored out of reading order.
    lines_meta = [l for l in lines_meta if l["font_size"] >= median_size * 0.6]

    # Typical baseline-to-baseline distance; a hanging-indent number shares its body's y, so only positive steps count.
    steps = sorted(
        b["y0"] - a["y0"]
        for a, b in zip(lines_meta, lines_meta[1:])
        if a["page_number"] == b["page_number"] and b["y0"] - a["y0"] > 1 and not (a.get("table") or b.get("table"))
    )
    line_pitch = steps[len(steps) // 2] if steps else median_size * 1.2

    return lines_meta, median_size, line_pitch, len(doc)


def stored_lines(read: Read) -> List[Dict[str, Any]]:
    """The document's full text in reading order, as saved to the database. Clauses point into it by line number,
    so re-splitting or fixing a clause never needs the PDF read again."""
    keys = {"text": "t", "page_number": "p", "x0": "x", "y0": "y", "y1": "y1", "font_size": "s", "is_bold": "b"}
    return [{**{short: l[k] for k, short in keys.items()}, **({"tb": True} if l.get("table") else {})} for l in read[0]]


def _local_with_fallbacks(read: Read) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """The normal rules; if they find no structure, the looser heading styles."""
    return _local_from_lines(read) or _local_from_lines(read, relaxed=True)


def local_fast_parse(pdf_bytes: bytes) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """Local heuristics only (regex + font size). Returns (clauses, confidence), or None if no structure was found."""
    read = _read_lines(pdf_bytes)
    return _local_with_fallbacks(read) if read else None


def _local_from_lines(read: Read, relaxed: bool = False) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    lines_meta, median_size, line_pitch, pages = read
    clauses: List[Dict[str, Any]] = []
    seen_ids: set = set()
    current_clause: Optional[Dict[str, Any]] = None
    body_accumulator: List[Dict[str, Any]] = []

    def flush() -> None:
        if not (current_clause and body_accumulator):
            return
        is_sig = current_clause["clause_identifier"] == "SIGNATURES"
        current_clause["content"] = _layout(body_accumulator, line_pitch) if is_sig else _reflow(body_accumulator, line_pitch)
        current_clause["end_line"] = current_clause["start_line"] + len(body_accumulator)  # body lines are contiguous
        if not current_clause["title"]:
            current_clause["title"] = f"Section {current_clause['clause_identifier']}"
        # Numbered headings ("1. SCOPE:") are kept even with no body: they anchor their sub-clauses.
        # The length guard only filters stray visual headers (logos, running titles).
        if current_clause.pop("numbered") or len(current_clause["content"]) > 30:
            clauses.append(current_clause)
            seen_ids.add(current_clause["clause_identifier"])

    for idx, line in enumerate(lines_meta):
        text = line["text"]
        if (
            current_clause and current_clause["clause_identifier"] == "SIGNATURES"
            and not (ATTACHMENT_PATTERN.match(text) and len(text.split()) < 10)
            and not (line["is_bold"] and not line.get("table") and len(text.split()) <= 10 and re.match(r"\d{1,3}\.\s+\S", text))
        ):
            # The signature block runs until an attachment starts, or until a bold numbered heading ("1. CONSTRUCTION") starts the terms:
            # some master agreements put the signature page first and the Terms and Conditions after it.
            body_accumulator.append(line)
            continue
        match = FAST_HEADER_PATTERN.match(text)
        if match and "[" in match.group("title") and not text[0].isdigit():
            match = None  # "Section 1.7 [Financial Disclosure], 1.8 …" is a cross-reference, not a heading
        loose = None  # (id, title) from a looser heading style, second pass only
        if relaxed and not match and not line.get("table"):
            if (pm := PAREN_HEADING.match(text)) and len(text.split()) <= 10:
                loose = (pm.group("id"), pm.group("title").strip().rstrip(":"))
            elif line["is_bold"] and (rm := RUN_IN_HEADING.match(text)):
                loose = (f"SEC_{rm.group('title')[:15].upper().replace(' ', '_')}", rm.group("title").strip().title())
        awaiting_title = bool(current_clause) and not current_clause["title"] and len(body_accumulator) == 1
        is_visual_header = not line.get("table") and not awaiting_title and (
            line["font_size"] > (median_size * 1.18) and len(text.split()) < 10
        )

        # "IN WITNESS WHEREOF" is often just the body of the last numbered clause ("16.8"), so it only starts
        # the block when the current clause already has a body; the signature-page markers always do.
        is_signature = (
            bool(current_clause) and current_clause["clause_identifier"] != "SIGNATURES"
            and (
                (text.upper().startswith("IN WITNESS WHEREOF") and len(body_accumulator) > 1)
                or (len(text.split()) <= 8 and re.match(r"\[?SIGNATURE PAGE|SIGNED (AT|ON|BY)\b", text, re.IGNORECASE) is not None)
            )  # short lines only: "signed by Investigator. The Institution shall…" is body text
        )

        if match or is_visual_header or is_signature or loose:
            flush()

            title = match.group("title").strip().rstrip(":") if match else (loose[1] if loose else text)
            clause_id = (
                match.group("id").rstrip(".").upper()
                if match
                else (loose[0] if loose else f"SEC_{text[:15].upper().replace(' ', '_')}")
            )
            if is_signature:
                # The execution block is not part of the last numbered clause.
                title, clause_id, match = "Signature Block", "SIGNATURES", True
            parent_id = clause_id.rsplit(".", 1)[0] if "." in clause_id else None

            current_clause = {
                "clause_identifier": clause_id,
                "title": title,  # empty when the number sits alone on its line; filled by the next line
                "page_number": line["page_number"],
                "parent_identifier": parent_id if parent_id in seen_ids else None,
                "start_line": idx,  # a clause is a range [start_line, end_line) over the document's stored lines
                "numbered": bool(match) or bool(loose and loose[0].isdigit()),
            }
            body_accumulator = [line]
        else:
            if current_clause:
                if not current_clause["title"]:
                    current_clause["title"] = text.rstrip(":")
                body_accumulator.append(line)
            else:
                current_clause = {
                    "clause_identifier": "PREAMBLE",
                    "title": "Preamble & Recitals",
                    "page_number": line["page_number"],
                    "parent_identifier": None,
                    "start_line": idx,
                    "numbered": False,
                }
                body_accumulator = [line]

    flush()

    # A healthy legal document has at least 3 distinct sections
    if len(clauses) < 3:
        return None
    return clauses, _ocr_note(_confidence(clauses, sum(len(l["text"]) for l in lines_meta), pages), lines_meta)


# ---------------------------------------------------------
# 2. LLM Fallback Engine (Gemini or OpenAI, ~1.5s - 2.5s)
# ---------------------------------------------------------
class ParsedClause(BaseModel):
    clause_identifier: str
    title: str
    content: str


class FallbackParseResponse(BaseModel):
    clauses: List[ParsedClause]


class Heading(BaseModel):
    line: int  # the candidate's number in the list we sent
    clause_identifier: str  # as printed: "1", "2.3", "ARTICLE IV", "ATTACHMENT 1"
    title: str


class HeadingList(BaseModel):
    headings: List[Heading]


HEADINGS_PROMPT = (
    "Below are candidate lines from a contract PDF, as `number|page|text`. Pick the ones that START a clause or section "
    "(numbered clauses, articles, attachments, signature page). Ignore sentences, list items like a) b), cross-references, "
    "party names and running headers. Return each pick's line number, its identifier exactly as printed "
    "(\"SIGNATURES\" for the signature block), and its title (the heading text, or the first words if it has none).\n\n"
)
FALLBACK_PROMPT = "Extract every distinct clause and section from this contract into structured JSON."
PROVIDERS = ("gemini", "openai")


async def _gemini_parse(pdf_bytes: bytes, api_key: str) -> FallbackParseResponse:
    response = await genai.Client(api_key=api_key).aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"), FALLBACK_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=FallbackParseResponse,
            temperature=0.0,
        ),
    )
    return FallbackParseResponse.model_validate_json(response.text)


async def _openai_parse(pdf_bytes: bytes, api_key: str) -> FallbackParseResponse:
    pdf_b64 = base64.b64encode(pdf_bytes).decode()
    response = await AsyncOpenAI(api_key=api_key).responses.parse(
        model=settings.OPENAI_MODEL,
        input=[{
            "role": "user",
            "content": [
                {"type": "input_file", "filename": "contract.pdf", "file_data": f"data:application/pdf;base64,{pdf_b64}"},
                {"type": "input_text", "text": FALLBACK_PROMPT},
            ],
        }],
        text_format=FallbackParseResponse,
    )
    return response.output_parsed


def _candidates(lines: List[Dict[str, Any]], median: float) -> List[int]:
    """Lines that could be headings: short, and bold / large / numbered / capitalised. Keeps the prompt small."""
    def maybe(l: Dict[str, Any]) -> bool:
        t = l["text"]
        if l.get("table") or len(t) > 120:
            return False
        return (
            l["is_bold"] or l["font_size"] > median * 1.1 or bool(FAST_HEADER_PATTERN.match(t))
            or bool(re.match(r"^\d+(\.\d+)*\.?\s", t)) or t.isupper()
        )
    return [i for i, l in enumerate(lines) if maybe(l)][:1500]


def _from_headings(read: Read, picks: Dict[int, Heading]) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """Builds clauses from the lines the LLM chose as headings. Text always comes from the PDF itself."""
    lines, _, pitch, pages = read
    starts = sorted(i for i in picks if 0 <= i < len(lines))
    if len(starts) < 3:
        return None
    clauses, seen = [], set()
    if starts[0] > 0:
        starts.insert(0, 0)  # text before the first heading
        picks[0] = Heading(line=0, clause_identifier="PREAMBLE", title="Preamble & Recitals")
    for n, i in enumerate(starts):
        body = lines[i : starts[n + 1] if n + 1 < len(starts) else len(lines)]
        h = picks[i]
        cid = h.clause_identifier.strip().rstrip(".").upper()
        sig = cid == "SIGNATURES"
        content = _layout(body, pitch) if sig else _reflow(body, pitch)
        if not content:
            continue
        parent = cid.rsplit(".", 1)[0] if "." in cid else None
        clauses.append({"clause_identifier": cid, "title": h.title.strip() or f"Section {cid}", "content": content,
                        "page_number": lines[i]["page_number"], "parent_identifier": parent if parent in seen else None,
                        "start_line": i, "end_line": i + len(body)})
        seen.add(cid)
    if len(clauses) < 3:
        return None
    return clauses, _ocr_note(_confidence(clauses, sum(len(l["text"]) for l in lines), pages), lines)


async def _llm_headings(read: Read, provider: str, api_key: str) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    lines, median, _, _ = read
    idx = _candidates(lines, median)
    listing = "\n".join(f"{n}|{lines[i]['page_number']}|{lines[i]['text'][:100]}" for n, i in enumerate(idx))
    prompt = HEADINGS_PROMPT + listing
    if provider == "openai":
        r = await AsyncOpenAI(api_key=api_key).responses.parse(
            model=settings.OPENAI_MODEL, input=prompt, text_format=HeadingList
        )
        out = r.output_parsed
    else:
        r = await genai.Client(api_key=api_key).aio.models.generate_content(
            model=settings.GEMINI_MODEL, contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=HeadingList, temperature=0.0),
        )
        out = HeadingList.model_validate_json(r.text)
    picks = {idx[h.line]: h for h in out.headings if 0 <= h.line < len(idx)}  # candidate number -> real line index
    return _from_headings(read, picks)


async def llm_fallback_parse(pdf_bytes: bytes, provider: str, api_key: str) -> List[Dict[str, Any]]:
    """Invoked only when local heuristic extraction fails. A new client per call: the key may be the caller's own."""
    parse = _openai_parse if provider == "openai" else _gemini_parse
    return [c.model_dump() for c in (await parse(pdf_bytes, api_key)).clauses]


# ---------------------------------------------------------
# 3. Main Hybrid Entrypoint
# ---------------------------------------------------------
class NoStructure(ValueError):
    """Neither the rules nor the AI found any sections: a letter, a power of attorney, a one-paragraph agreement."""


def _whole_document(read: Read) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """A document with no sections is kept as ONE clause (all its text, searchable and citable) rather than refused."""
    lines, _, pitch, pages = read
    clause = {"clause_identifier": "DOC", "title": lines[0]["text"].strip().title()[:80] or "Full document", "page_number": lines[0]["page_number"],
              "parent_identifier": None, "start_line": 0, "end_line": len(lines), "content": _reflow(lines, pitch)}
    conf = _confidence([clause], sum(len(l["text"]) for l in lines), pages)
    conf["score"] = min(conf["score"], 0.5)
    conf["issues"] = ["No sections were found, so the whole document is kept as one clause."]
    return [clause], conf


class NoApiKey(RuntimeError):
    """The LLM was needed (or asked for) but no key is configured."""


async def parse_contract_fast(
    pdf_bytes: bytes, provider: Optional[str] = None, api_key: Optional[str] = None, force_llm: bool = False
) -> Dict[str, Any]:
    """Returns clauses plus a per-step trace (status + ms) for the UI.
    provider/api_key are the caller's own LLM credentials; they override the server's .env keys.
    force_llm: the user asked for the AI result even though the local parse looks fine; it is used as is."""
    provider = provider if provider in PROVIDERS else "gemini"
    api_key = api_key or (settings.OPENAI_API_KEY if provider == "openai" else settings.GEMINI_API_KEY)
    loop = asyncio.get_running_loop()
    steps: List[Dict[str, Any]] = []

    # Step 1: read the PDF once, then the local heuristic parse
    t = time.perf_counter()
    read = await run_pdf(_read_lines, pdf_bytes)
    local = _local_with_fallbacks(read) if read else None
    local_ms = round((time.perf_counter() - t) * 1000, 1)

    confidence = local[1] if local else None
    if local and not force_llm and (confidence["score"] >= MIN_CONFIDENCE or not api_key):
        # Low confidence with no key still returns the local parse; the UI shows the score.
        steps.append({"name": "local", "status": "done", "ms": local_ms})
        steps.append({"name": "llm", "status": "skipped", "ms": 0, "provider": provider})
        return {"method": "local", "clauses": local[0], "confidence": confidence, "steps": steps}
    if not api_key:
        raise NoApiKey(f"No {provider} API key: add one in Settings or set it in the server .env")

    steps.append({"name": "local", "status": "insufficient", "ms": local_ms})

    # Step 2: one LLM attempt. With extractable text it only picks the headings (text stays from the PDF);
    # with no text at all (a scan) it reads the whole PDF.
    t = time.perf_counter()
    try:
        if read:
            picked = await asyncio.wait_for(_llm_headings(read, provider, api_key), LLM_TIMEOUT_S)
            if not picked:
                raise NoStructure("LLM found no structure")
            clauses, llm_conf = picked
        else:
            clauses, llm_conf = await asyncio.wait_for(llm_fallback_parse(pdf_bytes, provider, api_key), LLM_TIMEOUT_S), None
    except Exception as e:  # includes the timeout
        log.warning("LLM fallback failed (%s, %s)", provider, type(e).__name__)
        if not local:
            if isinstance(e, NoStructure) and read:
                steps.append({"name": "llm", "status": "insufficient", "ms": round((time.perf_counter() - t) * 1000, 1), "provider": provider})
                clauses, conf = _whole_document(read)
                return {"method": "local", "clauses": clauses, "confidence": conf, "steps": steps}
            raise
        # LLM unavailable: a low-confidence local parse beats an error.
        steps.append({"name": "llm", "status": "failed", "ms": round((time.perf_counter() - t) * 1000, 1), "provider": provider})
        return {"method": "local", "clauses": local[0], "confidence": confidence, "steps": steps}
    llm_ms = round((time.perf_counter() - t) * 1000, 1)
    if local and llm_conf and not force_llm and llm_conf["score"] <= confidence["score"]:  # the LLM did no better: keep the local result
        steps.append({"name": "llm", "status": "insufficient", "ms": llm_ms, "provider": provider})
        return {"method": "local", "clauses": local[0], "confidence": confidence, "steps": steps}
    steps.append({"name": "llm", "status": "done", "ms": llm_ms, "provider": provider})
    out = {"method": provider, "clauses": clauses, "confidence": llm_conf, "steps": steps}
    if local:
        out["local_result"] = {"clauses": local[0], "confidence": confidence}  # kept so the UI can compare the two
    return out
