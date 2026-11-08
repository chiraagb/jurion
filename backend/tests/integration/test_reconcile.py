"""Drift between Postgres and Neo4j is found and cleaned. Run: uv run python -W ignore -m tests.integration.test_reconcile"""
import asyncio
import uuid
from app.database import neo4j_driver
from app.reconcile import reconcile_graph


async def main():
    ghost, who = str(uuid.uuid4()), f"ghost-{uuid.uuid4().hex[:6]}"
    async with neo4j_driver.session() as s:
        before = (await (await s.run("MATCH (d:Document) RETURN count(d) AS n")).single())["n"]
        # a contract that exists only in the graph (its Postgres row is gone), with a clause and a party that exist only because of it
        await s.run("CREATE (d:Document {id: $id, user_id: $u, filename: 'ghost.pdf'})-[:CONTAINS]->(:Clause {id: $c, document_id: $id}) "
                    "CREATE (:Party {user_id: $u, key: $k})-[:PARTY_TO]->(d)", id=ghost, u=str(uuid.uuid4()), c=str(uuid.uuid4()), k=who)
    first = await reconcile_graph()
    assert first["orphans_removed"] >= 1, first  # counts orphan contracts (their clauses go with them)
    async with neo4j_driver.session() as s:
        left = await (await s.run("MATCH (n) WHERE n.id = $id OR n.document_id = $id OR n.key = $k RETURN count(n) AS n", id=ghost, k=who)).single()
        assert left["n"] == 0, "the ghost contract, its clause or its party survived"
        assert (await (await s.run("MATCH (d:Document) RETURN count(d) AS n")).single())["n"] == before, "a real contract was touched"
    assert (await reconcile_graph())["orphans_removed"] == 0  # nothing left to clean the second time
    print("ok: ghost contract, clause and party removed; real contracts untouched; second run is a no-op")
    await neo4j_driver.close()


asyncio.run(main())
