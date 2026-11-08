"""Saves the evaluation contracts (public SEC exhibits from the CUAD dataset, in tests/corpus_big/, not committed) into an account,
through the same steps as the app: parse locally, store the text and line ranges, embed, build the graph. Idempotent.

  uv run python -W ignore -m tests.qa.load_corpus            # into the account that owns the first saved contract
Needs that account to have an OpenAI key saved (embeddings and party extraction). Costs a few cents."""
import asyncio
import hashlib
import sys
from pathlib import Path
from sqlalchemy import select
from app.database import AsyncSessionLocal, Clause, Document, neo4j_driver
from app.embeddings import embed_document, openai_key
from app.graph import build_graph
from app.hybrid_parser import _read_lines, count_pages, local_fast_parse, stored_lines

CUAD = Path(__file__).resolve().parent.parent / "corpus_big" / "CUAD_v1"
# File-name starts of well-parsed contracts of different kinds (cooperation, sponsorship, development, endorsement, outsourcing, hosting...).
FILES = [
    "ELFBEAUTY,INC_07_02_2020-EX-10.1", "N2KINC_10_16_1997-EX-10.16", "VgrabCommunicationsInc_20200129", "PerformanceSportsBrandsInc_20110909",
    "PhotronicsInc_20171219", "HfEnterprisesInc_20191223", "ArmstrongFlooringInc_20190107", "BIOAMBERINC_04_10_2013", "CORIOINC_07_20_2000",
    "StampscomInc_20001114",
]
CLAUSE_FIELDS = ("clause_identifier", "title", "content", "page_number", "parent_identifier", "start_line", "end_line")


async def main() -> None:
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(Document.user_id).order_by(Document.created_at).limit(1))).scalar()
        key = await openai_key(db, owner) if owner else None
        if not key:
            sys.exit("Need an account with a saved contract and an OpenAI key.")
        for prefix in FILES:
            pdf = next((p for p in CUAD.rglob("*") if p.suffix.lower() == ".pdf" and p.name.startswith(prefix)), None)
            if not pdf:
                print(f"missing   {prefix}")
                continue
            data = pdf.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            if (await db.execute(select(Document.id).where(Document.user_id == owner, Document.sha256 == digest))).first():
                print(f"have      {pdf.name[:60]}")
                continue
            parsed = local_fast_parse(data)
            read = _read_lines(data)
            if not parsed or not read:
                print(f"no parse  {pdf.name[:60]}")
                continue
            clauses, conf = parsed
            doc = Document(user_id=owner, filename=pdf.name[:255], size_bytes=len(data), pages=count_pages(data), method="local", total_ms=0,
                           confidence=conf, pdf=data, lines=stored_lines(read), sha256=digest)
            db.add(doc)
            await db.flush()
            db.add_all(Clause(document_id=doc.id, position=i, **{k: c.get(k) for k in CLAUSE_FIELDS}) for i, c in enumerate(clauses))
            await db.commit()
            await embed_document(db, key, doc.id)
            counts = await build_graph(db, key, doc)
            print(f"saved     {pdf.name[:50]:<52} {len(clauses):>4} clauses, graph {counts}")
    await neo4j_driver.close()


if __name__ == "__main__":
    asyncio.run(main())
