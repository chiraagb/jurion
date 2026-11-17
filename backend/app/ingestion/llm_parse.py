"""The LLM fallback for clause splitting (Gemini or OpenAI, one attempt, ~1.5-2.5s): with a text layer it only picks which
lines are headings, so the clause text still comes from the PDF; with no text at all (a scan) it reads the whole PDF.
"""

import base64
import re
from typing import Any, Dict, List, Optional, Tuple
from google import genai
from google.genai import types
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.core.config import settings
from app.ingestion.pdf_text import Read, layout, reflow
from app.ingestion.rules import FAST_HEADER_PATTERN, _confidence, _ocr_note


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
    '("SIGNATURES" for the signature block), and its title (the heading text, or the first words if it has none).\n\n'
)
FALLBACK_PROMPT = (
    "Extract every distinct clause and section from this contract into structured JSON."
)
PROVIDERS = ("gemini", "openai")


async def _gemini_parse(pdf_bytes: bytes, api_key: str) -> FallbackParseResponse:
    response = await genai.Client(api_key=api_key).aio.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            FALLBACK_PROMPT,
        ],
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
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_file",
                        "filename": "contract.pdf",
                        "file_data": f"data:application/pdf;base64,{pdf_b64}",
                    },
                    {"type": "input_text", "text": FALLBACK_PROMPT},
                ],
            }
        ],
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
            l["is_bold"]
            or l["font_size"] > median * 1.1
            or bool(FAST_HEADER_PATTERN.match(t))
            or bool(re.match(r"^\d+(\.\d+)*\.?\s", t))
            or t.isupper()
        )

    return [i for i, l in enumerate(lines) if maybe(l)][:1500]


def _from_headings(
    read: Read, picks: Dict[int, Heading]
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """Builds clauses from the lines the LLM chose as headings. Text always comes from the PDF itself."""
    lines, _, pitch, pages = read
    starts = sorted(i for i in picks if 0 <= i < len(lines))
    if len(starts) < 3:
        return None
    clauses, seen = [], set()
    if starts[0] > 0:
        starts.insert(0, 0)  # text before the first heading
        picks[0] = Heading(
            line=0, clause_identifier="PREAMBLE", title="Preamble & Recitals"
        )
    for n, i in enumerate(starts):
        body = lines[i : starts[n + 1] if n + 1 < len(starts) else len(lines)]
        h = picks[i]
        cid = h.clause_identifier.strip().rstrip(".").upper()
        sig = cid == "SIGNATURES"
        content = layout(body, pitch) if sig else reflow(body, pitch)
        if not content:
            continue
        parent = cid.rsplit(".", 1)[0] if "." in cid else None
        clauses.append(
            {
                "clause_identifier": cid,
                "title": h.title.strip() or f"Section {cid}",
                "content": content,
                "page_number": lines[i]["page_number"],
                "parent_identifier": parent if parent in seen else None,
                "start_line": i,
                "end_line": i + len(body),
            }
        )
        seen.add(cid)
    if len(clauses) < 3:
        return None
    return clauses, _ocr_note(
        _confidence(clauses, sum(len(l["text"]) for l in lines), pages), lines
    )


async def llm_headings(
    read: Read, provider: str, api_key: str
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    lines, median, _, _ = read
    idx = _candidates(lines, median)
    listing = "\n".join(
        f"{n}|{lines[i]['page_number']}|{lines[i]['text'][:100]}"
        for n, i in enumerate(idx)
    )
    prompt = HEADINGS_PROMPT + listing
    if provider == "openai":
        r = await AsyncOpenAI(api_key=api_key).responses.parse(
            model=settings.OPENAI_MODEL, input=prompt, text_format=HeadingList
        )
        out = r.output_parsed
    else:
        r = await genai.Client(api_key=api_key).aio.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=HeadingList,
                temperature=0.0,
            ),
        )
        out = HeadingList.model_validate_json(r.text)
    picks = {
        idx[h.line]: h for h in out.headings if 0 <= h.line < len(idx)
    }  # candidate number -> real line index
    return _from_headings(read, picks)


async def llm_fallback_parse(
    pdf_bytes: bytes, provider: str, api_key: str
) -> List[Dict[str, Any]]:
    """Invoked only when local heuristic extraction fails. A new client per call: the key may be the caller's own."""
    parse = _openai_parse if provider == "openai" else _gemini_parse
    return [c.model_dump() for c in (await parse(pdf_bytes, api_key)).clauses]
