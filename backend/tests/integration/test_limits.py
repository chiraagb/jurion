"""Resource limits. Run: uv run python -m tests.integration.test_limits"""
import asyncio
import os
import time
import uuid

import pymupdf
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

os.environ["MAX_PAGES"] = "2"  # read by the worker processes, which are spawned later
from app.config import settings  # noqa: E402
from app.hybrid_parser import count_pages, run_pdf  # noqa: E402
from app.ratelimit import limit  # noqa: E402


def pdf(pages: int) -> bytes:
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page().insert_text((72, 72), "hello")
    return doc.tobytes()


async def workers():
    assert await run_pdf(count_pages, pdf(2)) == 2
    try:
        await run_pdf(count_pages, pdf(3))
        raise SystemExit("3 pages should be over the limit of 2")
    except ValueError as e:
        assert "limit is 2" in str(e), e

    settings.PARSE_TIMEOUT_S = 1  # a stuck worker is killed, and the next call gets a fresh pool
    t = time.time()
    try:
        await run_pdf(time.sleep, 30)
        raise SystemExit("should have timed out")
    except ValueError as e:
        assert "longer than 1s" in str(e), e
    assert time.time() - t < 5
    settings.PARSE_TIMEOUT_S = 45
    assert await run_pdf(count_pages, pdf(1)) == 1


if __name__ == "__main__":
    asyncio.run(workers())

    app = FastAPI()
    name = f"t-{uuid.uuid4().hex[:8]}"  # fresh counter each run
    app.get("/x")(lambda _=Depends(limit(name, 2, 60)): "ok")
    with TestClient(app) as c:
        codes = [c.get("/x").status_code for _ in range(3)]
        assert codes == [200, 200, 429], codes
        assert c.get("/x").headers["Retry-After"] == "60"
    print("ok: page cap, stuck worker killed and replaced, rate limit")
