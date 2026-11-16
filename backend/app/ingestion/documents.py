"""Saved contracts: a parsed result plus the original PDF, always scoped to the signed-in user."""
import hashlib
import logging
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError
from pgvector.sqlalchemy import Vector
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import current_user
from app.core.database import Clause, Document, User, get_db
from app.search.embeddings import embed_document, openai_key
from app.search.graph import build_graph, drop_document, read_graph
from app.core.ratelimit import limit
from app.ingestion.parser import MAX_PDF_BYTES, _read_lines, clause_boxes, count_pages, run_pdf, stored_lines

router = APIRouter(prefix="/documents")
log = logging.getLogger("jurion")


class ClauseIn(BaseModel):
    clause_identifier: str = Field(max_length=64)
    title: str
    content: str
    page_number: int | None = None
    parent_identifier: str | None = Field(default=None, max_length=64)
    start_line: int | None = Field(default=None, ge=0)
    end_line: int | None = None


class ResultIn(BaseModel):
    method: str = Field(max_length=16)
    total_ms: float = 0
    confidence: dict | None = None
    clauses: list[ClauseIn] = Field(min_length=1, max_length=5000)


def _why(e: Exception) -> str:
    """What went wrong with an OpenAI call, in words the user can act on (shown after saving)."""
    return {"AuthenticationError": "OpenAI rejected your API key", "RateLimitError": "OpenAI says your key is out of quota or rate-limited"}.get(type(e).__name__, f"the OpenAI call failed ({type(e).__name__})")


def _summary(doc: Document, clause_count: int, embedded: int = 0, warnings: list[str] | None = None) -> dict:
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "size_bytes": doc.size_bytes,
        "pages": doc.pages,
        "method": doc.method,
        "confidence": doc.confidence,
        "clause_count": clause_count,
        "embedded_count": embedded,
        "graph_parties": doc.graph_parties,
        "graph_refs": doc.graph_refs,
        "created_at": doc.created_at.isoformat(),
        "warnings": warnings or [],  # things that did not work on save (the contract itself is saved)
    }


async def _owned(db: AsyncSession, user: User, doc_id: uuid.UUID) -> Document:
    doc = await db.get(Document, doc_id)
    if not doc or doc.user_id != user.id:  # same 404 for "missing" and "not yours"
        raise HTTPException(404, "Contract not found")
    return doc


@router.post("", status_code=201)
async def save_document(
    file: UploadFile = File(...),
    result: str = Form(...),
    replace: bool = Form(False),  # the same file is already saved: replace it with this result instead of refusing
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(limit("save", 20, 60, by_user=True)),
):
    pdf = await file.read(MAX_PDF_BYTES + 1)
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF is larger than 25 MB")
    if not pdf.startswith(b"%PDF"):
        raise HTTPException(415, "File is not a PDF")
    digest = hashlib.sha256(pdf).hexdigest()
    same = (await db.execute(
        select(Document.id, Document.filename, Document.created_at).where(Document.user_id == user.id, Document.sha256 == digest)
    )).all()
    if same and not replace:
        first = same[0]  # checked before the slow PDF read: a duplicate costs almost nothing
        return JSONResponse(status_code=409, content={
            "detail": f"You already saved this contract as \u201c{first.filename}\u201d.",
            "existing": {"id": str(first.id), "filename": first.filename, "created_at": first.created_at.isoformat()},
        })
    try:
        data = ResultIn.model_validate_json(result)
    except ValidationError as e:
        raise HTTPException(422, f"Invalid parse result: {e.errors()[0]['msg']}")
    try:
        pages = await run_pdf(count_pages, pdf)
        # ponytail: the PDF is read a second time here (about 2s with many tables); cache the lines from /parse if it hurts
        read = await run_pdf(_read_lines, pdf)
    except Exception as e:
        raise HTTPException(422, f"Could not open PDF: {e}")
    lines = stored_lines(read) if read else None  # null for a scan with no text layer
    for c in data.clauses:
        if lines is None:
            c.start_line = c.end_line = None
        elif (c.start_line is None) != (c.end_line is None) or (
            c.start_line is not None and not 0 <= c.start_line < c.end_line <= len(lines)
        ):
            raise HTTPException(422, f"Clause {c.clause_identifier}: line range does not fit the document")

    doc = Document(
        user_id=user.id, filename=(file.filename or "contract.pdf")[:255], size_bytes=len(pdf), pages=pages,
        method=data.method, total_ms=data.total_ms, confidence=data.confidence, pdf=pdf, lines=lines, sha256=digest,
    )
    try:
        if same:  # replace: the old copies go, in the same transaction as the new one (clauses follow by ON DELETE CASCADE)
            await db.execute(delete(Document).where(Document.id.in_([r.id for r in same])))
        db.add(doc)
        await db.flush()  # assigns doc.id for the clause rows
        db.add_all(Clause(document_id=doc.id, position=i, **c.model_dump()) for i, c in enumerate(data.clauses))
        await db.commit()
    except IntegrityError:
        # The check above passed, but another save of the same file got in first: the unique index (migration 0002) refused this one.
        await db.rollback()
        first = (await db.execute(
            select(Document.id, Document.filename, Document.created_at).where(Document.user_id == user.id, Document.sha256 == digest)
        )).first()
        if not first:
            raise
        return JSONResponse(status_code=409, content={
            "detail": f"You already saved this contract as \u201c{first.filename}\u201d.",
            "existing": {"id": str(first.id), "filename": first.filename, "created_at": first.created_at.isoformat()},
        })
    await db.refresh(doc)
    embedded, warnings = 0, []
    key = await openai_key(db, user.id)
    fix = "Fix the key (key icon, top bar), then press Embed and Build graph on My contracts."
    if not key:
        warnings.append(f"No OpenAI key is saved, so this contract was not embedded and its companies were not found. Add a key (key icon, top bar), then press Embed and Build graph on My contracts.")
    else:  # a failed embedding never fails the save: the contract stays, and the Contracts page offers "Embed"
        try:
            embedded = await embed_document(db, key, doc.id)
        except Exception as e:
            log.warning("embedding on save failed: %s", type(e).__name__)
            warnings.append(f"Not embedded: {_why(e)}. {fix}")
    try:  # same for the graph (works without a key too, but then holds references only)
        await build_graph(db, key, doc)
        await db.refresh(doc)
    except Exception as e:
        log.warning("graph on save failed: %s", type(e).__name__)
        if key and len(warnings) < 2 and not any(_why(e) in w for w in warnings):
            warnings.append(f"No graph: {_why(e)}. {fix}")
    for old in same:  # replaced copies leave the graph too
        await drop_document(old.id, user.id)
    return _summary(doc, len(data.clauses), embedded, warnings)


@router.get("")
async def list_documents(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(Document, func.count(Clause.id), func.count(Clause.embedding))
        .outerjoin(Clause, Clause.document_id == Document.id)
        .where(Document.user_id == user.id)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    )
    return [_summary(doc, n, e) for doc, n, e in rows.all()]


@router.get("/{doc_id}")
async def get_document(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await _owned(db, user, doc_id)
    clauses = (await db.execute(select(Clause).where(Clause.document_id == doc.id).order_by(Clause.position))).scalars().all()
    # first 8 of the 1536 numbers, enough for the UI's embedding inspector without shipping every vector
    heads = dict((await db.execute(
        select(Clause.id, func.subvector(Clause.embedding, 1, 8, type_=Vector(8))).where(Clause.document_id == doc.id, Clause.embedding.is_not(None))
    )).all())
    return {
        **_summary(doc, len(clauses), len(heads)),
        "total_ms": doc.total_ms,
        "clauses": [
            {k: getattr(c, k) for k in ("clause_identifier", "title", "content", "page_number", "parent_identifier", "start_line", "end_line")}
            | {"embedding_preview": [round(float(x), 4) for x in heads[c.id]] if c.id in heads else None}
            for c in clauses
        ],
    }


@router.post("/{doc_id}/embed")
async def embed(
    doc_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(limit("embed", 20, 60, by_user=True)),
):
    """(Re-)embeds every clause of one saved contract with the user's OpenAI key."""
    doc = await _owned(db, user, doc_id)
    key = await openai_key(db, user.id)
    if not key:
        raise HTTPException(400, "Save an OpenAI key (key icon, top bar) to create embeddings.")
    try:
        n = await embed_document(db, key, doc.id)
    except Exception as e:
        log.warning("embed failed: %s", type(e).__name__)
        raise HTTPException(502, f"OpenAI embedding call failed ({type(e).__name__}). Check the key and try again.")
    return {"embedded_count": n}


@router.get("/{doc_id}/clauses/{position}/boxes")
async def get_clause_boxes(doc_id: uuid.UUID, position: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Where a clause sits on its PDF pages, so the viewer can highlight it. Empty for scans and for contracts saved without line ranges."""
    doc = await _owned(db, user, doc_id)
    clause = (await db.execute(select(Clause).where(Clause.document_id == doc.id, Clause.position == position))).scalar()
    if not clause:
        raise HTTPException(404, "Clause not found")
    await db.refresh(doc, ["pdf", "lines"])
    if not doc.lines or clause.start_line is None:
        return {"boxes": []}
    pages: dict[int, list] = {}
    for l in doc.lines[clause.start_line : clause.end_line]:
        pages.setdefault(l["p"], []).append(l)
    spans = [(p, min(l["x"] for l in ls), min(l["y"] for l in ls), max(l["y1"] for l in ls)) for p, ls in sorted(pages.items())]
    try:
        return {"boxes": await run_pdf(clause_boxes, doc.pdf, spans)}
    except Exception as e:
        raise HTTPException(422, f"Could not read the PDF: {e}")


@router.post("/{doc_id}/graph")
async def make_graph(
    doc_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(limit("graph", 20, 60, by_user=True)),
):
    """(Re)builds this contract's graph: parties (needs an OpenAI key) and cross-references."""
    doc = await _owned(db, user, doc_id)
    try:
        return await build_graph(db, await openai_key(db, user.id), doc)
    except Exception as e:
        log.warning("graph build failed: %s", type(e).__name__)
        raise HTTPException(502, f"Could not build the graph ({type(e).__name__}). Is Neo4j running, and is the OpenAI key valid?")


@router.get("/{doc_id}/graph")
async def get_graph(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await _owned(db, user, doc_id)
    if doc.graph_parties is None:
        return {"built": False, "parties": [], "references": []}
    try:
        return {"built": True, **await read_graph(doc.id)}
    except Exception as e:
        raise HTTPException(502, f"Neo4j is unavailable ({type(e).__name__}).")


@router.get("/{doc_id}/clauses/{position}/similar")
async def similar_clauses(doc_id: uuid.UUID, position: int, limit: int = 5, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """The clauses in the user's OTHER contracts whose meaning is closest to this one (cosine similarity of the stored vectors),
    for reading how different contracts handle the same thing."""
    doc = await _owned(db, user, doc_id)
    clause = (await db.execute(select(Clause).where(Clause.document_id == doc.id, Clause.position == position))).scalar()
    if not clause:
        raise HTTPException(404, "Clause not found")
    await db.refresh(clause, ["embedding"])
    if clause.embedding is None:
        return {"embedded": False, "similar": []}
    dist = Clause.embedding.cosine_distance(clause.embedding)
    rows = (await db.execute(
        select(Clause.document_id, Document.filename, Clause.position, Clause.clause_identifier, Clause.title, Clause.page_number, Clause.content, dist.label("d"))
        .join(Document, Document.id == Clause.document_id)
        .where(Document.user_id == user.id, Document.id != doc.id, Clause.embedding.is_not(None)).order_by(dist).limit(max(1, min(limit, 10)))
    )).all()
    return {"embedded": True, "similar": [
        {"document_id": str(r.document_id), "filename": r.filename, "position": r.position, "clause_identifier": r.clause_identifier, "title": r.title,
         "page_number": r.page_number, "content": r.content[:3000], "similarity": round(1 - r.d, 4)} for r in rows]}


@router.get("/{doc_id}/pdf")
async def get_pdf(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await _owned(db, user, doc_id)
    await db.refresh(doc, ["pdf"])  # deferred column: load it explicitly
    return Response(doc.pdf, media_type="application/pdf")


@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.delete(await _owned(db, user, doc_id))  # clauses go with it (ON DELETE CASCADE)
    await db.commit()
    await drop_document(doc_id, user.id)
