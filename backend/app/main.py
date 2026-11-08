import asyncio
import logging
import time
from pathlib import Path
from contextlib import asynccontextmanager
from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import llm_keys
from app.auth import current_user, router as auth_router
from app.database import User, neo4j_driver, redis_client, get_db
from app.config import settings
from app.documents import router as documents_router
from app.embeddings import router as search_router
from app.ask import router as ask_router
from app.graph import ensure_schema
from app.reconcile import reconcile_graph
from app.sessions import router as sessions_router
from app.evaluation import router as evaluation_router
from app.hybrid_parser import MAX_PDF_BYTES, PROVIDERS, NoApiKey, count_pages, parse_contract_fast, run_pdf
from app.ratelimit import limit


def run_migrations() -> None:
    """Brings the database to the latest schema (migrations/versions). Safe to run on every start: already-applied revisions are skipped."""
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema changes are Alembic migrations. A down database must not stop the API from starting. Run in a thread: Alembic starts its own event loop.
    try:
        await asyncio.to_thread(run_migrations)
    except Exception:
        log.exception("Could not run the database migrations")
    await ensure_schema()
    try:
        await reconcile_graph()  # clears graph leftovers for contracts that no longer exist
    except Exception as e:
        log.warning("graph reconcile skipped: %s", type(e).__name__)
    yield


BACKEND = Path(__file__).resolve().parent.parent
logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("jurion")
log.setLevel(logging.INFO)  # our own lines at INFO; libraries only when something is wrong

app = FastAPI(title="Jurion Legal Intelligence API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(documents_router)
app.include_router(search_router)
app.include_router(ask_router)
app.include_router(sessions_router)
app.include_router(evaluation_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def check_pg(db: AsyncSession) -> bool:
    try:
        res = await asyncio.wait_for(db.execute(text("SELECT 1")), timeout=2.0)
        return bool(res.scalar())
    except Exception:
        return False


async def check_neo4j() -> bool:
    try:
        async with neo4j_driver.session() as session:
            res = await asyncio.wait_for(session.run("RETURN 1 AS alive"), timeout=2.0)
            record = await res.single()
            return record["alive"] == 1 if record else False
    except Exception:
        return False


async def check_redis() -> bool:
    try:
        await asyncio.wait_for(redis_client.set("ping", "pong", ex=5), timeout=2.0)
        val = await asyncio.wait_for(redis_client.get("ping"), timeout=2.0)
        return val == "pong"
    except Exception:
        return False


@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    pg_ok, neo4j_ok, redis_ok = await asyncio.gather(
        check_pg(db), check_neo4j(), check_redis(), return_exceptions=True
    )

    return {
        "status": "online",
        "postgres_vector": pg_ok is True,
        "neo4j": neo4j_ok is True,
        "redis": redis_ok is True,
    }


class KeyIn(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)


def _provider(name: str) -> str:
    if name not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider. Use one of: {', '.join(PROVIDERS)}")
    return name


@app.get("/settings/llm")
async def list_llm_keys(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Which providers have a saved key, as masked hints only."""
    try:
        return {"keys": await llm_keys.key_hints(db, user.id), "server_openai": bool(settings.OPENAI_API_KEY)}
    except Exception as e:
        raise HTTPException(503, f"Database unavailable: {e}")


@app.put("/settings/llm/{provider}")
async def save_llm_key(
    provider: str, body: KeyIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    try:
        return {"provider": _provider(provider), "hint": await llm_keys.save_key(db, user.id, provider, body.api_key.strip())}
    except RuntimeError as e:  # ENCRYPTION_KEY missing
        raise HTTPException(503, str(e))


@app.delete("/settings/llm/{provider}", status_code=204)
async def delete_llm_key(provider: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await llm_keys.delete_key(db, user.id, _provider(provider))


@app.post("/parse")
async def parse_pdf(
    file: UploadFile = File(...),
    force_llm: bool = False,  # ?force_llm=true: use the AI's headings even when the local parse looks fine
    x_llm_provider: str | None = Header(None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(limit("parse", 10, 60, by_user=True)),
):
    """Parses an uploaded contract PDF into clauses. Nothing is persisted yet.
    The fallback provider comes from X-LLM-Provider; the signed-in user's key is read (decrypted) from Postgres, else the server .env."""
    started = time.perf_counter()
    pdf_bytes = await file.read(MAX_PDF_BYTES + 1)

    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF is larger than 25 MB")
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(415, "File is not a PDF")

    try:
        pages = await run_pdf(count_pages, pdf_bytes)
    except Exception as e:
        raise HTTPException(422, f"Could not open PDF: {e}")

    try:
        stored_key = await llm_keys.load_key(db, user.id, x_llm_provider) if x_llm_provider in PROVIDERS else None
    except Exception:  # DB down or ENCRYPTION_KEY missing: fall back to the .env key
        stored_key = None

    try:
        result = await parse_contract_fast(pdf_bytes, x_llm_provider, stored_key, force_llm)
    except NoApiKey as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.warning("parse failed: user=%s pages=%s %s", user.id, pages, type(e).__name__)
        raise HTTPException(
            422, f"Layout too ambiguous for the local parser and the LLM fallback failed: {e}"
        )

    conf = result["confidence"]
    log.info(
        "parsed user=%s pages=%s clauses=%s method=%s score=%s steps=%s ms=%s", user.id, pages, len(result["clauses"]),
        result["method"], conf and conf["score"], [(s["name"], s["status"]) for s in result["steps"]],
        round((time.perf_counter() - started) * 1000),
    )
    return {
        "filename": file.filename,
        "size_bytes": len(pdf_bytes),
        "pages": pages,
        "total_ms": round((time.perf_counter() - started) * 1000, 1),
        **result,
    }
