"""The Ask pipeline with fake OpenAI calls. Run: uv run python -W ignore -m tests.integration.test_ask"""
import json
import uuid
import redis
from fastapi.testclient import TestClient
from app import ask, documents, embeddings
from app.auth import current_user
from app.config import settings
from app.database import AsyncSessionLocal, User
from app.graph import drop_user as drop_user_graph
from app.main import app
from tests.integration.test_parse import make_sample_pdf
from tests.integration.test_search import RESULT, fake_embed


def events(r):
    assert r.status_code == 200, r.text
    return [json.loads(l) for l in r.text.splitlines()]


if __name__ == "__main__":
    async def a_key(*_): return "sk-fake"
    async def no_key(*_): return None

    redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")  # the per-minute limit would trip on back-to-back runs
    with TestClient(app) as c:
        async def make_user():
            async with AsyncSessionLocal() as db:
                u = User(google_sub=f"test-ask-{uuid.uuid4().hex[:8]}", email="ask@example.com")
                db.add(u)
                await db.commit()
                return u

        async def drop(u):
            async with AsyncSessionLocal() as db:
                await drop_user_graph(u.id)
                await db.delete(await db.get(User, u.id))
                await db.commit()

        user = c.portal.call(make_user)
        try:
            embeddings.embed_texts = fake_embed
            embeddings.openai_key = documents.openai_key = ask.openai_key = a_key
            app.dependency_overrides[current_user] = lambda: user
            assert c.post("/documents", files={"file": ("a.pdf", make_sample_pdf(), "application/pdf")}, data={"result": json.dumps(RESULT)}).status_code == 201

            rewrites, grades = [], []
            async def fake_rewrite(_k, q): rewrites.append(q); return "terminate notice"
            async def fake_answer(_k, q, sources, **_):
                for t in ("Thirty days ", "[1]."):
                    yield t
            async def no_followups(*_): return []
            ask.followups = no_followups
            ask.rewrite, ask.answer_stream = fake_rewrite, fake_answer

            # 1. the first retrieval has a relevant clause: no rewrite
            async def grade_first(_k, q, hits):
                g = ask.Graded([0])
                g.reasons = {0: "States the notice period.", 1: "A different subject: payment."}
                return g
            ask.grade = grade_first
            ev = events(c.post("/ask", json={"question": "terminate notice"}))
            kinds = [e["event"] for e in ev]
            assert kinds == ["retrieved", "graded", "sources", "token", "token", "done"], kinds
            assert ev[2]["sources"][0]["clause_identifier"] == "1" and "".join(e["text"] for e in ev if e["event"] == "token") == "Thirty days [1]."
            assert not rewrites
            assert ev[1]["reasons"] == {"0": "States the notice period.", "1": "A different subject: payment."}, ev[1]  # the reasons reach the browser
            sid = ev[-1]["session_id"]
            saved = c.get(f"/sessions/{sid}").json()
            assert saved["kind"] == "ask" and saved["data"]["answer"] == "Thirty days [1]." and saved["data"]["sources"][0]["content"]
            assert saved["data"]["attempts"][0]["relevant"] == [0] and saved["data"]["attempts"][0]["reasons"]["1"].startswith("A different")  # and the saved history
            assert events(c.post("/ask", json={"question": "terminate notice"}))[-1]["session_id"] == sid  # re-run: same session, no copy

            # 2. nothing relevant at first, relevant after one rewrite
            async def grade_after_rewrite(_k, q, hits): return [] if q != "terminate notice" else [0]
            ask.grade = grade_after_rewrite
            kinds = [e["event"] for e in events(c.post("/ask", json={"question": "how do we part ways"}))]
            assert kinds == ["retrieved", "graded", "rewritten", "retrieved", "graded", "sources", "token", "token", "done"], kinds
            assert rewrites == ["how do we part ways"]

            # 3. still nothing after the rewrite: says so, and never calls the answer model
            async def grade_none(_k, q, hits): return []
            async def boom(*_): raise AssertionError("answer model must not run without sources"); yield
            ask.grade, ask.answer_stream = grade_none, boom
            ev = events(c.post("/ask", json={"question": "who owns the moon"}))
            assert [e["event"] for e in ev][-4:] == ["sources", "token", "followups", "done"] and ev[-3]["text"] == ask.NONE_FOUND and ev[-4]["sources"] == [] and ev[-2]["questions"][0] == "List my contracts"

            # 4. an OpenAI failure arrives as an error event, not a broken stream
            async def grade_fail(*_): raise RuntimeError("x")
            ask.grade = grade_fail
            assert events(c.post("/ask", json={"question": "terminate notice"}))[-1]["event"] == "error"

            assert len(c.get("/sessions").json()) == 3  # the three finished questions; the failed one is not saved
            assert c.delete(f"/sessions/{sid}").status_code == 204 and c.get(f"/sessions/{sid}").status_code == 404

            # 5. no key: refused up front
            ask.openai_key = no_key
            assert c.post("/ask", json={"question": "terminate notice"}).status_code == 400
            print("ok: ask, rewrite once, no-evidence, error event, no key")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, user)
