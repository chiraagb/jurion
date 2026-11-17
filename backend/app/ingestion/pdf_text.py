"""Reading a PDF into visual lines: the worker pool that isolates PyMuPDF, text and table extraction, OCR for scanned pages,
page-noise removal, and turning lines back into paragraphs. parser.py decides where clauses start; this file only reads.
"""

import asyncio
import logging
import multiprocessing
import re
import shutil
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any, Dict, List, Optional, Tuple
import fitz  # PyMuPDF
import pymupdf
from app.core.config import settings

log = logging.getLogger("jurion.parser")

# PyMuPDF is not thread-safe and untrusted PDFs can hang or crash it, so reading runs in worker processes:
# uploads don't block each other, a crash can't take the API down, and a stuck read is killed after PARSE_TIMEOUT_S.
# ponytail: one pool per API process; move to a job queue (Celery/arq) when parsing should outlive the HTTP request
_pool: Optional[ProcessPoolExecutor] = None


async def run_pdf(fn, *args):
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(
            settings.PARSE_WORKERS, mp_context=multiprocessing.get_context("spawn")
        )
    try:
        return await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(_pool, fn, *args),
            settings.PARSE_TIMEOUT_S,
        )
    except (asyncio.TimeoutError, BrokenProcessPool) as e:
        pool, _pool = _pool, None  # drop the pool; the next call starts fresh workers
        for p in list(
            getattr(pool, "_processes", {}).values()
        ):  # ponytail: private attr, the only way to kill a stuck worker
            p.terminate()
        pool.shutdown(wait=False, cancel_futures=True)
        log.warning("PDF worker %s", type(e).__name__)
        raise ValueError(
            f"Reading the PDF took longer than {settings.PARSE_TIMEOUT_S}s"
            if isinstance(e, asyncio.TimeoutError)
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


def clause_boxes(
    pdf_bytes: bytes, spans: List[Tuple[int, float, float, float]]
) -> List[Dict[str, float]]:
    """One highlight rectangle per page for a clause. `spans` is (page, left, top, bottom) from the stored lines, which keep no
    right edge, so it is found here as the right-most word inside that band. PDF points, origin top-left, like the stored lines.
    """
    doc = _open(pdf_bytes)
    out = []
    for page_no, left, top, bottom in spans:
        page = doc[page_no - 1]
        words = [
            w
            for w in page.get_text("words")
            if w[1] >= top - 1 and w[3] <= bottom + 1 and w[0] >= left - 2
        ]
        # ponytail: on a two-column page the band can include the other column's words; per-line boxes would fix that
        right = max((w[2] for w in words), default=page.rect.x1 - 36)
        out.append(
            {
                "page": page_no,
                "x0": left,
                "y0": top,
                "x1": right,
                "y1": bottom,
                "w": page.rect.width,
                "h": page.rect.height,
            }
        )
    return out


def count_pages(pdf_bytes: bytes) -> int:
    """Opens the PDF once to validate it; raises on corrupt, encrypted or too long files."""
    return len(_open(pdf_bytes))


PAGE_NUMBER_PATTERN = re.compile(
    r"^(?:page\s+)?\d{1,3}(?:(?:\s+of\s+|\s*/\s*)\d{1,3})?$", re.IGNORECASE
)
# "a.", "(b)", "iv." at the start of a line: an enumerated sub-item that deserves its own line.
LIST_ITEM_PATTERN = re.compile(
    r"^(?:[a-z]|[ivx]{1,4})[.)](?:\s|$)|^\((?:[a-z]|[ivx]{1,4})\)(?:\s|$)",
    re.IGNORECASE,
)


def _strip_page_noise(
    lines_meta: List[Dict[str, Any]], page_count: int
) -> List[Dict[str, Any]]:
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


def layout(lines: List[Dict[str, Any]], pitch: float) -> str:
    """Rebuilds a block as a character grid: x0 -> column, vertical gaps -> blank lines.
    Meant for a monospace <pre>; used for signature blocks where position carries meaning.
    """
    left = min(l["x0"] for l in lines)
    char_w = (
        max(l["font_size"] for l in lines) * 0.5
    )  # ponytail: assumes ~0.5em average glyph width
    rows: List[List[Dict[str, Any]]] = []
    for l in lines:
        if (
            rows
            and rows[-1][0]["page_number"] == l["page_number"]
            and abs(rows[-1][0]["y0"] - l["y0"]) < 3
        ):
            rows[-1].append(l)
        else:
            rows.append([l])
    out: List[str] = []
    prev = None
    for row in rows:
        if prev:
            same_page = prev[0]["page_number"] == row[0]["page_number"]
            steps = round(
                (row[0]["y0"] - prev[0]["y0"]) / pitch
            )  # 1 = next line; 2+ = blank lines between
            out.extend([""] * (min(3, steps - 1) if same_page else 1))
        text = ""
        for c in sorted(row, key=lambda c: c["x0"]):
            text += (
                " "
                * max(1 if text else 0, round((c["x0"] - left) / char_w) - len(text))
                + c["text"]
            )
        out.append(text)
        prev = row
    return "\n".join(out)


def reflow(lines: List[Dict[str, Any]], pitch: float) -> str:
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
            out += (
                "\n" + text
            )  # ponytail: an inline "(ii)" that wraps onto a new line is also split
        elif (
            l["page_number"] == prev["page_number"]
            and l["y0"] - prev["y0"] > 1.5 * pitch
        ):
            out += "\n\n" + text
        elif out.endswith("-") and text[:1].islower():
            out = out[:-1] + text  # mend "manu-\nfacture"
        else:
            out += " " + text
        prev = l
    return out.strip()


# A line that is only a clause or list marker: "1.", "2.1", "(a)", "b)"
MARKER_PATTERN = re.compile(
    r"^(?:\d{1,3}(?:\.\d{1,3})*\.?|\(?(?:[a-zA-Z]|[ivxIVX]{2,4})[.)])$"
)  # not "TERM." (a heading)


def _reorder_markers(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Some PDFs store the number column apart from its text, so the text stream reads "1.", "2.", "2.1" first and the
    titles later. Moves each such marker to just before the line on the same baseline to its right. A marker that is
    already followed by its text, the normal case, is untouched, so ordinary and two-column pages are not disturbed.
    """
    claimed: Dict[int, List[int]] = {}  # partner index -> its markers
    moved: set = set()
    for i, m in enumerate(lines):
        if not MARKER_PATTERN.match(m["text"]) or m.get("table"):
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        if nxt and abs(nxt["y0"] - m["y0"]) <= 3 and nxt["x0"] > m["x0"]:
            continue  # already next to its text
        partners = [
            j
            for j, l in enumerate(lines)
            if j != i
            and not l.get("table")
            and abs(l["y0"] - m["y0"]) <= 3
            and l["x0"] > m["x0"] + 5
            and not MARKER_PATTERN.match(l["text"])
        ]
        if partners:
            j = min(
                partners, key=lambda j: lines[j]["x0"]
            )  # the nearest text to the right
            claimed.setdefault(j, []).append(i)
            moved.add(i)
    out: List[Dict[str, Any]] = []
    for j, l in enumerate(lines):
        if j in moved:
            continue
        out.extend(
            lines[i] for i in sorted(claimed.get(j, []), key=lambda i: lines[i]["x0"])
        )
        out.append(l)
    return out


def _clean_cell(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").replace("|", "/").strip()


def _usable(rows: List[List[str]]) -> bool:
    """A real table has at least two columns that actually hold text. A grid whose second column is empty is the
    detector joining everything into one column."""
    if len(rows) < 2:
        return False
    need = max(
        2, -(-len(rows) * 15 // 100)
    )  # a column counts when it has text in 15% of the rows (at least 2)
    return (
        sum(
            sum(bool(r[c]) for r in rows if c < len(r)) >= need
            for c in range(max(map(len, rows)))
        )
        >= 2
    )


def _rows_from_words(page, bbox) -> Optional[List[List[str]]]:
    """Rebuilds a table from where its words sit, for tables with no ruled grid (only underlines), where the line-based
    detector gives one wide column. Rows are words on one baseline. A column gutter is a gap of 12pt+ that (almost) no
    row crosses; a row that does cross one (a footer, a title) is kept whole in the first cell instead of being torn
    apart. Page headers and footers in the margins are left out. Returns None if no two columns come out.
    """
    height = page.rect.height
    words = [
        w
        for w in page.get_text("words", clip=pymupdf.Rect(bbox))
        if 0.12 * height < (w[1] + w[3]) / 2 < 0.88 * height
    ]
    if len(words) < 4:
        return None
    hs = sorted(w[3] - w[1] for w in words)
    tol = (
        hs[len(hs) // 2] * 0.5
    )  # same row if the vertical centres are within half a line height
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
    limit = len(rows) // 10 or (
        1 if len(rows) >= 6 else 0
    )  # about one stray row in ten may cross a gutter
    gutters, start = [], None
    for x, c in enumerate(cover + [limit + 1]):
        if c <= limit and start is None:
            start = x
        elif c > limit and start is not None:
            if (
                start > 0 and x < len(cover) and x - start >= 12
            ):  # interior only, 12pt or wider
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
        if any(
            g0 + 1 < w[2] and w[0] < g1 - 1 for w in ws for g0, g1 in gutters
        ):  # crosses a gutter: keep the row whole
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
                r[into] = " ".join(
                    x
                    for x in ((r[ci], r[into]) if ci < into else (r[into], r[ci]))
                    if x
                )
                del r[ci]
            cols.pop(ci)
    return grid if _usable(grid) else None


def _table_rows(page, t) -> Optional[List[List[str]]]:
    """Cell text of a detected table, or None when it is not really a table (then its lines stay plain text)."""
    # cell text from the page words: Table.extract() drops the spaces in some PDFs
    rows = [
        [
            _clean_cell(page.get_text("text", clip=c, sort=True) if c else "")
            for c in r.cells
        ]
        for r in t.rows
    ]
    return rows if _usable(rows) else _rows_from_words(page, t.bbox)


Read = Tuple[
    List[Dict[str, Any]], float, float, int
]  # lines, median font size, line pitch, page count


def _ocr_ready() -> bool:
    try:
        return bool(shutil.which("tesseract")) and bool(pymupdf.get_tessdata())
    except Exception:
        return False


def _scanned_pages(doc) -> set:
    """Pages that are only a picture (no text layer), when the document is mostly scans, few enough to OCR here, and Tesseract exists.
    A normal contract with one scanned signature page is left alone: OCR on a signature would only add noise.
    """
    blank = {
        i for i, p in enumerate(doc) if not p.get_text().strip() and p.get_images()
    }
    return (
        blank
        if blank
        and len(blank) * 2 >= len(doc)
        and len(blank) <= settings.OCR_MAX_PAGES
        and _ocr_ready()
        else set()
    )


def read_lines(pdf_bytes: bytes) -> Optional[Read]:
    """Visual lines of the PDF (tables folded into single lines, page noise removed), or None if there is no text."""
    doc = _open(pdf_bytes)
    lines_meta = []
    scanned = _scanned_pages(
        doc
    )  # read by OCR, so a scan gets real line positions (and the clause highlight) like any other PDF

    for page_idx, page in enumerate(doc):
        if page_idx in scanned:
            page_dict = page.get_text(
                "dict",
                textpage=page.get_textpage_ocr(
                    language="eng", dpi=settings.OCR_DPI, full=True
                ),
            )
        else:
            page_dict = page.get_text("dict")
        # ponytail: ruled tables only (the default "lines" strategy); borderless tables stay as flowing text
        # ponytail: ruled or underlined tables only (the default "lines" strategy); a page with no lines at all is skipped
        found = (
            [
                t
                for t in page.find_tables().tables
                if t.col_count >= 2 and t.row_count >= 2
            ]
            if len(page.get_drawings()) >= 4
            else []
        )
        built = [(t, rows) for t in found if (rows := _table_rows(page, t))]
        tables = [t for t, _ in built]
        placed: set = set()

        def table_at(b):  # index of the table containing this line's centre
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            return next(
                (
                    i
                    for i, t in enumerate(tables)
                    if t.bbox[0] - 2 <= cx <= t.bbox[2] + 2
                    and t.bbox[1] - 2 <= cy <= t.bbox[3] + 2
                ),
                None,
            )

        def table_line(i):
            t, rows = built[i]
            md = "\n".join("| " + " | ".join(r) + " |" for r in rows if any(r))
            return {
                "text": md,
                "font_size": 0.0,
                "is_bold": False,
                "page_number": page_idx + 1,
                "x0": t.bbox[0],
                "y0": t.bbox[1],
                "y1": t.bbox[3],
                "in_margin": False,
                "table": True,
            }

        page_start = len(lines_meta)
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                ti = table_at(line["bbox"])
                if (
                    ti is not None
                ):  # the table replaces its text lines, at the spot of the first one
                    if ti not in placed:
                        placed.add(ti)
                        lines_meta.append(table_line(ti))
                    continue
                # Word exports put zero-width spaces after clause numbers ("1.\u200b PURPOSE"); \s doesn't match them.
                line_text = re.sub(
                    r"[\s\u200b-\u200d\u2060\ufeff]+",
                    " ",
                    "".join([span["text"] for span in line.get("spans", [])]),
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
        if a["page_number"] == b["page_number"]
        and b["y0"] - a["y0"] > 1
        and not (a.get("table") or b.get("table"))
    )
    line_pitch = steps[len(steps) // 2] if steps else median_size * 1.2

    return lines_meta, median_size, line_pitch, len(doc)


def stored_lines(read: Read) -> List[Dict[str, Any]]:
    """The document's full text in reading order, as saved to the database. Clauses point into it by line number,
    so re-splitting or fixing a clause never needs the PDF read again."""
    keys = {
        "text": "t",
        "page_number": "p",
        "x0": "x",
        "y0": "y",
        "y1": "y1",
        "font_size": "s",
        "is_bold": "b",
    }
    return [
        {
            **{short: l[k] for k, short in keys.items()},
            **({"tb": True} if l.get("table") else {}),
        }
        for l in read[0]
    ]
