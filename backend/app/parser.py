import re
from typing import List, Dict, Any
import fitz  # PyMuPDF

CLAUSE_PATTERN = re.compile(
    r"(?P<clause_id>(?:ARTICLE\s+[IVXLCDM\d]+|Section\s+\d+(?:\.\d+)*))\s*[:\-\.]?\s*(?P<title>[^\n]+)",
    re.IGNORECASE,
)


def extract_pdf_pages(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """Extracts text page-by-page to retain document coordinate metadata."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        pages.append({"page_number": page_num + 1, "text": page.get_text("text")})
    return pages


def parse_contract_clauses(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Splits legal documents along structural boundaries while preserving
    page numbers and hierarchical clause tags.
    """
    full_text = "\n".join(
        [f"--- PAGE {p['page_number']} ---\n" + p["text"] for p in pages]
    )
    matches = list(CLAUSE_PATTERN.finditer(full_text))

    if not matches:
        # Fallback: Split on double newlines while enforcing minimum token length
        paragraphs = [p.strip() for p in full_text.split("\n\n") if len(p.strip()) > 60]
        return [
            {
                "clause_identifier": f"PARA_{idx + 1}",
                "title": "General Clause",
                "content": p,
                "character_count": len(p),
            }
            for idx, p in enumerate(paragraphs)
        ]

    chunks = []
    for i, match in enumerate(matches):
        start_idx = match.start()
        end_idx = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        clause_body = full_text[start_idx:end_idx].strip()

        chunks.append(
            {
                "clause_identifier": match.group("clause_id").strip().upper(),
                "title": match.group("title").strip()[:200],
                "content": clause_body,
                "character_count": len(clause_body),
            }
        )

    return chunks
