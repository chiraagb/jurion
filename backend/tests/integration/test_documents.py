"""Saved contracts against the real Postgres. Run: uv run python -W ignore -m tests.integration.test_documents"""
import json
import uuid
from fastapi.testclient import TestClient
from app.auth import current_user
from app.database import AsyncSessionLocal, User
from app.main import app
from tests.integration.test_parse import make_number_column_pdf, make_sample_pdf

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

            # full text + line ranges: save a real parse, then each clause's range must point at its own lines
            from app.database import Document
            from app.hybrid_parser import local_fast_parse
            pdf2 = pdf + b"\n%variant"  # a different file (different hash): saving the same bytes twice is a duplicate
            clauses, conf = local_fast_parse(pdf2)
            real = c.post("/documents", files={"file": ("m.pdf", pdf2, "application/pdf")},
                          data={"result": json.dumps({"method": "local", "confidence": conf, "clauses": clauses})}).json()["id"]
            async def stored(doc_id):
                async with AsyncSessionLocal() as db:
                    doc = await db.get(Document, uuid.UUID(doc_id))
                    await db.refresh(doc, ["lines"])
                    return doc.lines
            lines = c.portal.call(stored, real)
            got2 = c.get(f"/documents/{real}").json()["clauses"]
            assert len(lines) > 10 and all(g["end_line"] > g["start_line"] for g in got2)
            for g in got2:
                assert lines[g["start_line"]]["t"].upper().startswith(g["clause_identifier"].split()[0].upper()), g  # starts at its heading
            assert got2[0]["end_line"] == got2[1]["start_line"]  # ranges tile the text, no gap
            off = [{**clauses[0], "end_line": 10**6}]
            assert c.post("/documents", files={"file": ("m3.pdf", make_number_column_pdf(), "application/pdf")},
                          data={"result": json.dumps({"method": "local", "clauses": off})}).status_code == 422  # range outside the text

            # duplicates: the same bytes by the same user are refused (even under another name), unless replacing
            dup = c.post("/documents", files={"file": ("renamed.pdf", pdf, "application/pdf")}, data={"result": json.dumps(RESULT)})
            assert dup.status_code == 409 and dup.json()["existing"]["id"] == doc_id and "msa.pdf" in dup.json()["detail"], dup.text
            rep = c.post("/documents", files={"file": ("renamed.pdf", pdf, "application/pdf")}, data={"result": json.dumps(RESULT), "replace": "true"})
            assert rep.status_code == 201 and rep.json()["id"] != doc_id, rep.text
            assert c.get(f"/documents/{doc_id}").status_code == 404  # the old copy is gone, with its clauses
            doc_id = rep.json()["id"]
            assert [d["filename"] for d in c.get("/documents").json() if d["id"] == doc_id] == ["renamed.pdf"]

            bad = c.post("/documents", files={"file": ("x.pdf", b"nope", "application/pdf")}, data={"result": json.dumps(RESULT)})
            assert bad.status_code == 415
            assert c.post("/documents", files={"file": ("a.pdf", pdf + b"\n%v2", "application/pdf")}, data={"result": "{}"}).status_code == 422

            as_user(bob)  # someone else's contract looks like it does not exist
            assert c.get("/documents").json() == []
            assert c.get(f"/documents/{doc_id}").status_code == 404
            assert c.get(f"/documents/{doc_id}/pdf").status_code == 404
            assert c.delete(f"/documents/{doc_id}").status_code == 404

            theirs = c.post("/documents", files={"file": ("msa.pdf", pdf, "application/pdf")}, data={"result": json.dumps(RESULT)})
            assert theirs.status_code == 201, theirs.text  # duplicates are per user

            as_user(alice)
            assert c.delete(f"/documents/{doc_id}").status_code == 204
            assert c.get(f"/documents/{doc_id}").status_code == 404
            print("ok: save, list, open, pdf, isolation, delete, duplicates")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, alice)
            c.portal.call(drop, bob)
