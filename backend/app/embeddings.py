"""Clause embeddings (OpenAI) stored in clauses.embedding (pgvector), and hybrid search over them."""
import logging
import uuid
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app import llm_keys
from app.auth import current_user
from app.config import settings
from app.database import Clause, Document, User, get_db
from app.ratelimit import limit
from app.sessions import save_session

log = logging.getLogger("jurion")
MODEL, DIMS = "text-embedding-3-small", 1536
router = APIRouter()


async def openai_key(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    try:
        stored = await llm_keys.load_key(db, user_id, "openai")
    except Exception:  # ENCRYPTION_KEY missing: fall back to the .env key
        stored = None
    return stored or settings.OPENAI_API_KEY or None


async def embed_texts(api_key: str, texts: list[str]) -> list[list[float]]:
    client = AsyncOpenAI(api_key=api_key, timeout=60)
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):  # OpenAI caps tokens per request; 64 clauses x 8000 chars stays under it
        r = await client.embeddings.create(model=MODEL, input=texts[i : i + 64])
        out += [d.embedding for d in r.data]
    return out


def clause_text(c: Clause, parent_title: str | None = None) -> str:
    head = f"{parent_title} > " if parent_title else ""  # "TERM > 2.1 Duration": a sub-clause keeps its section's name
    return f"{head}{c.clause_identifier} {c.title}\n{c.content}"[:8000]  # ponytail: a clause longer than ~2k tokens is cut, not chunked


async def embed_document(db: AsyncSession, api_key: str, doc_id: uuid.UUID) -> int:
    """(Re-)embeds every clause of one contract. Returns how many."""
    clauses = (await db.execute(select(Clause).where(Clause.document_id == doc_id).order_by(Clause.position))).scalars().all()
    latest: dict[str, str] = {}  # identifier -> title of the nearest preceding clause with it (same rule as the clause tree in the UI)
    texts = []
    for c in clauses:
        texts.append(clause_text(c, latest.get(c.parent_identifier) if c.parent_identifier else None))
        latest[c.clause_identifier] = c.title
    for c, v in zip(clauses, await embed_texts(api_key, texts)):
        c.embedding = v
    await db.commit()
    return len(clauses)


class SearchIn(BaseModel):
    query: str = Field(min_length=2, max_length=500)


THIN = 60  # a clause with less text than its own number + title + this is only a heading


def is_thin(h: dict) -> bool:
    return len(" ".join(h["content"].split())) < len(h["clause_identifier"]) + len(h["title"]) + THIN


async def expand_thin(db: AsyncSession, hits: list[dict], following: int = 6, max_chars: int = 3500) -> None:
    """A heading like "TERMS AND CONDITIONS" holds no text: its section is in the clauses after it. For each retrieved heading-only
    clause, append the next few clauses (up to max_chars) so the grader and the answer see what the heading stands for."""
    for h in hits:
        if not is_thin(h):
            continue
        rows = (await db.execute(
            select(Clause.content).where(Clause.document_id == uuid.UUID(h["document_id"]), Clause.position > h["position"], Clause.position <= h["position"] + following)
            .order_by(Clause.position)
        )).scalars().all()
        text, n = h["content"], 0
        for r in rows:
            if len(text) + len(r) + 2 > max_chars:
                break
            text, n = f"{text}\n\n{r}", n + 1
        h["content"], h["expanded"] = text, n  # expanded: how many following clauses were added


async def hybrid(db: AsyncSession, user_id: uuid.UUID, q: str, key: str | None, top: int = 10, *, use_vector: bool = True, use_keyword: bool = True, doc_ids: list[str] | None = None) -> tuple[list[dict], str, str | None]:
    """Hybrid search over one user's clauses: vector similarity + keyword rank, merged with reciprocal rank fusion."""
    mine = select(Clause.id, Clause.document_id, Document.filename, Clause.position, Clause.clause_identifier, Clause.title,
                  Clause.content, Clause.page_number).join(Document, Document.id == Clause.document_id).where(Document.user_id == user_id)
    if doc_ids:  # the graph narrowed the question to these contracts
        mine = mine.where(Document.id.in_([uuid.UUID(d) for d in doc_ids]))
    tsq = func.websearch_to_tsquery("english", q)  # all words must match; tried "any word" and AND-then-OR, both worse overall (docs/18)
    tsv = func.to_tsvector("english", Clause.title + " " + Clause.content)  # ponytail: no GIN index; add one past ~100k clauses
    keyword = (await db.execute(mine.add_columns(func.ts_rank_cd(tsv, tsq).label("r")).where(tsv.op("@@")(tsq)).order_by(desc("r")).limit(20))).all() if use_keyword else []

    vector, mode, note = [], "keyword", None
    if not use_vector:  # the evaluation switches one list off to measure the other alone
        pass
    elif not key:
        note = "No OpenAI key saved, so only keyword matching was used."
    else:
        try:
            qvec = (await embed_texts(key, [q]))[0]
            dist = Clause.embedding.cosine_distance(qvec)
            vector = (await db.execute(mine.add_columns(dist.label("d")).where(Clause.embedding.is_not(None)).order_by(dist).limit(20))).all()
            mode = "hybrid"
        except Exception as e:
            log.warning("search embedding failed: %s", type(e).__name__)
            note = "The OpenAI embedding call failed, so only keyword matching was used."

    hits: dict[uuid.UUID, dict] = {}
    for name, rows in (("vector", vector), ("keyword", keyword)):
        for rank, r in enumerate(rows, 1):
            h = hits.setdefault(r.id, {
                "id": str(r.id), "document_id": str(r.document_id), "filename": r.filename, "position": r.position,
                "clause_identifier": r.clause_identifier, "title": r.title, "content": r.content,
                "page_number": r.page_number, "vector_rank": None, "vector_similarity": None, "keyword_rank": None, "score": 0.0,
            })
            h[f"{name}_rank"] = rank
            h["score"] += 1 / (60 + rank)  # reciprocal rank fusion
            if name == "vector":
                h["vector_similarity"] = round(1 - r.d, 4)
    return sorted(hits.values(), key=lambda h: -h["score"])[:top], mode, note


@router.post("/search")
async def search(
    body: SearchIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(limit("search", 30, 60, by_user=True)),
):
    found, mode, note = await hybrid(db, user.id, body.query.strip(), await openai_key(db, user.id))
    results = [{**{k: v for k, v in h.items() if k != "content"}, "snippet": h["content"][:400], "content": h["content"][:3000]} for h in found]
    data = {"mode": mode, "note": note, "model": MODEL, "results": results}
    try:
        sid = str(await save_session(db, user.id, "search", body.query.strip(), data))
    except Exception as e:  # history is a convenience: never fail a search over it
        log.warning("saving search session failed: %s", type(e).__name__)
        sid = None
    return {**data, "session_id": sid}


class MapIn(BaseModel):
    document_id: uuid.UUID | None = None  # one contract; omitted = all of the user's contracts
    query: str | None = Field(default=None, min_length=2, max_length=500)  # also place this question on the map


@router.post("/embeddings/map")
async def embedding_map(
    body: MapIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(limit("map", 30, 60, by_user=True)),
):
    """The stored vectors squashed from 1536 numbers to 3 (PCA; the UI draws 2 or 3 of them), so they can be drawn. Nothing is stored or changed."""
    rows = select(Clause.document_id, Document.filename, Clause.position, Clause.clause_identifier, Clause.title, Clause.page_number,
                  Clause.embedding).join(Document, Document.id == Clause.document_id).where(Document.user_id == user.id, Clause.embedding.is_not(None))
    if body.document_id:
        rows = rows.where(Clause.document_id == body.document_id)
    rows = (await db.execute(rows.order_by(Document.created_at, Clause.position).limit(3000))).all()  # ponytail: 3000 points max (SVD time and drawing)
    if not rows:
        return {"points": [], "query": None, "explained": [0, 0, 0], "dims": DIMS}
    X = np.vstack([r.embedding for r in rows]).astype(np.float64)
    mean = X.mean(axis=0)
    _, S, Vt = np.linalg.svd(X - mean, full_matrices=False)
    axes = np.vstack([Vt, np.zeros((3, X.shape[1]))])[:3]  # three strongest directions (zero-padded if fewer clauses than 3)
    xy = (X - mean) @ axes.T
    scale = float(np.abs(xy).max()) or 1.0
    var = np.concatenate([S**2, np.zeros(3)])[:3]
    explained = [float(v / (S**2).sum()) if (S**2).sum() else 0.0 for v in var]

    query, sims = None, None
    if body.query and (key := await openai_key(db, user.id)):
        try:
            q = np.array((await embed_texts(key, [body.query.strip()]))[0], dtype=np.float64)
            qx = ((q - mean) @ axes.T) / scale
            query = {"x": float(qx[0]), "y": float(qx[1]), "z": float(qx[2]), "text": body.query.strip()}
            sims = (X @ q) / (np.linalg.norm(X, axis=1) * np.linalg.norm(q) + 1e-12)  # true cosine in all 1536 dimensions
        except Exception as e:
            log.warning("map query embedding failed: %s", type(e).__name__)
    points = [{
        "document_id": str(r.document_id), "filename": r.filename, "position": r.position, "clause_identifier": r.clause_identifier,
        "title": r.title, "page_number": r.page_number, "x": float(xy[i, 0] / scale), "y": float(xy[i, 1] / scale), "z": float(xy[i, 2] / scale),
        "similarity": None if sims is None else round(float(sims[i]), 4),
    } for i, r in enumerate(rows)]
    return {"points": points, "query": query, "explained": explained, "dims": DIMS}
