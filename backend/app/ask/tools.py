"""The agent's tools: their argument schemas (the descriptions are what the model reasons from), the per-request context, and
`run_tool`. Every tool is scoped to the signed-in user in code: the model only ever names numbers from lists it was shown,
never a user or a database id.
"""

import uuid
from dataclasses import dataclass, field
from typing import Literal
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.ask import workflow as A
from app.ask.facts import card_line, contract_options, stem

LIBRARY_Q = {
    "count": "how many contracts",
    "list": "list my contracts",
    "companies": "how many companies",
    "shared": "which companies are in more than one contract",
}


# ---------- tool arguments: the descriptions are what the model reasons from ----------
class Search(BaseModel):
    reason: str = Field(description="One short sentence: why this search.")
    query: str = Field(
        description="What to look for, in the wording a contract would use."
    )
    contracts: list[int] = Field(
        default=[],
        description="Contract numbers from the list to search first. Empty searches every contract.",
    )


class Read(BaseModel):
    reason: str = Field(description="One short sentence: why read this clause in full.")
    number: int = Field(description="The [number] of a clause you have already seen.")


class Follow(BaseModel):
    reason: str = Field(
        description="One short sentence: why follow this clause's references."
    )
    number: int = Field(
        description='The [number] of a clause that refers to another ("subject to Section 8").'
    )


class Company(BaseModel):
    reason: str = Field(description="One short sentence: why look this company up.")
    name: str = Field(description="A company name as written in the question.")


class Library(BaseModel):
    reason: str = Field(
        description="One short sentence: why this question is about the library, not clause text."
    )
    kind: Literal["count", "list", "companies", "shared"] = Field(
        description="count/list: the contracts saved; companies: how many companies; shared: companies in more than one contract."
    )


class Ask(BaseModel):
    reason: str = Field(description="One short sentence: why the user must choose.")
    question: str = Field(
        description="What to tell the user, e.g. which contract they mean."
    )
    contracts: list[int] = Field(
        default=[],
        description="Contract numbers the user can choose from. Empty offers all.",
    )


class Finish(BaseModel):
    reason: str = Field(
        description="One short sentence: why this is enough, or why nothing was found."
    )
    found: bool = Field(
        default=True, description="False if the contracts do not answer the question."
    )
    use: list[int] = Field(
        default=[],
        description="Numbers of the clauses that directly help answer the question.",
    )


class ListContracts(BaseModel):
    reason: str = Field(description="One short sentence: why list the contracts.")


TOOLS = {
    "list_contracts": (
        ListContracts,
        "The user's saved contracts with their summaries and parties. Use when the list below is missing or you need it again.",
    ),
    "search_clauses": (
        Search,
        "Search the contracts' clauses by meaning and keywords. Returns numbered clauses with a snippet.",
    ),
    "read_clause": (
        Read,
        "Read one clause you have already seen in full (use for a heading with no text, or a snippet that is cut off).",
    ),
    "follow_references": (
        Follow,
        'Get the clauses a clause refers to ("subject to Section 8"). They are numbered and can be used as evidence.',
    ),
    "company_info": (
        Company,
        "What the contract graph knows about a company: its role in each contract and which contracts it shares.",
    ),
    "library_stats": (
        Library,
        "Answer questions about the library itself: how many contracts, which contracts, how many companies, shared companies.",
    ),
    "ask_user": (
        Ask,
        "Ask the user which contract they mean. Ends the investigation until they answer.",
    ),
    "finish": (
        Finish,
        "Stop investigating. List in `use` the clause numbers that answer the question.",
    ),
}


def _tool_objects(clarify: bool) -> list[StructuredTool]:
    async def _noop(**_):
        return ""

    return [
        StructuredTool.from_function(
            coroutine=_noop, name=n, description=d, args_schema=m
        )
        for n, (m, d) in TOOLS.items()
        if clarify or n != "ask_user"
    ]


# ---------- per-request context: the signed-in user and what the model has seen ----------
@dataclass
class Ctx:
    s: AsyncSession
    uid: uuid.UUID
    key: str  # OpenAI key: embeddings and follow-ups always use it
    question: str
    mem: list
    only_ids: list
    anywhere: bool
    clarify: bool
    suggest: bool = True  # write follow-up questions after the answer (compare and the evaluation turn it off)
    llm: object = None  # the planning model (tools bound)
    answer_llm: object = None
    cards: list = field(default_factory=list)
    cands: list = field(
        default_factory=list
    )  # every clause the model has seen, numbered from 1 in order
    index: dict = field(default_factory=dict)  # clause id -> number
    read: set = field(default_factory=set)
    last_search: list = field(default_factory=list)
    facts: list = field(default_factory=list)
    use: list = field(default_factory=list)
    found: bool = True
    options: list = field(default_factory=list)
    steps: int = 0
    calls: int = 0
    tokens: int = 0
    stop: str = ""  # "", finish, clarify, steps, tool_calls, tokens, no_tool



def _add(c: Ctx, h: dict) -> int:
    if h["id"] not in c.index:
        c.cands.append(h)
        c.index[h["id"]] = len(c.cands)
    return c.index[h["id"]]


def _line(c: Ctx, h: dict, full: bool = False) -> str:
    n = c.index[h["id"]]
    body = h["content"][:3000] if full else " ".join(h["content"].split())[:280]
    via = f" [pulled in by clause {h['via']}]" if h.get("via") else ""
    return f"[{n}] {stem(h['filename'])} · clause {h['clause_identifier']} {h['title']} (p.{h['page_number']}){via}: {body}"


def _contracts_text(c: Ctx) -> str:
    if not c.cards:
        return "(the contract list is unavailable: search every contract)"
    return "\n".join(f"{i}. {card_line(x)}" for i, x in enumerate(c.cards, 1))


# ---------- the tools ----------
async def run_tool(c: Ctx, name: str, args: dict) -> tuple[str, str, list]:
    """(what the model sees, a one-line summary for the user, hits to show). Raises nothing the loop cannot survive."""
    if name == "list_contracts":
        return _contracts_text(c), f"{len(c.cards)} contracts", []
    if name == "search_clauses":
        a = Search.model_validate(args)
        if c.only_ids and not c.anywhere:
            ids = [
                str(i) for i in c.only_ids
            ]  # the user chose the contract: the model cannot widen it
        else:
            ids = [
                c.cards[i - 1]["id"] for i in a.contracts if 1 <= i <= len(c.cards)
            ]  # numbers map only to the user's own contracts
        hits, _mode, _note = await A.hybrid(
            c.s, c.uid, a.query, c.key, A.K, doc_ids=ids or None
        )
        await A.expand_thin(c.s, hits)
        for h in hits:
            _add(c, h)
        c.last_search = hits
        if not hits:
            return (
                "No clauses found. Try different wording or search without narrowing.",
                "no clauses",
                [],
            )
        return (
            "\n".join(_line(c, h) for h in hits),
            f"{len(hits)} clauses from {len({h['filename'] for h in hits})} contracts",
            [A._brief(h) for h in hits],
        )
    if name in ("read_clause", "follow_references"):
        a = (Read if name == "read_clause" else Follow).model_validate(args)
        if not 1 <= a.number <= len(c.cands):
            return (
                f"There is no clause [{a.number}]. Use a number from a search result.",
                "no such clause",
                [],
            )
        h = c.cands[a.number - 1]
        if name == "read_clause":
            c.read.add(h["id"])
            return _line(c, h, full=True), f"clause {h['clause_identifier']}", []
        extras = await A.widen(c.s, [h])
        for e in extras:
            _add(c, e)
        if not extras:
            return (
                f"Clause [{a.number}] refers to no other clause.",
                "no references",
                [],
            )
        return (
            "\n".join(_line(c, e) for e in extras),
            f"{len(extras)} referenced clauses",
            [A._brief(e) for e in extras],
        )
    if name == "company_info":
        a = Company.model_validate(args)
        text = A.company_facts(c.cards, a.name)
        if not text:
            return (
                f"No company called '{a.name}' in the contract graph.",
                "not found",
                [],
            )
        c.facts.append(text)
        return text, "found in the graph", []
    if name == "library_stats":
        a = Library.model_validate(args)
        text = await A.library_answer(c.s, c.uid, LIBRARY_Q[a.kind]) or "Unavailable."
        c.facts.append(f"Library facts: {text}")
        return text, a.kind, []
    if name == "ask_user" and c.clarify:
        a = Ask.model_validate(args)
        picks = [
            c.cards[i - 1] for i in a.contracts if 1 <= i <= len(c.cards)
        ] or c.cards
        c.options, c.stop = contract_options(picks), "clarify"
        c.facts.append(a.question)
        return "Asked the user.", "asked you which contract", []
    if name == "finish":
        a = Finish.model_validate(args)
        c.use, c.found, c.stop = a.use, a.found, "finish"
        return "Done.", a.reason[:120], []
    return f"Unknown tool '{name}'.", "unknown tool", []


def spent(ai) -> int:
    u = getattr(ai, "usage_metadata", None) or {}
    return u.get("total_tokens") or A.tokens(str(ai.content))


def text_of(chunk) -> str:
    c = chunk.content
    if isinstance(c, str):
        return c
    return "".join(
        b.get("text", "") if isinstance(b, dict) else str(b)
        for b in c
        if not isinstance(b, dict) or b.get("type") in (None, "text")
    )


def chosen(c: Ctx) -> list[dict]:
    """The clauses the answer is written from. A deliberate finish uses exactly what the model listed (found=false: none). A stop at a budget has no
    verdict, so it falls back to what was read in full, else the top of the last search.
    """
    if c.stop == "finish":
        if not c.found:
            return []
        picked = [
            c.cands[n - 1] for n in dict.fromkeys(c.use) if 1 <= n <= len(c.cands)
        ]
        if picked:
            return picked[:12]
    return ([h for h in c.cands if h["id"] in c.read] or c.last_search[:4])[:12]
