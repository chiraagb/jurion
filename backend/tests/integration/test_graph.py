"""Cross-references and the Neo4j graph. Run: uv run python -W ignore -m tests.integration.test_graph"""
import json
import uuid
from types import SimpleNamespace as NS
from fastapi.testclient import TestClient
from app import documents, graph
from app.auth import current_user
from app.database import AsyncSessionLocal, User, neo4j_driver
from app.graph import drop_user as drop_user_graph
from app.main import app
from tests.integration.test_parse import make_number_column_pdf, make_sample_pdf


def clause(pos, ident, content):
    return NS(position=pos, clause_identifier=ident, content=content)


def test_find_refs():
    cs = [
        clause(0, "1", "1. Scope. Work is done under Section 5.3 and Clauses 7.1 and 7.2."),
        clause(1, "SECTION 5.3", "5.3 Notice. Subject to Section 1."),
        clause(2, "7.1", "7.1 Fees. See Section 5.3 of the Securities Act and Section 9 of the MSA."),  # outside this contract
        clause(3, "7.2", "7.2 Late fees. As in Section 7.2."),  # itself
        clause(4, "9", "9. Law. Article 1 of this Agreement applies; see Section 5.3 of this Agreement."),
    ]
    assert graph.find_refs(cs) == [(0, 1), (0, 2), (0, 3), (1, 0), (4, 0), (4, 1)], graph.find_refs(cs)
    # attachments restart the numbering: a reference takes the nearest clause with that number
    cs = [clause(0, "1", "x"), clause(1, "2", "see Section 1"), clause(2, "1", "y"), clause(3, "2", "see Section 1")]
    assert graph.find_refs(cs) == [(1, 0), (3, 2)]


async def counts(doc_id=None):
    async with neo4j_driver.session() as s:
        r = await (await s.run("MATCH (d:Document) WHERE $d IS NULL OR d.id = $d OPTIONAL MATCH (d)-[:CONTAINS]->(c) RETURN count(DISTINCT d) AS docs, count(c) AS clauses", d=doc_id)).single()
        return r["docs"], r["clauses"]


if __name__ == "__main__":
    test_find_refs()

    async def fake_parties(_key, text):
        return [graph.Party(name="Acme Corp.", role="Customer", aliases=["Acme", "the Customer"]), graph.Party(name="Vendor Ltd", role="Supplier", aliases=["the Supplier"])]

    async def a_key(*_): return "sk-fake"
    graph.extract_parties = fake_parties
    documents.openai_key = a_key
    documents.embed_document = lambda *a: _zero()  # embeddings are tested elsewhere
    async def _zero(): return 0

    RESULT = lambda text: {"method": "local", "total_ms": 1, "confidence": None, "clauses": [
        {"clause_identifier": "1", "title": "SCOPE", "content": "1. SCOPE\nSee Section 2.", "page_number": 1},
        {"clause_identifier": "2", "title": "TERM", "content": f"2. TERM\n{text}", "page_number": 1}]}

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

        user = c.portal.call(make_user, "graph")
        try:
            app.dependency_overrides[current_user] = lambda: user
            a = c.post("/documents", files={"file": ("a.pdf", make_sample_pdf(), "application/pdf")}, data={"result": json.dumps(RESULT("Runs one year."))})
            assert a.status_code == 201, a.text
            a = a.json()
            assert (a["graph_parties"], a["graph_refs"]) == (2, 1), a  # built on save: two parties, 1 -> 2
            g = c.get(f"/documents/{a['id']}/graph").json()
            assert g["built"] and [p["name"] for p in g["parties"]] == ["Acme Corp.", "Vendor Ltd"] and g["parties"][0]["aliases"] == ["Acme", "the Customer"]
            assert [(r["from_id"], r["to_id"]) for r in g["references"]] == [("1", "2")] and g["parties"][0]["also_in"] == []
            assert c.portal.call(counts, a["id"]) == (1, 2)

            # the same company in a second contract is the same Party node
            b = c.post("/documents", files={"file": ("b.pdf", make_number_column_pdf(), "application/pdf")}, data={"result": json.dumps(RESULT("Runs two years."))}).json()
            gb = c.get(f"/documents/{b['id']}/graph").json()
            assert gb["parties"][0]["also_in"] == ["a.pdf"], gb
            # rebuilding replaces, never duplicates
            assert c.post(f"/documents/{a['id']}/graph").json() == {"parties": 2, "references": 1}
            assert c.portal.call(counts, a["id"]) == (1, 2)

            # without a key only the references are built (no AI)
            documents.openai_key = lambda *_: _none()
            async def _none(): return None
            assert c.post(f"/documents/{a['id']}/graph").json() == {"parties": 0, "references": 1}
            assert c.get(f"/documents/{a['id']}/graph").json()["parties"] == []

            # deleting a contract removes its subgraph; the shared party stays for the other contract
            assert c.delete(f"/documents/{a['id']}").status_code == 204
            assert c.portal.call(counts, a["id"]) == (0, 0)
            assert c.get(f"/documents/{b['id']}/graph").json()["parties"][0]["also_in"] == []
            assert c.delete(f"/documents/{b['id']}").status_code == 204
            async def parties_left():
                async with neo4j_driver.session() as s:
                    return (await (await s.run("MATCH (p:Party {user_id: $u}) RETURN count(p) AS n", u=str(user.id))).single())["n"]
            assert c.portal.call(parties_left) == 0  # no orphan parties
            print("ok: references, build on save, shared party, rebuild, no-key, delete")
        finally:
            app.dependency_overrides.clear()
            c.portal.call(drop, user)
