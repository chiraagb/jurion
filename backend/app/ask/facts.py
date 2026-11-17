"""What Ask knows besides clause search: clauses a clause refers to (graph widening), what the contract graph says
about the companies a question names, and answers about the library itself ("how many contracts do we have?").
"""

import logging
import re
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import Clause, Document
from app.search.embeddings import expand_thin
from app.search.graph import party_key, read_library, references_from

log = logging.getLogger("jurion")


def stem(filename: str) -> str:
    """A file name without its .pdf, as contracts are named to the model and the user."""
    return re.sub(r"\.pdf$", "", filename, flags=re.I)


def card_line(c: dict) -> str:
    """One contract as the model sees it in a list: name, summary, parties and their roles."""
    return (
        c["filename"]
        + (f" - {c['summary']}" if c.get("summary") else "")
        + ". Parties: "
        + "; ".join(f"{p['name']} ({p['role']})" for p in c["parties"])
    )


def contract_options(cards: list[dict]) -> list[dict]:
    """The contracts offered when Ask has to ask "which contract?"."""
    return [
        {"id": c["id"], "filename": c["filename"], "summary": c.get("summary") or ""}
        for c in cards[:8]
    ]


async def widen(s: AsyncSession, relevant: list[dict], limit: int = 3) -> list[dict]:
    """The clauses the relevant ones refer to ("subject to Section 8"), so the answer sees what it depends on. Not graded: a dependency, not a match."""
    try:
        links = await references_from([h["id"] for h in relevant])
    except Exception as e:  # a down Neo4j just means no widening
        log.warning("graph widen failed: %s", type(e).__name__)
        return []
    have = {h["id"] for h in relevant}
    wanted: dict[str, str] = (
        {}
    )  # target id -> identifier of the clause that refers to it
    for h in relevant:
        for b in links.get(h["id"], []):
            if b not in have and b not in wanted:
                wanted[b] = h["clause_identifier"]
    if not wanted:
        return []
    rows = (
        await s.execute(
            select(
                Clause.id,
                Clause.document_id,
                Document.filename,
                Clause.position,
                Clause.clause_identifier,
                Clause.title,
                Clause.content,
                Clause.page_number,
            )
            .join(Document, Document.id == Clause.document_id)
            .where(Clause.id.in_([uuid.UUID(b) for b in list(wanted)[:limit]]))
        )
    ).all()
    extras = [
        {
            "id": str(r.id),
            "document_id": str(r.document_id),
            "filename": r.filename,
            "position": r.position,
            "clause_identifier": r.clause_identifier,
            "title": r.title,
            "content": r.content,
            "page_number": r.page_number,
            "vector_rank": None,
            "keyword_rank": None,
            "via": wanted[str(r.id)],
        }
        for r in rows
    ]
    await expand_thin(
        s, extras
    )  # a reference to "Article 12" points at a heading: its section is what is meant
    return extras


GENERIC = {
    "company",
    "customer",
    "client",
    "supplier",
    "vendor",
    "buyer",
    "seller",
    "licensor",
    "licensee",
    "party",
    "parties",
    "distributor",
    "sponsor",
    "institution",
    "bank",
    "manufacturer",
    "agency",
    "agent",
}


def company_facts(cards: list[dict], text: str) -> str:
    """What the contract graph knows about the companies the text names (and earlier questions of the chat): their roles, their contracts,
    and which contracts share a company. Clause search cannot answer "what is Ingram Micro?" or "how are these contracts related?"; the graph can.
    """
    t = f" {party_key(text)} "
    found: dict[str, dict] = {}
    for c in cards:
        for p in c["parties"]:
            names = {party_key(n) for n in [p["name"], *(p.get("aliases") or [])]}
            if any(len(n) >= 4 and n not in GENERIC and f" {n} " in t for n in names):
                found.setdefault(party_key(p["name"]), {"name": p["name"], "in": []})[
                    "in"
                ].append((c, p))
    if not found:
        return ""
    out = [
        "Contract graph facts (who the companies are and which contracts they are in; this is not clause text):"
    ]
    docs: dict[str, dict] = {}
    for f in list(found.values())[:3]:
        out.append(
            f"- {f['name']} is in {len(f['in'])} contract{'s' if len(f['in']) != 1 else ''}:"
        )
        for c, p in f["in"]:
            docs[c["id"]] = c
            others = ", ".join(
                f"{q['name']} ({q['role']})"
                for q in c["parties"]
                if q["name"] != p["name"]
            )
            out.append(
                f"    * {stem(c['filename'])}: {f['name']} is the {p['role']}. {c.get('summary') or ''} Other companies: {others or 'none stored'}."
            )
    if len(docs) > 1:
        seen: dict[str, list[str]] = {}
        for c in docs.values():
            for p in c["parties"]:
                seen.setdefault(p["name"], []).append(stem(c["filename"]))
        shared = [f"{n} (in {', '.join(d)})" for n, d in seen.items() if len(d) > 1]
        out.append(
            f"- These {len(docs)} contracts are related through the companies they share: {'; '.join(shared)}. Their file names show which are amendments or follow-ons."
        )
    return "\n".join(out)


# Questions about the library itself ("how many contracts do we have?") are not in any clause, so searching clauses cannot answer them.
# They are recognised by shape (short and anchored, so "how many contracts mention indemnity" still goes to search) and answered from the database.
_THING = r"(?:contracts?|agreements?|documents?|pdfs?|files?)"
_TAIL = r"(?:\s+(?:do|did|have|has|are|is|there|i|we|you|saved|uploaded|stored|in|my|our|the|library|account|total|altogether|now|currently|so far|all|of))*"
LIBRARY_QUESTIONS = {
    "count": re.compile(rf"^how many {_THING}{_TAIL}$"),
    "list": re.compile(
        rf"^(?:please )?(?:(?:list|show|name)(?: me)?|what|which)(?:\s+(?:are|is|all|the|my|our|saved|uploaded|stored))*\s+{_THING}{_TAIL}$"
    ),
    "companies": re.compile(rf"^how many (?:companies|parties|counterparties){_TAIL}$"),
    "shared": re.compile(
        r"^(?:which|what|list)\b.*\b(?:companies|parties)\b.*\b(?:more than one|multiple|several|shared|in common|across)\b"
    ),
}


def library_kind(question: str) -> str | None:
    q = re.sub(r"\s+", " ", question.lower()).strip(" ?.!")
    return next((k for k, r in LIBRARY_QUESTIONS.items() if r.search(q)), None)


async def library_answer(s: AsyncSession, uid, question: str) -> str | None:
    """The answer to a question about the library (counts, lists, shared companies), or None if the question is about clause text."""
    kind = library_kind(question)
    if not kind:
        return None
    if kind in ("count", "list"):
        docs = (
            await s.execute(
                select(Document.filename, Document.pages)
                .where(Document.user_id == uid)
                .order_by(Document.filename)
            )
        ).all()
        if not docs:
            return "You have no saved contracts yet. Save one from Parser Lab and it appears here."
        shown = "\n".join(
            f"- {stem(f)} ({p} page{'s' if p != 1 else ''})" for f, p in docs
        )
        head = (
            f"You have **{len(docs)}** saved contract{'s' if len(docs) != 1 else ''}."
        )
        return (
            f"{head}\n\n{shown}"
            if kind == "list" or len(docs) <= 10
            else f"{head} Ask “list my contracts” to see them."
        )
    lib = await read_library(uid)
    names = {c["id"]: stem(c["filename"]) for c in lib["contracts"]}
    if kind == "companies":
        return f"Your contracts name **{len(lib['parties'])}** companies across **{len(lib['contracts'])}** contracts."
    where = {
        p["key"]: [names[l["contract"]] for l in lib["links"] if l["party"] == p["key"]]
        for p in lib["parties"]
    }
    shared = [
        (p["name"], where[p["key"]]) for p in lib["parties"] if len(where[p["key"]]) > 1
    ]
    if not shared:
        return "No company appears in more than one of your contracts yet."
    return (
        f"**{len(shared)}** compan{'y appears' if len(shared) == 1 else 'ies appear'} in more than one contract:\n\n"
        + "\n".join(f"- **{n}**: {', '.join(d)}" for n, d in shared)
    )
