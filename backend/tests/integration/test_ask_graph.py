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
        return graph.Parties(parties=[graph.Party(name=who, role="Customer", aliases=[])], summary=f"A test agreement with {who}")

    async def fake_scope(_key, q, cards):  # "the bank" -> the contract whose party is a bank
        assert all(c["summary"].startswith("A test agreement with") for c in cards), cards  # the router is told what each contract is about
        out = ask.Picked(i for i, c in enumerate(cards) if "bank" in q.lower() and any("Bank" in p["name"] for p in c["parties"]))
        out.ambiguous = "the contract" in q.lower()
        out.reason = "It says 'the bank', and only Acme Bank is a bank." if out else "It names no party or document."
        return out

    async def zero(*_): return 0
    embeddings.embed_texts = fake_embed
    embeddings.openai_key = documents.openai_key = ask.openai_key = a_key
    graph.extract_parties = fake_parties
    documents.embed_document = zero
    ask.scope = fake_scope
    async def rewrite(_k, q): return q
    ask.rewrite = rewrite
    async def answer(_k, q, sources, **_):
        yield "ok"
    ask.answer_stream = answer
    async def no_followups(*_): return []
    ask.followups = no_followups

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
            assert first["scope"] == ["bank.pdf"] and first["hits"][0]["filename"] == "bank.pdf", first
            assert first["contracts"] == 2 and "only Acme Bank" in first["scope_reason"], first  # how the contract was chosen is reported  # the named contract comes first (soft narrowing adds the best of the others after it)
            srcs = next(e for e in ev if e["event"] == "sources")["sources"]
            assert [s["clause_identifier"] for s in srcs] == ["1", "2"] and srcs[1]["via"] == "1" and srcs[0]["via"] is None, srcs

            # 2. a question that names nothing is searched everywhere
            ev = events(c.post("/ask", json={"question": "terminate this agreement on notice"}))
            first = next(e for e in ev if e["event"] == "retrieved")
            assert first["scope"] == [] and {h["filename"] for h in first["hits"]} == {"bank.pdf", "food.pdf"}, first
            assert first["scope_reason"] == "It names no party or document." and first["contracts"] == 2, first

            # 3. narrowing finds nothing relevant: the retry searches every contract (a wrong narrowing is recoverable)
            seen = []
            async def grade_second(_k, q, hits): seen.append({h["filename"] for h in hits}); return [] if len(seen) == 1 else [0]
            ask.grade = grade_second
            ev = events(c.post("/ask", json={"question": "Can the bank terminate on notice?"}))
            retrieved = [e for e in ev if e["event"] == "retrieved"]
            assert [e["scope"] for e in retrieved] == [["bank.pdf"], []] and len(seen) == 2 and seen[0] == {"bank.pdf"}, (retrieved, seen)  # (the word "bank" itself only matches bank.pdf, so the retry still finds just it)
            # 4. questions about the library are answered from the database, not by searching clauses (no grading or OpenAI call at all)
            redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")  # (the limit is 10 asks a minute)
            async def boom(*_): raise AssertionError("library questions must not search or grade")
            real_hybrid = ask.hybrid
            ask.grade, ask.hybrid = boom, boom
            for q in ["How many contracts do we have?", "how many agreements do i have", "List my contracts", "Which companies appear in more than one contract?", "How many companies?"]:
                ev = events(c.post("/ask", json={"question": q}))
                assert [e["event"] for e in ev] == ["sources", "token", "followups", "done"], (q, ev)
            redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")
            text = lambda q: next(e for e in events(c.post("/ask", json={"question": q})) if e["event"] == "token")["text"]
            assert "**2** saved contracts" in text("How many contracts do we have?")
            assert "- bank (1 page)" in text("list my contracts") and "- food" in text("list my contracts") and "more" not in text("list my contracts")  # the whole list, no cut-off
            assert "**2** companies across **2** contracts" in text("how many companies do we have?"), text("how many companies do we have?")
            assert text("which companies are in more than one contract") == "No company appears in more than one of your contracts yet."
            # content questions that merely contain the same words still go to search
            assert not any(ask.library_kind(q) for q in ["How many contracts mention indemnity?", "What contracts allow termination?", "How many days notice for termination in the bank contract?", "list the termination clauses in my contracts"])
            # 5. a question about a company is answered from the graph even when no clause is relevant; "these two contracts" is resolved from the chat
            redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")
            ask.hybrid = real_hybrid
            async def grade_none(_k, q, hits): return []
            ask.grade = grade_none
            ev = events(c.post("/ask", json={"question": "What is Acme Bank, is it a vendor?"}))
            facts = next(e for e in ev if e["event"] == "facts")["text"]
            assert "Acme Bank is in 1 contract" in facts and "Acme Bank is the Customer" in facts and "bank:" in facts, facts
            assert [e["text"] for e in ev if e["event"] == "token"] == ["ok"] and not [e for e in ev if e["event"] == "followups"], ev
            async def some_followups(*_): return ["What can Acme Bank terminate?"]
            ask.followups = some_followups
            ev = events(c.post("/ask", json={"question": "What is Acme Bank, is it a vendor?"}))
            assert [e["event"] for e in ev][-2:] == ["followups", "done"] and ev[-2]["questions"] == ["What can Acme Bank terminate?"], ev  # suggested after the answer
            redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")  # the answer model ran, with the facts, though no clause was relevant
            assert not [e for e in events(c.post("/ask", json={"question": "How are these two contracts related?"})) if e["event"] == "facts"]
            ev = events(c.post("/ask", json={"question": "How are these two contracts related?", "before": ["Which contracts does Acme Bank have?"]}))
            assert any(e["event"] == "facts" and "Acme Bank" in e["text"] for e in ev), ev
            # 6. one contract is meant but not named: ask which instead of guessing; the user's choice (or "all") then answers it
            redis.Redis.from_url(settings.REDIS_URL).delete("rl:ask:testclient")
            ask.hybrid, ask.grade = real_hybrid, grade_first
            q = "How much notice does the contract need?"
            ev = events(c.post("/ask", json={"question": q}))
            assert [e["event"] for e in ev] == ["sources", "token", "clarify", "done"], ev  # nothing was searched or answered
            assert {o["filename"] for o in ev[2]["options"]} == {"bank.pdf", "food.pdf"} and "doesn't say which contract" in ev[1]["text"], ev
            ev = events(c.post("/ask", json={"question": q, "only": [bank["id"]]}))
            first = next(e for e in ev if e["event"] == "retrieved")
            assert first["scope"] == ["bank.pdf"] and first["scope_reason"] == "You chose this contract." and not [e for e in ev if e["event"] == "clarify"], first
            ev = events(c.post("/ask", json={"question": q, "anywhere": True}))
            first = next(e for e in ev if e["event"] == "retrieved")
            assert first["scope"] == [] and first["scope_reason"] == "You chose to search every contract.", first
            # 7. a follow-up that names no contract stays in the contract the chat was in, instead of asking again; a context size is reported
            sid = events(c.post("/ask", json={"question": "When can the bank terminate?"}))[-1]["session_id"]  # a chat that was about bank.pdf
            ev = events(c.post("/ask", json={"question": q, "session_id": sid}))
            first = next(e for e in ev if e["event"] == "retrieved")
            assert first["scope"] == ["bank.pdf"] and first["scope_reason"] == "Same contract as your last question." and not [e for e in ev if e["event"] == "clarify"], first
            ev = events(c.post("/ask", json={"question": "terminate this agreement on notice"}))
            ctx = next(e for e in ev if e["event"] == "context")
            assert 0 < ctx["used"] < ctx["limit"], ctx
            print("ok: narrow by named party, widen by reference, no narrowing, fallback to all, follow-up keeps the contract")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, user)
