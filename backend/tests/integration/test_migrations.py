"""Migrations build the same schema as the real database, from nothing, and can be re-run.
Run: uv run python -W ignore -m tests.integration.test_migrations (creates and drops a scratch database)"""
import asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings
from app.main import BACKEND

SCRATCH = "jurion_migrate_scratch"
TABLES = "('users','llm_api_keys','documents','clauses','query_sessions')"
COLUMNS = f"SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN {TABLES} ORDER BY 1,2"
INDEXES = f"SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN {TABLES} AND indexname NOT LIKE '%pkey' ORDER BY 1,2"


def upgrade(url: str, rev: str = "head"):
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, rev)
    return cfg


async def snapshot(url: str):
    e = create_async_engine(url)
    async with e.connect() as c:
        out = [[tuple(r) for r in (await c.execute(text(q))).all()] for q in (COLUMNS, INDEXES)]
    await e.dispose()
    return out


async def main():
    real = make_url(settings.DATABASE_URL)
    scratch = real.set(database=SCRATCH)
    admin = create_async_engine(real, isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH}"))
        await c.execute(text(f"CREATE DATABASE {SCRATCH}"))
    try:
        url = scratch.render_as_string(hide_password=False)
        cfg = await asyncio.to_thread(upgrade, url)  # an empty database -> head
        await asyncio.to_thread(upgrade, url)  # again: nothing to do, nothing breaks
        fresh = await snapshot(url)
        assert fresh == await snapshot(settings.DATABASE_URL), "migrations from nothing differ from the real database's schema"
        assert any(i[1] == "ux_documents_user_sha256" for i in fresh[1]), "the unique index is missing"
        await asyncio.to_thread(command.downgrade, cfg, "0001")  # the newest revision reverses...
        assert not any(i[1] == "ux_documents_user_sha256" for i in (await snapshot(url))[1])
        await asyncio.to_thread(command.upgrade, cfg, "head")  # ...and re-applies
        assert any(i[1] == "ux_documents_user_sha256" for i in (await snapshot(url))[1])
        print(f"ok: empty database -> head matches the real schema ({len(fresh[0])} columns, {len(fresh[1])} indexes); re-run, downgrade and upgrade work")
    finally:
        async with admin.connect() as c:
            await c.execute(text(f"DROP DATABASE IF EXISTS {SCRATCH} WITH (FORCE)"))
        await admin.dispose()


if __name__ == "__main__":
    asyncio.run(main())
