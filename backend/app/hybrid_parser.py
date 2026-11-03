import asyncio
import re
import time
import logging
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import List, Dict, Any, Optional, Tuple
import fitz  # PyMuPDF
from openai import AsyncOpenAI
from pydantic import BaseModel
import base64
from google import genai
from google.genai import types
from app.config import settings

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


Read = Tuple[List[Dict[str, Any]], float, float, int]  # lines, median font size, line pitch, page count


def _read_lines(pdf_bytes: bytes) -> Optional[Read]:
    """Visual lines of the PDF (tables folded into single lines, page noise removed), or None if there is no text."""
    doc = _open(pdf_bytes)
    lines_meta = []

    for page_idx, page in enumerate(doc):
        page_dict = page.get_text("dict")
        # ponytail: ruled tables only (the default "lines" strategy); borderless tables stay as flowing text
        tables = [t for t in page.find_tables().tables if t.col_count >= 2 and t.row_count >= 2] if len(page.get_drawings()) >= 4 else []  # a table needs 4+ ruled lines or cells
        placed: set = set()

        def table_at(b):  # index of the ruled table containing this line's centre
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            return next((i for i, t in enumerate(tables) if t.bbox[0] - 2 <= cx <= t.bbox[2] + 2 and t.bbox[1] - 2 <= cy <= t.bbox[3] + 2), None)

        def table_line(t):
            # cell text from the page words: Table.extract() drops the spaces in some PDFs
            cell = lambda c: re.sub(r"\s+", " ", page.get_text("text", clip=c, sort=True) if c else "").replace("|", "/").strip()
            rows = [[cell(c) for c in r.cells] for r in t.rows]
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
                        lines_meta.append(table_line(tables[ti]))
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


def local_fast_parse(pdf_bytes: bytes) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """Local heuristics only (regex + font size). Returns (clauses, confidence), or None if no structure was found."""
    read = _read_lines(pdf_bytes)
    return _local_from_lines(read) if read else None


def _local_from_lines(read: Read) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
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
        ):
            body_accumulator.append(line)  # the signature block runs until an attachment starts
            continue
        match = FAST_HEADER_PATTERN.match(text)
        if match and "[" in match.group("title") and not text[0].isdigit():
            match = None  # "Section 1.7 [Financial Disclosure], 1.8 …" is a cross-reference, not a heading
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

        if match or is_visual_header or is_signature:
            flush()

            title = match.group("title").strip().rstrip(":") if match else text
            clause_id = (
                match.group("id").rstrip(".").upper()
                if match
                else f"SEC_{text[:15].upper().replace(' ', '_')}"
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
                "numbered": bool(match),
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
    return clauses, _confidence(clauses, sum(len(l["text"]) for l in lines_meta), pages)


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
    return clauses, _confidence(clauses, sum(len(l["text"]) for l in lines), pages)


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
    local = _local_from_lines(read) if read else None
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
                raise ValueError("LLM found no structure")
            clauses, llm_conf = picked
        else:
            clauses, llm_conf = await asyncio.wait_for(llm_fallback_parse(pdf_bytes, provider, api_key), LLM_TIMEOUT_S), None
    except Exception as e:  # includes the timeout
        log.warning("LLM fallback failed (%s, %s)", provider, type(e).__name__)
        if not local:
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
