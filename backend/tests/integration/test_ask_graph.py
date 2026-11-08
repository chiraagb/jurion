"""Ask using the graph: narrow to the contract the question names, fall back to all, and widen by cross-reference.
Fake OpenAI calls, real Postgres and Neo4j. Run: uv run python -W ignore -m tests.integration.test_ask_graph"""
import json
import uuid
import redis
from fastapi.testclient import TestClient
from app import ask, documents, embeddings, graph
from app.auth import current_user
from app.config import settings
from app.database import AsyncSessionLocal, User
from app.graph import drop_user as drop_user_graph
from app.main import app
from tests.integration.test_parse import make_number_column_pdf, make_sample_pdf
from tests.integration.test_search import fake_embed


def result(party_clause: str):
    return {"method": "local", "total_ms": 1, "confidence": None, "clauses": [
        {"clause_identifier": "1", "title": "TERMINATION", "content": f"1. TERMINATION\n{party_clause} may terminate this agreement on notice, subject to Section 2.", "page_number": 1},
        {"clause_identifier": "2", "title": "FEES", "content": "2. FEES\nOn termination all unpaid fees are due within thirty days.", "page_number": 1}]}


def events(r):
    assert r.status_code == 200, r.text
    return [json.loads(l) for l in r.text.splitlines()]


if __name__ == "__main__":
    async def a_key(*_): return "sk-fake"

    async def fake_parties(_key, text):
        who = "Acme Bank" if "Bank" in text else "Zeta Foods"
        return [graph.Party(name=who, role="Customer", aliases=[])]

    async def fake_scope(_key, q, cards):  # "the bank" -> the contract whose party is a bank
        return [i for i, c in enumerate(cards) if "bank" in q.lower() and any("Bank" in p["name"] for p in c["parties"])]

    async def zero(*_): return 0
    embeddings.embed_texts = fake_embed
    embeddings.openai_key = documents.openai_key = ask.openai_key = a_key
    graph.extract_parties = fake_parties
    documents.embed_document = zero
    ask.scope = fake_scope
    async def rewrite(_k, q): return q
    ask.rewrite = rewrite
    async def answer(_k, q, sources):
        yield "ok"
    ask.answer_stream = answer

    redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")
    with TestClient(app) as c:
        async def make_user():
            async with AsyncSessionLocal() as db:
                u = User(google_sub=f"test-askgraph-{uuid.uuid4().hex[:8]}", email="ag@example.com")
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
            app.dependency_overrides[current_user] = lambda: user
            bank = c.post("/documents", files={"file": ("bank.pdf", make_sample_pdf(), "application/pdf")}, data={"result": json.dumps(result("The Bank"))}).json()
            food = c.post("/documents", files={"file": ("food.pdf", make_number_column_pdf(), "application/pdf")}, data={"result": json.dumps(result("The Supplier"))}).json()
            assert bank["graph_refs"] == 1 and food["graph_refs"] == 1

            # 1. the question names "the bank": only that contract is searched, and what clause 1 refers to (clause 2) rides along
            async def grade_first(_k, q, hits): return [0]
            ask.grade = grade_first
            ev = events(c.post("/ask", json={"question": "When can the bank terminate?"}))
            first = next(e for e in ev if e["event"] == "retrieved")
            assert first["scope"] == ["bank.pdf"] and first["hits"][0]["filename"] == "bank.pdf", first  # the named contract comes first (soft narrowing adds the best of the others after it)
            srcs = next(e for e in ev if e["event"] == "sources")["sources"]
            assert [s["clause_identifier"] for s in srcs] == ["1", "2"] and srcs[1]["via"] == "1" and srcs[0]["via"] is None, srcs

            # 2. a question that names nothing is searched everywhere
            ev = events(c.post("/ask", json={"question": "terminate this agreement on notice"}))
            first = next(e for e in ev if e["event"] == "retrieved")
            assert first["scope"] == [] and {h["filename"] for h in first["hits"]} == {"bank.pdf", "food.pdf"}, first

            # 3. narrowing finds nothing relevant: the retry searches every contract (a wrong narrowing is recoverable)
            seen = []
            async def grade_second(_k, q, hits): seen.append({h["filename"] for h in hits}); return [] if len(seen) == 1 else [0]
            ask.grade = grade_second
            ev = events(c.post("/ask", json={"question": "Can the bank terminate on notice?"}))
            retrieved = [e for e in ev if e["event"] == "retrieved"]
            assert [e["scope"] for e in retrieved] == [["bank.pdf"], []] and len(seen) == 2 and seen[0] == {"bank.pdf"}, (retrieved, seen)  # (the word "bank" itself only matches bank.pdf, so the retry still finds just it)
            print("ok: narrow by named party, widen by reference, no narrowing, fallback to all")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, user)
