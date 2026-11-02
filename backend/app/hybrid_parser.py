import os
import re
from typing import List, Dict, Any, Optional
import fitz  # PyMuPDF
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

# ---------------------------------------------------------
# 1. Local Fast-Path Heuristic Engine (< 50ms)
# ---------------------------------------------------------
FAST_HEADER_PATTERN = re.compile(
    r"^(?:(?:ARTICLE|SECTION|CLAUSE|SCHEDULE|EXHIBIT)\s+[IVXLCDM\d]+(?:\.\d+)*|\d+(?:\.\d+)+|\d+\.)\s*[:\-\.]?\s*(.*)$",
    re.IGNORECASE,
)


def local_fast_parse(pdf_bytes: bytes) -> Optional[List[Dict[str, Any]]]:
    """
    Parses document locally in memory using PyMuPDF font sizes and regex.
    Returns None if the document layout is too chaotic, triggering the LLM fallback.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    lines_meta = []

    for page_idx, page in enumerate(doc):
        page_dict = page.get_text("dict")
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                line_text = "".join(
                    [span["text"] for span in line.get("spans", [])]
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
                    }
                )

    if not lines_meta:
        return None

    # Calculate median body text size
    all_sizes = sorted([l["font_size"] for l in lines_meta])
    median_size = all_sizes[len(all_sizes) // 2]

    clauses: List[Dict[str, Any]] = []
    current_clause: Optional[Dict[str, Any]] = None
    body_accumulator: List[str] = []

    for line in lines_meta:
        text = line["text"]
        match = FAST_HEADER_PATTERN.match(text)
        is_visual_header = (
            line["font_size"] > (median_size * 1.18) and len(text.split()) < 10
        )

        if match or is_visual_header:
            if current_clause and body_accumulator:
                current_clause["content"] = "\n".join(body_accumulator).strip()
                if len(current_clause["content"]) > 30:
                    clauses.append(current_clause)

            title = match.group(1).strip() if match else text
            clause_id = (
                text.split()[0].upper()
                if match
                else f"SEC_{text[:15].upper().replace(' ', '_')}"
            )

            current_clause = {
                "clause_identifier": clause_id,
                "title": title or "Section",
                "page_number": line["page_number"],
            }
            body_accumulator = [text]
        else:
            if current_clause:
                body_accumulator.append(text)
            else:
                current_clause = {
                    "clause_identifier": "PREAMBLE",
                    "title": "Preamble & Recitals",
                    "page_number": line["page_number"],
                }
                body_accumulator = [text]

    if current_clause and body_accumulator:
        current_clause["content"] = "\n".join(body_accumulator).strip()
        if len(current_clause["content"]) > 30:
            clauses.append(current_clause)

    # Confidence check: A healthy legal document has at least 3 distinct sections
    if len(clauses) >= 3:
        return clauses

    # Document structure was ambiguous; trigger fallback
    return None


# ---------------------------------------------------------
# 2. Resilient Gemini Fallback Engine (~1.5s - 2.5s)
# ---------------------------------------------------------
class ParsedClause(BaseModel):
    clause_identifier: str
    title: str
    content: str


class FallbackParseResponse(BaseModel):
    clauses: List[ParsedClause]


gemini_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


async def gemini_fallback_parse(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """Invoked only when local heuristic extraction fails."""
    response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            "Extract every distinct clause and section from this contract into structured JSON.",
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=FallbackParseResponse,
            temperature=0.0,
        ),
    )
    data = FallbackParseResponse.model_validate_json(response.text)
    return [c.model_dump() for c in data.clauses]


# ---------------------------------------------------------
# 3. Main Hybrid Entrypoint
# ---------------------------------------------------------
async def parse_contract_fast(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    # Step 1: Attempt ultra-fast in-memory local parse (<50ms)
    fast_results = local_fast_parse(pdf_bytes)
    if fast_results:
        return fast_results

    # Step 2: Fall back to Gemini Multimodal only if needed
    return await gemini_fallback_parse(pdf_bytes)
