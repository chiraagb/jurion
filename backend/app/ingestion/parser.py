"""Contract PDF -> clauses: read the PDF once (pdf_text.py), split it with the local rules (rules.py), and try the LLM
(llm_parse.py) only when the rules are unsure. Returns the clauses with a per-step trace for the Parser Lab.
"""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
from app.core.config import settings
from app.ingestion.llm_parse import PROVIDERS, llm_headings, llm_fallback_parse
from app.ingestion.pdf_text import Read, read_lines, reflow, run_pdf
from app.ingestion.rules import MIN_CONFIDENCE, _confidence, _local_from_lines

__all__ = [
    "MAX_PDF_BYTES",
    "PROVIDERS",
    "NoApiKey",
    "NoStructure",
    "parse_contract_fast",
]
log = logging.getLogger("jurion.parser")
MAX_PDF_BYTES = 25 * 1024 * 1024
LLM_TIMEOUT_S = (
    60  # one attempt, no retries: a hung or failing LLM call must not block the upload
)


def _local_with_fallbacks(read: Read) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """The normal rules; if they find no structure, the looser heading styles."""
    return _local_from_lines(read) or _local_from_lines(read, relaxed=True)


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
        "content": reflow(lines, pitch),
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
    read = await run_pdf(read_lines, pdf_bytes)
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
                llm_headings(read, provider, api_key), LLM_TIMEOUT_S
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
