import asyncio
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import neo4j_driver, redis_client, get_db

app = FastAPI(title="Jurion Legal Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
