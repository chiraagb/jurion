"""Postgres is the source of truth and the graph is derived, but two databases can still disagree (a delete that bypassed the app,
a Neo4j that was down when a contract was saved). This compares them. Run on every API start, or by hand: uv run python -m app.reconcile
"""

import asyncio
import logging
from sqlalchemy import select
from app.core.database import AsyncSessionLocal, Document, neo4j_driver
from app.search.graph import party_key

log = logging.getLogger("jurion")


async def rekey_parties(s) -> int:
    """Recomputes every Party's key with the current name rule and merges parties that now share one (so a company stored as
    "Acme Corp." and again as "Acme Corporation" becomes one node). Idempotent. Returns how many duplicates were merged.
    """
    rows = await (
        await s.run(
            "MATCH (p:Party) RETURN elementId(p) AS id, p.user_id AS u, p.key AS k, p.name AS name ORDER BY p.name"
        )
    ).data()
    groups: dict[tuple, list[dict]] = {}
    for r in rows:
        groups.setdefault((r["u"], party_key(r["name"])), []).append(r)
    merged = 0
    for (_, new_key), group in groups.items():
        keep, *dupes = group
        for d in dupes:
            await s.run(
                "MATCH (d:Party) WHERE elementId(d) = $d MATCH (k:Party) WHERE elementId(k) = $k MATCH (d)-[r:PARTY_TO]->(x:Document) "
                "MERGE (k)-[r2:PARTY_TO]->(x) SET r2.role = r.role, r2.aliases = r.aliases",
                d=d["id"],
                k=keep["id"],
            )
            await s.run(
                "MATCH (d:Party) WHERE elementId(d) = $d DETACH DELETE d", d=d["id"]
            )
            merged += 1
        if keep["k"] != new_key:
            await s.run(
                "MATCH (p:Party) WHERE elementId(p) = $id SET p.key = $k",
                id=keep["id"],
                k=new_key,
            )
    return merged


async def reconcile_graph() -> dict:
    """Removes graph data for contracts that are not in Postgres (safe: the graph can be rebuilt). Reports, but does not guess at,
    the opposite: contracts Postgres says have a graph that Neo4j does not have. Rebuild those from the contract page.
    """
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(Document.id, Document.graph_parties))).all()
    keep = [str(i) for i, _ in rows]
    async with neo4j_driver.session() as s:
        orphans = (
            await (
                await s.run(
                    "MATCH (d:Document) WHERE NOT d.id IN $keep RETURN count(d) AS n",
                    keep=keep,
                )
            ).single()
        )["n"]
        orphans += (
            await (
                await s.run(
                    "MATCH (c:Clause) WHERE NOT c.document_id IN $keep AND NOT EXISTS { MATCH (:Document)-[:CONTAINS]->(c) } RETURN count(c) AS n",
                    keep=keep,
                )
            ).single()
        )["n"]
        await s.run(
            "MATCH (d:Document) WHERE NOT d.id IN $keep OPTIONAL MATCH (d)-[:CONTAINS]->(c) DETACH DELETE c, d",
            keep=keep,
        )
        await s.run(
            "MATCH (c:Clause) WHERE NOT c.document_id IN $keep DETACH DELETE c",
            keep=keep,
        )
        await s.run("MATCH (p:Party) WHERE NOT (p)--() DELETE p")
        merged = await rekey_parties(s)
        have = {
            r["id"]
            for r in await (await s.run("MATCH (d:Document) RETURN d.id AS id")).data()
        }
    missing = [str(i) for i, gp in rows if gp is not None and str(i) not in have]
    out = {
        "orphans_removed": orphans,
        "parties_merged": merged,
        "graph_missing": len(missing),
        "contracts_without_graph": sum(gp is None for _, gp in rows),
    }
    if orphans or missing or merged:
        log.warning("graph reconcile: %s", out)
    return out


if __name__ == "__main__":

    async def main():
        print(await reconcile_graph())
        await neo4j_driver.close()

    asyncio.run(main())
