"""History of Asks and Searches, per user, so an answer survives leaving the page and two can be compared."""
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import current_user
from app.database import QuerySession, User, get_db

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


def _item(s: QuerySession, full: bool = False) -> dict:
    d = s.data
    summary = {"answer": d.get("answer", "")[:200], "sources": len(d.get("sources", []))} if s.kind == "ask" else {"results": len(d.get("results", []))}
    return {"id": str(s.id), "kind": s.kind, "query": s.query, "created_at": s.created_at.isoformat(), **summary, **({"data": d} if full else {})}


async def _owned(db: AsyncSession, user: User, session_id: uuid.UUID) -> QuerySession:
    s = await db.get(QuerySession, session_id)
    if not s or s.user_id != user.id:
        raise HTTPException(404, "Session not found")
    return s


@router.get("")
async def list_sessions(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    # ponytail: loads each row's JSON to build the summary; store the summary in columns if history gets long
    rows = (await db.execute(select(QuerySession).where(QuerySession.user_id == user.id).order_by(QuerySession.created_at.desc()).limit(100))).scalars()
    return [_item(s) for s in rows]


@router.get("/{session_id}")
async def get_session(session_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return _item(await _owned(db, user, session_id), full=True)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.delete(await _owned(db, user, session_id))
    await db.commit()
