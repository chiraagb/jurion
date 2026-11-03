"""Saved contracts against the real Postgres. Run: uv run python -W ignore -m tests.integration.test_documents"""
import json
import uuid
from fastapi.testclient import TestClient
from app.auth import current_user
from app.database import AsyncSessionLocal, User
from app.main import app
from tests.integration.test_parse import make_sample_pdf

RESULT = {"method": "local", "total_ms": 5, "confidence": {"score": 1.0}, "clauses": [
    {"clause_identifier": "1", "title": "SCOPE", "content": "1. SCOPE", "page_number": 1},
    {"clause_identifier": "1.1", "title": "Work", "content": "1.1. The work.", "page_number": 1, "parent_identifier": "1"},
]}

if __name__ == "__main__":
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
            pdf = make_sample_pdf()
            as_user = lambda u: app.dependency_overrides.__setitem__(current_user, lambda: u)

            as_user(alice)
            saved = c.post("/documents", files={"file": ("msa.pdf", pdf, "application/pdf")}, data={"result": json.dumps(RESULT)})
            assert saved.status_code == 201, saved.text
            doc_id = saved.json()["id"]
            assert saved.json()["clause_count"] == 2 and saved.json()["pages"] == 1
            assert [d["id"] for d in c.get("/documents").json()] == [doc_id]
            got = c.get(f"/documents/{doc_id}").json()
            assert [x["clause_identifier"] for x in got["clauses"]] == ["1", "1.1"]  # order kept
            assert got["clauses"][1]["parent_identifier"] == "1"
            assert c.get(f"/documents/{doc_id}/pdf").content == pdf

            bad = c.post("/documents", files={"file": ("x.pdf", b"nope", "application/pdf")}, data={"result": json.dumps(RESULT)})
            assert bad.status_code == 415
            assert c.post("/documents", files={"file": ("a.pdf", pdf, "application/pdf")}, data={"result": "{}"}).status_code == 422

            as_user(bob)  # someone else's contract looks like it does not exist
            assert c.get("/documents").json() == []
            assert c.get(f"/documents/{doc_id}").status_code == 404
            assert c.get(f"/documents/{doc_id}/pdf").status_code == 404
            assert c.delete(f"/documents/{doc_id}").status_code == 404

            as_user(alice)
            assert c.delete(f"/documents/{doc_id}").status_code == 204
            assert c.get(f"/documents/{doc_id}").status_code == 404
            print("ok: save, list, open, pdf, isolation, delete")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, alice)
            c.portal.call(drop, bob)
