"""Embeddings + hybrid search against the real Postgres, with a fake embedder (no OpenAI call).
Run: uv run python -W ignore -m tests.integration.test_search"""
import json
import math
import uuid
import zlib
from fastapi.testclient import TestClient
from app import documents, embeddings
from app.auth import current_user
from app.database import AsyncSessionLocal, User
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

            m = c.post("/embeddings/map", json={"document_id": doc_id, "query": "which law governs"}).json()
            assert len(m["points"]) == 3 and m["dims"] == 1536 and 0 < sum(m["explained"]) <= 1.0001, m
            assert all(abs(p[k]) <= 1.0001 for p in m["points"] for k in "xyz") and len(m["explained"]) == 3 and m["query"]
            best = max(m["points"], key=lambda p: p["similarity"])
            assert best["clause_identifier"] == "2", m  # nearest in the full 1536 dimensions is the governing-law clause

            app.dependency_overrides[current_user] = lambda: bob  # another user sees nothing of alice's clauses
            assert c.post("/search", json={"query": "terminate"}).json()["results"] == []
            assert c.post(f"/documents/{doc_id}/embed").status_code == 404
            assert c.get(f"/sessions/{hy['session_id']}").status_code == 404 and [x["id"] for x in c.get("/sessions").json()] != [hy["session_id"]]  # sessions are private: bob only has his own search
            assert c.post("/embeddings/map", json={}).json()["points"] == []
            print("ok: embed, hybrid search, keyword fallback, isolation")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, alice)
            c.portal.call(drop, bob)
