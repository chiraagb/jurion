"""One company, however its name is written. Run: uv run python -W ignore -m tests.integration.test_party_names"""
import asyncio
import uuid
from app.database import neo4j_driver
from app.graph import party_key
from app.reconcile import rekey_parties

SAME = ["Acme Corp.", "ACME Corporation Inc.", "The Acme Company", "acme", "Acme, Inc"]
assert len({party_key(n) for n in SAME}) == 1, {n: party_key(n) for n in SAME}
assert party_key("Clinresco Centres (Pty) Ltd.") == "clinresco centres"
assert party_key("SANOFI-AVENTIS RECHERCHE & DÉVELOPPEMENT") == "sanofi aventis recherche developpement"  # accents and "&" ignored
assert party_key("Smith & Sons Ltd") == party_key("Smith and Sons Limited")
assert party_key("Oriental Financial Group Inc.") != party_key("Oriental Bank and Trust")  # different companies stay different
assert party_key("Company") == "company"  # a name that is only a suffix word is kept
assert party_key("Apple Inc.") != party_key("Apple Hospitality REIT Inc.")


async def main():
    u, a, b = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    async with neo4j_driver.session() as s:
        # the same company stored twice under old-style keys, in two contracts (as the graph held it before the rule existed)
        await s.run("CREATE (da:Document {id: $a, user_id: $u}) CREATE (db:Document {id: $b, user_id: $u}) "
                    "CREATE (:Party {user_id: $u, key: 'acme corp', name: 'Acme Corp.'})-[:PARTY_TO {role: 'Customer', aliases: ['Acme']}]->(da) "
                    "CREATE (:Party {user_id: $u, key: 'acme corporation', name: 'Acme Corporation'})-[:PARTY_TO {role: 'Supplier', aliases: []}]->(db)", a=a, b=b, u=u)
        try:
            assert await rekey_parties(s) >= 1
            rows = await (await s.run("MATCH (p:Party {user_id: $u})-[r:PARTY_TO]->(d:Document) RETURN p.key AS k, r.role AS role, d.id AS d", u=u)).data()
            assert {r["k"] for r in rows} == {"acme"} and {(r["d"], r["role"]) for r in rows} == {(a, "Customer"), (b, "Supplier")}, rows
            assert (await (await s.run("MATCH (p:Party {user_id: $u}) RETURN count(p) AS n", u=u)).single())["n"] == 1  # one node, both contracts, roles kept
            assert await rekey_parties(s) == 0  # idempotent
            print("ok: name variants are one company; stored duplicates merge with their roles; a second run does nothing")
        finally:
            await s.run("MATCH (n) WHERE n.user_id = $u DETACH DELETE n", u=u)
    await neo4j_driver.close()


asyncio.run(main())
