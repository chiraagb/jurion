"""Saved contracts: a parsed result plus the original PDF, always scoped to the signed-in user."""
import asyncio
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import current_user
from app.database import Clause, Document, User, get_db
from app.hybrid_parser import MAX_PDF_BYTES, _pdf_executor, count_pages

router = APIRouter(prefix="/documents")


class ClauseIn(BaseModel):
    clause_identifier: str = Field(max_length=64)
    title: str
    content: str
    page_number: int | None = None
    parent_identifier: str | None = Field(default=None, max_length=64)


class ResultIn(BaseModel):
    method: str = Field(max_length=16)
    total_ms: float = 0
    confidence: dict | None = None
    clauses: list[ClauseIn] = Field(min_length=1, max_length=5000)


def _summary(doc: Document, clause_count: int) -> dict:
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "size_bytes": doc.size_bytes,
        "pages": doc.pages,
        "method": doc.method,
        "confidence": doc.confidence,
        "clause_count": clause_count,
        "created_at": doc.created_at.isoformat(),
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
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    pdf = await file.read(MAX_PDF_BYTES + 1)
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF is larger than 25 MB")
    if not pdf.startswith(b"%PDF"):
        raise HTTPException(415, "File is not a PDF")
    try:
        data = ResultIn.model_validate_json(result)
    except ValidationError as e:
        raise HTTPException(422, f"Invalid parse result: {e.errors()[0]['msg']}")
    try:
        pages = await asyncio.get_running_loop().run_in_executor(_pdf_executor, count_pages, pdf)
    except Exception as e:
        raise HTTPException(422, f"Could not open PDF: {e}")

    doc = Document(
        user_id=user.id, filename=(file.filename or "contract.pdf")[:255], size_bytes=len(pdf), pages=pages,
        method=data.method, total_ms=data.total_ms, confidence=data.confidence, pdf=pdf,
    )
    db.add(doc)
    await db.flush()  # assigns doc.id for the clause rows
    db.add_all(Clause(document_id=doc.id, position=i, **c.model_dump()) for i, c in enumerate(data.clauses))
    await db.commit()
    await db.refresh(doc)
    return _summary(doc, len(data.clauses))


@router.get("")
async def list_documents(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(Document, func.count(Clause.id))
        .outerjoin(Clause, Clause.document_id == Document.id)
        .where(Document.user_id == user.id)
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    )
    return [_summary(doc, n) for doc, n in rows.all()]


@router.get("/{doc_id}")
async def get_document(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await _owned(db, user, doc_id)
    clauses = (await db.execute(select(Clause).where(Clause.document_id == doc.id).order_by(Clause.position))).scalars().all()
    return {
        **_summary(doc, len(clauses)),
        "total_ms": doc.total_ms,
        "clauses": [
            {k: getattr(c, k) for k in ("clause_identifier", "title", "content", "page_number", "parent_identifier")}
            for c in clauses
        ],
    }


@router.get("/{doc_id}/pdf")
async def get_pdf(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    doc = await _owned(db, user, doc_id)
    await db.refresh(doc, ["pdf"])  # deferred column: load it explicitly
    return Response(doc.pdf, media_type="application/pdf")


@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.delete(await _owned(db, user, doc_id))  # clauses go with it (ON DELETE CASCADE)
    await db.commit()
