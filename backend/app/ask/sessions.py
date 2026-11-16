"""Chat sessions (an Ask conversation with its own context budget) and saved searches, per user."""
import re
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import current_user
from app.core.config import settings
from app.core.database import QuerySession, User, get_db

router = APIRouter(prefix="/sessions")
SAME_RUN_MIN = 10  # the same question again within this many minutes updates its session instead of adding a copy


async def save_session(db: AsyncSession, user_id: uuid.UUID, kind: str, query: str, data: dict) -> uuid.UUID:
    since = datetime.now(timezone.utc) - timedelta(minutes=SAME_RUN_MIN)
    row = (await db.execute(
        select(QuerySession).where(QuerySession.user_id == user_id, QuerySession.kind == kind, QuerySession.query == query, QuerySession.created_at >= since)
        .order_by(QuerySession.created_at.desc()).limit(1)
    )).scalar()  # a reload or back-button re-runs the question: that must not fill the history with copies
    if row:
        row.data, row.created_at = data, func.now()
    else:
        row = QuerySession(user_id=user_id, kind=kind, query=query, data=data)
        db.add(row)
    await db.commit()
    return row.id


CLAUSE_RESERVE = 4_000  # tokens kept free in a session for the clauses of the next question
tokens = lambda text: len(text) // 4  # ~4 characters a token: an estimate, not a tokenizer count
CITE = re.compile(r"\s?\[\d+\]")  # [1] marks point at one answer's own references, so they mean nothing in a later turn


def memory(turns: list[dict]) -> list[tuple[str, str]]:
    """What the chat remembers: each answered question and its answer (without citation marks). Clauses are not remembered; each turn retrieves its own."""
    return [(t["question"], CITE.sub("", t["answer"])) for t in turns if t.get("answer") and not t.get("clarify")]


def used(turns: list[dict]) -> int:
    return sum(tokens(q) + tokens(a) for q, a in memory(turns))


is_full = lambda n: n + CLAUSE_RESERVE > settings.ASK_SESSION_TOKENS  # no room left for the next question's clauses


async def append_turn(db: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID | None, turn: dict) -> tuple[uuid.UUID, int]:
    """Adds a question and its answer to a chat session (a new one when there is none); returns its id and how much of its context is used."""
    row = await db.get(QuerySession, session_id) if session_id else None
    if row and (row.user_id != user_id or row.kind != "chat"):
        row = None
    if row:
        row.data = {"turns": [*row.data["turns"], turn]}  # a new dict: in-place changes to a JSON column are not noticed
    else:
        row = QuerySession(user_id=user_id, kind="chat", query=turn["question"][:200], data={"turns": [turn]})
        db.add(row)
    await db.commit()
    return row.id, used(row.data["turns"])


def _item(s: QuerySession, full: bool = False) -> dict:
    d = s.data
    if s.kind == "chat":
        summary = {"turns": len(d["turns"]), "used": used(d["turns"]), "limit": settings.ASK_SESSION_TOKENS, "full": is_full(used(d["turns"]))}
    elif s.kind == "compare":
        summary = {"compared": True}  # the workflow's and the agent's answers to one question; never chat memory
    else:
        summary = {"results": len(d.get("results", []))}
    return {"id": str(s.id), "kind": s.kind, "query": s.query, "created_at": s.created_at.isoformat(), **summary, **({"data": d} if full else {})}


async def _owned(db: AsyncSession, user: User, session_id: uuid.UUID) -> QuerySession:
    s = await db.get(QuerySession, session_id)
    if not s or s.user_id != user.id:
        raise HTTPException(404, "Session not found")
    return s


@router.get("")
async def list_sessions(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # ponytail: loads each row's JSON to build the summary; store the summary in columns if history gets long
    rows = (await db.execute(select(QuerySession).where(QuerySession.user_id == user.id, QuerySession.kind.in_(["chat", "compare"])).order_by(QuerySession.created_at.desc()).limit(100))).scalars()
    return [_item(s) for s in rows]


@router.get("/{session_id}")
async def get_session(session_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return _item(await _owned(db, user, session_id), full=True)


class Rename(BaseModel):
    title: str = Field(min_length=1, max_length=200)


@router.patch("/{session_id}")
async def rename_session(session_id: uuid.UUID, body: Rename, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await _owned(db, user, session_id)
    s.query = body.title.strip() or s.query  # the title of a chat is its `query` column (the first question until renamed)
    await db.commit()
    return _item(s)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.delete(await _owned(db, user, session_id))
    await db.commit()
