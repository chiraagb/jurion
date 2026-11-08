"""Postgres is the source of truth and the graph is derived, but two databases can still disagree (a delete that bypassed the app,
a Neo4j that was down when a contract was saved). This compares them. Run on every API start, or by hand: uv run python -m app.reconcile"""
import asyncio
import logging
from sqlalchemy import select
from app.database import AsyncSessionLocal, Document, neo4j_driver

log = logging.getLogger("jurion")


async def reconcile_graph() -> dict:
    """Removes graph data for contracts that are not in Postgres (safe: the graph can be rebuilt). Reports, but does not guess at,
    the opposite: contracts Postgres says have a graph that Neo4j does not have. Rebuild those from the contract page."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Document.id, Document.graph_parties))).all()
    keep = [str(i) for i, _ in rows]
    async with neo4j_driver.session() as s:
        orphans = (await (await s.run("MATCH (d:Document) WHERE NOT d.id IN $keep RETURN count(d) AS n", keep=keep)).single())["n"]
        orphans += (await (await s.run("MATCH (c:Clause) WHERE NOT c.document_id IN $keep AND NOT EXISTS { MATCH (:Document)-[:CONTAINS]->(c) } RETURN count(c) AS n", keep=keep)).single())["n"]
        await s.run("MATCH (d:Document) WHERE NOT d.id IN $keep OPTIONAL MATCH (d)-[:CONTAINS]->(c) DETACH DELETE c, d", keep=keep)
        await s.run("MATCH (c:Clause) WHERE NOT c.document_id IN $keep DETACH DELETE c", keep=keep)
        await s.run("MATCH (p:Party) WHERE NOT (p)--() DELETE p")
        have = {r["id"] for r in await (await s.run("MATCH (d:Document) RETURN d.id AS id")).data()}
    missing = [str(i) for i, gp in rows if gp is not None and str(i) not in have]
    out = {"orphans_removed": orphans, "graph_missing": len(missing), "contracts_without_graph": sum(gp is None for _, gp in rows)}
    if orphans or missing:
        log.warning("graph reconcile: %s", out)
    return out


if __name__ == "__main__":
    async def main():
        print(await reconcile_graph())
        await neo4j_driver.close()
    asyncio.run(main())
