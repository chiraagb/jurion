"""Per-user switches (app/core/preferences.py): saved on the user, applied to Ask, and the reranker refused when it cannot run.
Run: uv run python -W ignore -m tests.integration.test_preferences
"""
import json
import uuid
import redis
from fastapi.testclient import TestClient
from app.ask import tools
from app.ask import workflow as ask
from app.core.auth import current_user
from app.core.config import settings
from app.core.database import AsyncSessionLocal, User
from app.core.preferences import Prefs
from app.ingestion import documents
from app.main import app
from app.search import embeddings, rerank
from app.search.graph import drop_user as drop_user_graph
from tests.integration.test_ask import events
from tests.integration.test_parse import make_sample_pdf
from tests.integration.test_search import RESULT, fake_embed

if __name__ == "__main__":
    async def a_key(*_): return "sk-fake"

    # unit: switched-off steps are never offered to the agent
    assert tools.off(Prefs()) == set() and tools.off(Prefs(widen=False, facts=False)) == {"follow_references", "company_info"}
    names = [t.name for t in tools._tool_objects(True, Prefs(widen=False))]
    assert "follow_references" not in names and "company_info" in names and "search_clauses" in names, names

    redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")
    with TestClient(app) as c:
        async def make_user():
            async with AsyncSessionLocal() as db:
                u = User(google_sub=f"test-prefs-{uuid.uuid4().hex[:8]}", email="prefs@example.com")
                db.add(u)
                await db.commit()
                return u

        async def fresh(uid):  # the real current_user loads the user on every request; the override must too
            async with AsyncSessionLocal() as db:
                return await db.get(User, uid)

        async def drop(u):
            async with AsyncSessionLocal() as db:
                await drop_user_graph(u.id)
                await db.delete(await db.get(User, u.id))
                await db.commit()

        user = c.portal.call(make_user)
        saved = (ask.openai_key, ask.followups, ask.grade, ask.answer_stream, ask.widen, rerank.unavailable)
        try:
            embeddings.embed_texts = fake_embed
            embeddings.openai_key = documents.openai_key = ask.openai_key = a_key
            async def signed_in():
                return await fresh(user.id)
            app.dependency_overrides[current_user] = signed_in
            assert c.post("/documents", files={"file": ("a.pdf", make_sample_pdf(), "application/pdf")}, data={"result": json.dumps(RESULT)}).status_code == 201

            calls = {"followups": 0, "widen": 0}

            async def count_followups(*_):
                calls["followups"] += 1
                return ["What else?"]

            async def count_widen(s, sources, *a):
                calls["widen"] += 1
                return []

            async def answer(_k, q, sources, **kw):
                yield "Thirty days [1]."

            async def grade_first(_k, q, hits):
                return ask.Graded([0])

            ask.followups, ask.widen, ask.answer_stream, ask.grade = count_followups, count_widen, answer, grade_first

            # 1. defaults: everything on, the reranker as the server is set
            got = c.get("/settings/preferences").json()
            assert got["preferences"] == {"rerank": settings.SEARCH_RERANK, "followups": True, "widen": True, "facts": True}, got
            ev = [e["event"] for e in events(c.post("/ask", json={"question": "terminate notice"}))]
            assert "followups" in ev and calls == {"followups": 1, "widen": 1}, (ev, calls)

            # 2. switched off: saved on the account, and Ask skips those steps
            got = c.put("/settings/preferences", json={"followups": False, "widen": False}).json()
            assert got["preferences"]["followups"] is False and got["preferences"]["widen"] is False and got["preferences"]["facts"] is True, got
            assert c.portal.call(fresh, user.id).preferences == {"followups": False, "widen": False}  # only what was sent is stored
            ev = [e["event"] for e in events(c.post("/ask", json={"question": "terminate notice"}))]
            assert "followups" not in ev and calls == {"followups": 1, "widen": 1}, (ev, calls)
            c.put("/settings/preferences", json={"facts": False})  # a second save keeps the first one's switches
            assert c.get("/settings/preferences").json()["preferences"] == {"rerank": settings.SEARCH_RERANK, "followups": False, "widen": False, "facts": False}

            # 3. the reranker cannot be switched on where it cannot run, and the reason is shown
            rerank.unavailable = lambda: "The model is not downloaded."
            r = c.put("/settings/preferences", json={"rerank": True})
            assert r.status_code == 400 and "not downloaded" in r.json()["detail"], r.text
            assert c.get("/settings/preferences").json()["rerank_unavailable"] == "The model is not downloaded."
            rerank.unavailable = lambda: None
            assert c.put("/settings/preferences", json={"rerank": True}).json()["preferences"]["rerank"] is True
            print("ok: preferences saved per user, Ask skips switched-off steps, agent tools hidden, reranker refused when unavailable")
        finally:
            ask.openai_key, ask.followups, ask.grade, ask.answer_stream, ask.widen, rerank.unavailable = saved
            app.dependency_overrides.clear()
            c.portal.call(drop, user)
