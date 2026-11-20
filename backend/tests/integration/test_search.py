"""Embeddings + hybrid search against the real Postgres, with a fake embedder (no OpenAI call).
Run: uv run python -W ignore -m tests.integration.test_search"""
import json
import math
import uuid
import zlib
from fastapi.testclient import TestClient
from app.ingestion import documents
from app.search import embeddings
from app.core.auth import current_user
from app.core.database import AsyncSessionLocal, User
from app.search.graph import drop_user as drop_user_graph
from app.main import app
from tests.integration.test_parse import make_sample_pdf

CLAUSES = [
    ("1", "TERMINATION", "Either party may terminate this agreement with thirty days written notice."),
    ("2", "GOVERNING LAW", "This agreement is governed by the laws of England and Wales."),
    ("3", "PAYMENT", "The customer shall pay all invoices within forty five days."),
]
RESULT = {"method": "local", "total_ms": 5, "confidence": None,
          "clauses": [{"clause_identifier": i, "title": t, "content": f"{i}. {t}\n{b}", "page_number": 1} for i, t, b in CLAUSES]}


async def fake_embed(_key, texts):  # hashed bag of words: texts sharing words get close vectors
    out = []
    for t in texts:
        v = [0.0] * embeddings.DIMS
        for w in t.lower().split():
            v[zlib.crc32(w.strip(".,").encode()) % embeddings.DIMS] += 1
        n = math.sqrt(sum(x * x for x in v)) or 1
        out.append([x / n for x in v])
    return out


if __name__ == "__main__":
    async def no_key(*_): return None
    async def a_key(*_): return "sk-fake"

    with TestClient(app) as c:
        async def make_user(tag):
            async with AsyncSessionLocal() as db:
                u = User(google_sub=f"test-{tag}-{uuid.uuid4().hex[:8]}", email=f"{tag}@example.com")
                db.add(u)
                await db.commit()
                return u

        async def drop(u):
            async with AsyncSessionLocal() as db:
                await drop_user_graph(u.id)
                await db.delete(await db.get(User, u.id))
                await db.commit()

        alice, bob = c.portal.call(make_user, "alice"), c.portal.call(make_user, "bob")
        try:
            embeddings.embed_texts = fake_embed
            embeddings.openai_key = documents.openai_key = no_key
            app.dependency_overrides[current_user] = lambda: alice
            r = c.post("/documents", files={"file": ("a.pdf", make_sample_pdf(), "application/pdf")}, data={"result": json.dumps(RESULT)})
            assert r.status_code == 201 and r.json()["embedded_count"] == 0, r.text  # no key: saved, not embedded
            doc_id = r.json()["id"]
            assert c.post(f"/documents/{doc_id}/embed").status_code == 400
            kw = c.post("/search", json={"query": "terminate notice"}).json()
            assert kw["mode"] == "keyword" and kw["note"] and kw["results"][0]["clause_identifier"] == "1", kw

            embeddings.openai_key = documents.openai_key = a_key
            assert c.post(f"/documents/{doc_id}/embed").json() == {"embedded_count": 3}
            assert c.get("/documents").json()[0]["embedded_count"] == 3
            got = c.get(f"/documents/{doc_id}").json()
            assert got["embedded_count"] == 3 and all(len(x["embedding_preview"]) == 8 for x in got["clauses"])

            hy = c.post("/search", json={"query": "which law governs"}).json()
            assert hy["session_id"] and "which law" in hy["results"][0]["content"].lower() or hy["results"][0]["content"]
            assert c.get(f"/sessions/{hy['session_id']}").json()["kind"] == "search"
            top = hy["results"][0]
            assert hy["mode"] == "hybrid" and top["clause_identifier"] == "2", hy
            assert top["vector_rank"] == 1 and top["vector_similarity"] > 0 and top["page_number"] == 1

            # rerank: a fake cross-encoder (no model download) that prefers the termination clause re-orders the results
            from app.search import rerank

            class Fake:
                def predict(self, pairs, batch_size=16):
                    return [9.0 if "TERMINATION" in text else 0.1 for _q, text in pairs]

            async def search(**kw):
                async with AsyncSessionLocal() as db:
                    return (await embeddings.hybrid(db, alice.id, "which law governs", "sk-fake", 2, **kw))[0]

            rerank._model = Fake()
            plain, ranked = c.portal.call(lambda: search(rerank=False)), c.portal.call(lambda: search(rerank=True))
            assert plain[0]["clause_identifier"] == "2" and "rerank_score" not in plain[0], plain
            assert ranked[0]["clause_identifier"] == "1" and ranked[0]["rerank_score"] == 9.0 and len(ranked) == 2, ranked
            assert ranked[0]["vector_rank"] is not None  # the hybrid ranks stay, so the UI can show what moved

            class Broken:
                def predict(self, *_a, **_k):
                    raise RuntimeError("model crashed")

            rerank._model = Broken()  # a failing model keeps the hybrid order instead of failing the search
            assert [h["clause_identifier"] for h in c.portal.call(lambda: search(rerank=True))] == [h["clause_identifier"] for h in plain]
            rerank._model = None

            m = c.post("/embeddings/map", json={"document_id": doc_id, "query": "which law governs"}).json()
            assert len(m["points"]) == 3 and m["dims"] == 1536 and 0 < sum(m["explained"]) <= 1.0001, m
            assert all(abs(p[k]) <= 1.0001 for p in m["points"] for k in "xyz") and len(m["explained"]) == 3 and m["query"]
            best = max(m["points"], key=lambda p: p["similarity"])
            assert best["clause_identifier"] == "2", m  # nearest in the full 1536 dimensions is the governing-law clause

            # similar clauses live in the user's OTHER contracts
            other = c.post("/documents", files={"file": ("b.pdf", make_sample_pdf() + b"\n%second", "application/pdf")}, data={"result": json.dumps({**RESULT, "clauses": [
                {"clause_identifier": "1", "title": "TERMINATION", "content": "1. TERMINATION\nEither party may terminate this agreement with sixty days written notice.", "page_number": 1},
                {"clause_identifier": "2", "title": "FEES", "content": "2. FEES\nThe customer shall pay invoices monthly.", "page_number": 1}]})}).json()["id"]
            assert c.post(f"/documents/{other}/embed").json() == {"embedded_count": 2}
            sim = c.get(f"/documents/{doc_id}/clauses/0/similar").json()  # clause 1 of the first contract: TERMINATION
            assert sim["embedded"] and sim["similar"] and all(s["document_id"] == other for s in sim["similar"]), sim  # never its own contract
            assert sim["similar"][0]["clause_identifier"] == "1" and sim["similar"][0]["similarity"] >= sim["similar"][-1]["similarity"], sim
            assert c.get(f"/documents/{other}/clauses/99/similar").status_code == 404

            app.dependency_overrides[current_user] = lambda: bob  # another user sees nothing of alice's clauses
            assert c.post("/search", json={"query": "terminate"}).json()["results"] == []
            assert c.post(f"/documents/{doc_id}/embed").status_code == 404
            assert c.get(f"/sessions/{hy['session_id']}").status_code == 404 and [x["id"] for x in c.get("/sessions").json()] != [hy["session_id"]]  # sessions are private: bob only has his own search
            assert c.post("/embeddings/map", json={}).json()["points"] == []
            print("ok: embed, hybrid search, rerank, keyword fallback, isolation")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, alice)
            c.portal.call(drop, bob)
