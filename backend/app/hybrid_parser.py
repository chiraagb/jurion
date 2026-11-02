import asyncio
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any, Optional, Tuple
import fitz  # PyMuPDF
from openai import AsyncOpenAI
from pydantic import BaseModel
import base64
from google import genai
from google.genai import types
from app.config import settings

# PyMuPDF is not thread-safe, so all local parsing goes through one worker thread.
# ponytail: single thread caps throughput; move to a process pool / Celery workers when uploads queue up
_pdf_executor = ThreadPoolExecutor(max_workers=1)


def count_pages(pdf_bytes: bytes) -> int:
    """Opens the PDF once to validate it; raises on corrupt or encrypted files."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if doc.needs_pass:
        raise ValueError("PDF is password-protected")
    return len(doc)

# ---------------------------------------------------------
# 1. Local Fast-Path Heuristic Engine (< 50ms)
# ---------------------------------------------------------
FAST_HEADER_PATTERN = re.compile(
    r"^(?P<id>(?:ARTICLE|SECTION|CLAUSE|SCHEDULE|EXHIBIT)\s+[IVXLCDM\d]+\b(?:\.\d+)*|\d+(?:\.\d+)+|\d+\.)\s*[:\-\.]?\s*(?P<title>.*)$",
    re.IGNORECASE,
)
PAGE_NUMBER_PATTERN = re.compile(r"^(?:page\s+)?\d{1,3}(?:\s+of\s+\d{1,3})?$", re.IGNORECASE)
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
    expected = sum(max(g) - min(g) + 1 for g in groups.values())  # gaps only; an excerpt may not start at 1
    return sum(len(g) for g in groups.values()) / expected if expected >= 3 else 1.0


def _confidence(clauses: List[Dict[str, Any]], line_chars: int) -> Dict[str, float]:
    """0-1 scores for whether the local parse kept the text and found the structure.
    coverage: clause text vs. text on the pages; numbering: gaps in 1,2,3…; titled: headings with a real title."""
    coverage = min(1.0, sum(len(c["content"]) for c in clauses) / max(line_chars, 1))
    numbering = _numbering_score([c["clause_identifier"] for c in clauses])
    titled = 1 - sum(c["title"].startswith("Section ") for c in clauses) / len(clauses)
    return {
        "score": round(coverage * numbering * titled, 2),
        "coverage": round(coverage, 2),
        "numbering": round(numbering, 2),
        "titled": round(titled, 2),
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


def local_fast_parse(pdf_bytes: bytes) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """
    Parses document locally in memory using PyMuPDF font sizes and regex.
    Returns (clauses, confidence), or None when no structure was found at all.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    lines_meta = []

    for page_idx, page in enumerate(doc):
        page_dict = page.get_text("dict")
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
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

    lines_meta = _strip_page_noise(lines_meta, len(doc))
    if not lines_meta:
        return None

    # Calculate median body text size
    all_sizes = sorted([l["font_size"] for l in lines_meta])
    median_size = all_sizes[len(all_sizes) // 2]

    # Drop text far smaller than the body: e-signature stamps ("Date: 28/10/2026 15:36:23 IST"),
    # footnote markers, printer marks. These are overlays stored out of reading order.
    lines_meta = [l for l in lines_meta if l["font_size"] >= median_size * 0.6]

    # Typical baseline-to-baseline distance; a hanging-indent number shares its body's y, so only positive steps count.
    steps = sorted(
        b["y0"] - a["y0"]
        for a, b in zip(lines_meta, lines_meta[1:])
        if a["page_number"] == b["page_number"] and b["y0"] - a["y0"] > 1
    )
    line_pitch = steps[len(steps) // 2] if steps else median_size * 1.2

    clauses: List[Dict[str, Any]] = []
    seen_ids: set = set()
    current_clause: Optional[Dict[str, Any]] = None
    body_accumulator: List[Dict[str, Any]] = []

    def flush() -> None:
        if not (current_clause and body_accumulator):
            return
        is_sig = current_clause["clause_identifier"] == "SIGNATURES"
        current_clause["content"] = _layout(body_accumulator, line_pitch) if is_sig else _reflow(body_accumulator, line_pitch)
        if not current_clause["title"]:
            current_clause["title"] = f"Section {current_clause['clause_identifier']}"
        # Numbered headings ("1. SCOPE:") are kept even with no body: they anchor their sub-clauses.
        # The length guard only filters stray visual headers (logos, running titles).
        if current_clause.pop("numbered") or len(current_clause["content"]) > 30:
            clauses.append(current_clause)
            seen_ids.add(current_clause["clause_identifier"])

    for line in lines_meta:
        text = line["text"]
        match = FAST_HEADER_PATTERN.match(text)
        is_visual_header = (
            line["font_size"] > (median_size * 1.18) and len(text.split()) < 10
        )

        # "IN WITNESS WHEREOF" is often just the body of the last numbered clause ("16.8"), so it only starts
        # the block when the current clause already has a body; the signature-page markers always do.
        is_signature = (
            bool(current_clause) and current_clause["clause_identifier"] != "SIGNATURES"
            and (
                (text.upper().startswith("IN WITNESS WHEREOF") and len(body_accumulator) > 1)
                or re.match(r"\[?SIGNATURE PAGE|SIGNED (AT|ON|BY)\b", text, re.IGNORECASE) is not None
            )
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
                    "numbered": False,
                }
                body_accumulator = [line]

    flush()

    # A healthy legal document has at least 3 distinct sections
    if len(clauses) < 3:
        return None
    return clauses, _confidence(clauses, sum(len(l["text"]) for l in lines_meta))


# ---------------------------------------------------------
# 2. LLM Fallback Engine (Gemini or OpenAI, ~1.5s - 2.5s)
# ---------------------------------------------------------
class ParsedClause(BaseModel):
    clause_identifier: str
    title: str
    content: str


class FallbackParseResponse(BaseModel):
    clauses: List[ParsedClause]


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


async def llm_fallback_parse(pdf_bytes: bytes, provider: str, api_key: str) -> List[Dict[str, Any]]:
    """Invoked only when local heuristic extraction fails. A new client per call: the key may be the caller's own."""
    parse = _openai_parse if provider == "openai" else _gemini_parse
    return [c.model_dump() for c in (await parse(pdf_bytes, api_key)).clauses]


# ---------------------------------------------------------
# 3. Main Hybrid Entrypoint
# ---------------------------------------------------------
async def parse_contract_fast(
    pdf_bytes: bytes, provider: Optional[str] = None, api_key: Optional[str] = None
) -> Dict[str, Any]:
    """Returns clauses plus a per-step trace (status + ms) for the UI.
    provider/api_key are the caller's own LLM credentials; they override the server's .env keys."""
    provider = provider if provider in PROVIDERS else "gemini"
    api_key = api_key or (settings.OPENAI_API_KEY if provider == "openai" else settings.GEMINI_API_KEY)
    loop = asyncio.get_running_loop()
    steps: List[Dict[str, Any]] = []

    # Step 1: Attempt ultra-fast in-memory local parse (<50ms)
    t = time.perf_counter()
    local = await loop.run_in_executor(_pdf_executor, local_fast_parse, pdf_bytes)
    local_ms = round((time.perf_counter() - t) * 1000, 1)

    confidence = local[1] if local else None
    if local and (confidence["score"] >= MIN_CONFIDENCE or not api_key):
        # Low confidence with no key still returns the local parse; the UI shows the score.
        steps.append({"name": "local", "status": "done", "ms": local_ms})
        steps.append({"name": "llm", "status": "skipped", "ms": 0, "provider": provider})
        return {"method": "local", "clauses": local[0], "confidence": confidence, "steps": steps}
    if not api_key:
        raise RuntimeError(f"No {provider} API key: add one in Settings or set it in the server .env")

    steps.append({"name": "local", "status": "insufficient", "ms": local_ms})

    # Step 2: Fall back to the LLM only if needed
    t = time.perf_counter()
    try:
        clauses = await asyncio.wait_for(llm_fallback_parse(pdf_bytes, provider, api_key), LLM_TIMEOUT_S)
    except Exception:  # includes the timeout
        if not local:
            raise
        # LLM unavailable: a low-confidence local parse beats an error.
        steps.append({"name": "llm", "status": "failed", "ms": round((time.perf_counter() - t) * 1000, 1), "provider": provider})
        return {"method": "local", "clauses": local[0], "confidence": confidence, "steps": steps}
    steps.append({"name": "llm", "status": "done", "ms": round((time.perf_counter() - t) * 1000, 1), "provider": provider})
    return {"method": provider, "clauses": clauses, "confidence": None, "steps": steps}
