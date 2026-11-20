"""Per-user switches for the optional steps of Search and Ask, saved on the user (users.preferences, JSONB).

Every switch has a server default, so an empty object, or a switch added after the user last saved, behaves as before.
The evaluation scripts never pass preferences, so they always measure the defaults.
"""

from dataclasses import asdict, dataclass
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import current_user
from app.core.config import settings
from app.core.database import User, get_db

router = APIRouter()


@dataclass(frozen=True)
class Prefs:
    rerank: bool | None = None  # re-score search results with the local cross-encoder; None = the server's SEARCH_RERANK
    followups: bool = True  # suggest questions to ask next (one model call per answer)
    widen: bool = True  # add the clauses a cited clause refers to ("subject to Section 8"), via the Neo4j graph
    facts: bool = True  # add what the contract graph knows about the companies a question names


DEFAULT = Prefs()
FIELDS = tuple(asdict(DEFAULT))


def of(user: User) -> Prefs:
    """The user's saved switches over the defaults; unknown keys (a removed switch) are ignored."""
    saved = user.preferences or {}
    return Prefs(**{k: saved[k] for k in FIELDS if isinstance(saved.get(k), bool)})


def _shown(p: Prefs) -> dict:
    return asdict(p) | {"rerank": settings.SEARCH_RERANK if p.rerank is None else p.rerank}  # what actually happens


def _rerank_unavailable() -> str | None:
    from app.search.rerank import unavailable  # imported here: the reranker module is only needed for this check

    return unavailable()


class PrefsIn(BaseModel):
    rerank: bool | None = None
    followups: bool | None = None
    widen: bool | None = None
    facts: bool | None = None


@router.get("/settings/preferences")
async def get_preferences(user: User = Depends(current_user)):
    """The user's switches as they apply now, and whether the reranker can run on this server (and why not)."""
    return {"preferences": _shown(of(user)), "rerank_unavailable": _rerank_unavailable()}


@router.put("/settings/preferences")
async def save_preferences(body: PrefsIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Saves the switches that were sent; the others keep their saved value."""
    change = body.model_dump(exclude_none=True)
    if change.get("rerank") and (why := _rerank_unavailable()):
        raise HTTPException(400, why)
    row = await db.get(User, user.id)
    row.preferences = {**(row.preferences or {}), **change}  # a new dict, so SQLAlchemy sees the JSONB change
    await db.commit()
    return {"preferences": _shown(of(row)), "rerank_unavailable": _rerank_unavailable()}
