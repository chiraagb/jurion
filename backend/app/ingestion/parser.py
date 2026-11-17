"""Splitting a contract into clauses: local rules first (heading patterns, font size, confidence scoring), then one LLM
attempt when the rules are unsure. Reading the PDF itself is in pdf_text.py.
"""

import asyncio
import base64
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from google import genai
from google.genai import types
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.core.config import settings
from app.ingestion.pdf_text import Read, _layout, _read_lines, _reflow, run_pdf

log = logging.getLogger("jurion.parser")

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
ATTACHMENT_PATTERN = re.compile(
    r"(?:ATTACHMENT|APPENDIX|ANNEX|SCHEDULE|EXHIBIT)\s+[IVXLCDM\d]+\b"
)  # capitals only: "see Attachment 1." is body text


MAX_PDF_BYTES = 25 * 1024 * 1024
LLM_TIMEOUT_S = (
    60  # one attempt, no retries: a hung or failing LLM call must not block the upload
)
MIN_CONFIDENCE = 0.6  # below this the local parse is distrusted and Gemini is tried (if a key is set)


def _numbering_score(ids: List[str]) -> float:
    """Share of expected clause numbers actually found: ids 1,2,4 under one parent span 4 and find 3.
    Only plain numeric ids ("10", "10.2") are judged; keyword ids (ARTICLE I) are ignored.
    """
    groups: Dict[str, set] = {}
    for clause_id in ids:
        m = re.fullmatch(r"(?:(\d+(?:\.\d+)*)\.)?(\d+)", clause_id)
        if m:
            groups.setdefault(m.group(1) or "", set()).add(int(m.group(2)))
    # A stray number far above the rest ("22314", a zip code) must not stretch the expected range to thousands.
    groups = {
        k: kept
        for k, g in groups.items()
        if (kept := {v for v in g if v <= 5 * len(g) + 20})
    }
    expected = sum(
        max(g) - min(g) + 1 for g in groups.values()
    )  # gaps only; an excerpt may not start at 1
    return sum(len(g) for g in groups.values()) / expected if expected >= 3 else 1.0


def _ocr_note(conf: Dict[str, Any], lines: List[Dict[str, Any]]) -> Dict[str, Any]:
    """OCR text can be wrong in small ways: say so beside the result."""
    n = len({l["page_number"] for l in lines if l.get("ocr")})
    if n:
        conf["issues"] = [
            *conf.get("issues", []),
            f"{n} page{'s' if n > 1 else ''} had no text layer and {'were' if n > 1 else 'was'} read by OCR, so the text may contain recognition errors. Check it against the PDF.",
        ]
    return conf


def _confidence(
    clauses: List[Dict[str, Any]], line_chars: int, pages: int = 1
) -> Dict[str, Any]:
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
    balanced = (
        1.0 if pages < 4 or share <= 0.4 else round(0.4 / share, 2)
    )  # short documents may be one big clause
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


def _local_with_fallbacks(
    read: Read,
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """The normal rules; if they find no structure, the looser heading styles."""
    return _local_from_lines(read) or _local_from_lines(read, relaxed=True)


def local_fast_parse(
    pdf_bytes: bytes,
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """Local heuristics only (regex + font size). Returns (clauses, confidence), or None if no structure was found."""
    read = _read_lines(pdf_bytes)
    return _local_with_fallbacks(read) if read else None


def _local_from_lines(
    read: Read, relaxed: bool = False
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    lines_meta, median_size, line_pitch, pages = read
    clauses: List[Dict[str, Any]] = []
    seen_ids: set = set()
    current_clause: Optional[Dict[str, Any]] = None
    body_accumulator: List[Dict[str, Any]] = []

    def flush() -> None:
        if not (current_clause and body_accumulator):
            return
        is_sig = current_clause["clause_identifier"] == "SIGNATURES"
        current_clause["content"] = (
            _layout(body_accumulator, line_pitch)
            if is_sig
            else _reflow(body_accumulator, line_pitch)
        )
        current_clause["end_line"] = current_clause["start_line"] + len(
            body_accumulator
        )  # body lines are contiguous
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
            current_clause
            and current_clause["clause_identifier"] == "SIGNATURES"
            and not (ATTACHMENT_PATTERN.match(text) and len(text.split()) < 10)
            and not (
                line["is_bold"]
                and not line.get("table")
                and len(text.split()) <= 10
                and re.match(r"\d{1,3}\.\s+\S", text)
            )
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
                loose = (
                    f"SEC_{rm.group('title')[:15].upper().replace(' ', '_')}",
                    rm.group("title").strip().title(),
                )
        awaiting_title = (
            bool(current_clause)
            and not current_clause["title"]
            and len(body_accumulator) == 1
        )
        is_visual_header = (
            not line.get("table")
            and not awaiting_title
            and (line["font_size"] > (median_size * 1.18) and len(text.split()) < 10)
        )

        # "IN WITNESS WHEREOF" is often just the body of the last numbered clause ("16.8"), so it only starts
        # the block when the current clause already has a body; the signature-page markers always do.
        is_signature = (
            bool(current_clause)
            and current_clause["clause_identifier"] != "SIGNATURES"
            and (
                (
                    text.upper().startswith("IN WITNESS WHEREOF")
                    and len(body_accumulator) > 1
                )
                or (
                    len(text.split()) <= 8
                    and re.match(
                        r"\[?SIGNATURE PAGE|SIGNED (AT|ON|BY)\b", text, re.IGNORECASE
                    )
                    is not None
                )
            )  # short lines only: "signed by Investigator. The Institution shall…" is body text
        )

        if match or is_visual_header or is_signature or loose:
            flush()

            title = (
                match.group("title").strip().rstrip(":")
                if match
                else (loose[1] if loose else text)
            )
            clause_id = (
                match.group("id").rstrip(".").upper()
                if match
                else (
                    loose[0] if loose else f"SEC_{text[:15].upper().replace(' ', '_')}"
                )
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
    return clauses, _ocr_note(
        _confidence(clauses, sum(len(l["text"]) for l in lines_meta), pages), lines_meta
    )


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
        content = _layout(body, pitch) if sig else _reflow(body, pitch)
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


async def _llm_headings(
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


# ---------------------------------------------------------
# 3. Main Hybrid Entrypoint
# ---------------------------------------------------------
class NoStructure(ValueError):
    """Neither the rules nor the AI found any sections: a letter, a power of attorney, a one-paragraph agreement."""


def _whole_document(read: Read) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """A document with no sections is kept as ONE clause (all its text, searchable and citable) rather than refused."""
    lines, _, pitch, pages = read
    clause = {
        "clause_identifier": "DOC",
        "title": lines[0]["text"].strip().title()[:80] or "Full document",
        "page_number": lines[0]["page_number"],
        "parent_identifier": None,
        "start_line": 0,
        "end_line": len(lines),
        "content": _reflow(lines, pitch),
    }
    conf = _confidence([clause], sum(len(l["text"]) for l in lines), pages)
    conf["score"] = min(conf["score"], 0.5)
    conf["issues"] = [
        "No sections were found, so the whole document is kept as one clause."
    ]
    return [clause], conf


class NoApiKey(RuntimeError):
    """The LLM was needed (or asked for) but no key is configured."""


async def parse_contract_fast(
    pdf_bytes: bytes,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    force_llm: bool = False,
) -> Dict[str, Any]:
    """Returns clauses plus a per-step trace (status + ms) for the UI.
    provider/api_key are the caller's own LLM credentials; they override the server's .env keys.
    force_llm: the user asked for the AI result even though the local parse looks fine; it is used as is.
    """
    provider = provider if provider in PROVIDERS else "gemini"
    api_key = api_key or (
        settings.OPENAI_API_KEY if provider == "openai" else settings.GEMINI_API_KEY
    )
    steps: List[Dict[str, Any]] = []

    # Step 1: read the PDF once, then the local heuristic parse
    t = time.perf_counter()
    read = await run_pdf(_read_lines, pdf_bytes)
    local = _local_with_fallbacks(read) if read else None
    local_ms = round((time.perf_counter() - t) * 1000, 1)

    confidence = local[1] if local else None
    if (
        local
        and not force_llm
        and (confidence["score"] >= MIN_CONFIDENCE or not api_key)
    ):
        # Low confidence with no key still returns the local parse; the UI shows the score.
        steps.append({"name": "local", "status": "done", "ms": local_ms})
        steps.append(
            {"name": "llm", "status": "skipped", "ms": 0, "provider": provider}
        )
        return {
            "method": "local",
            "clauses": local[0],
            "confidence": confidence,
            "steps": steps,
        }
    if not api_key:
        raise NoApiKey(
            f"No {provider} API key: add one in Settings or set it in the server .env"
        )

    steps.append({"name": "local", "status": "insufficient", "ms": local_ms})

    # Step 2: one LLM attempt. With extractable text it only picks the headings (text stays from the PDF);
    # with no text at all (a scan) it reads the whole PDF.
    t = time.perf_counter()
    try:
        if read:
            picked = await asyncio.wait_for(
                _llm_headings(read, provider, api_key), LLM_TIMEOUT_S
            )
            if not picked:
                raise NoStructure("LLM found no structure")
            clauses, llm_conf = picked
        else:
            clauses, llm_conf = (
                await asyncio.wait_for(
                    llm_fallback_parse(pdf_bytes, provider, api_key), LLM_TIMEOUT_S
                ),
                None,
            )
    except Exception as e:  # includes the timeout
        log.warning("LLM fallback failed (%s, %s)", provider, type(e).__name__)
        if not local:
            if isinstance(e, NoStructure) and read:
                steps.append(
                    {
                        "name": "llm",
                        "status": "insufficient",
                        "ms": round((time.perf_counter() - t) * 1000, 1),
                        "provider": provider,
                    }
                )
                clauses, conf = _whole_document(read)
                return {
                    "method": "local",
                    "clauses": clauses,
                    "confidence": conf,
                    "steps": steps,
                }
            raise
        # LLM unavailable: a low-confidence local parse beats an error.
        steps.append(
            {
                "name": "llm",
                "status": "failed",
                "ms": round((time.perf_counter() - t) * 1000, 1),
                "provider": provider,
            }
        )
        return {
            "method": "local",
            "clauses": local[0],
            "confidence": confidence,
            "steps": steps,
        }
    llm_ms = round((time.perf_counter() - t) * 1000, 1)
    if (
        local
        and llm_conf
        and not force_llm
        and llm_conf["score"] <= confidence["score"]
    ):  # the LLM did no better: keep the local result
        steps.append(
            {
                "name": "llm",
                "status": "insufficient",
                "ms": llm_ms,
                "provider": provider,
            }
        )
        return {
            "method": "local",
            "clauses": local[0],
            "confidence": confidence,
            "steps": steps,
        }
    steps.append({"name": "llm", "status": "done", "ms": llm_ms, "provider": provider})
    out = {
        "method": provider,
        "clauses": clauses,
        "confidence": llm_conf,
        "steps": steps,
    }
    if local:
        out["local_result"] = {
            "clauses": local[0],
            "confidence": confidence,
        }  # kept so the UI can compare the two
    return out
