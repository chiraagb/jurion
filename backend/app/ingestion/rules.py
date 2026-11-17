"""The local rules that split a contract's lines into clauses: heading patterns, font size, the signature block, and a
0-1 confidence score that decides whether the LLM fallback is tried. Fast (< 50ms) and free; no network.
"""

import re
from typing import Any, Dict, List, Optional, Tuple
from app.ingestion.pdf_text import Read, layout, read_lines, reflow

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


def local_fast_parse(
    pdf_bytes: bytes,
) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, float]]]:
    """Local heuristics only (regex + font size). Returns (clauses, confidence), or None if no structure was found."""
    read = read_lines(pdf_bytes)
    return (
        (_local_from_lines(read) or _local_from_lines(read, relaxed=True))
        if read
        else None
    )


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
            layout(body_accumulator, line_pitch)
            if is_sig
            else reflow(body_accumulator, line_pitch)
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
