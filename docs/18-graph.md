# 18. The contract graph (Neo4j)

Neo4j holds the *links*: who the parties are, and which clause points at which. Text, vectors and the PDF stay in Postgres; the graph holds only ids, names and relationships, and can be rebuilt from Postgres at any time (`backend/app/graph.py`).

```
(Party)-[:PARTY_TO {role, aliases}]->(Document)-[:CONTAINS]->(Clause)-[:REFERENCES]->(Clause)
```

- **Party:** one node per user and normalised name, so the same company in two contracts is one node, and its page lists "Also in N other contracts".
- **Parties come from AI:** one call per contract (not per clause) on the first ~6,000 characters, returning each party's name, role and the short names the text uses for it ("the Bank", "Metavante"). Needs an OpenAI key; this sends that text to OpenAI, as Ask already does.
- **References come from a pattern, no AI:** "Section 5.3", "Clauses 4.1 and 4.2", "Article 18" become `REFERENCES` links when the number matches a clause of the same contract. "Section 5.3 of the Securities Act" or "of the MSA" are skipped (they point outside). A reference to a clause itself is dropped. When numbering restarts in an attachment, the nearest clause with that number is taken, which can be wrong.

## Where it happens

- **On save:** the graph is built after the embeddings (a failure never fails the save). Without a key only references are stored.
- **My contracts:** each row shows `Graph 2p · 5r` (parties, references) or "No graph", with a button to build or rebuild it, and one button to build all that need it.
- **Open a contract:** a **Graph** panel lists its parties (with other contracts they appear in) and its cross-references.
- **Delete / replace:** the contract's subgraph is removed, and parties left with no contract are deleted.
- **API:** `POST /documents/{id}/graph` (build), `GET /documents/{id}/graph` (read). `documents.graph_parties` and `graph_refs` in Postgres hold the counts, so the list page needs no Neo4j query.

## Look at it in the Neo4j browser (http://localhost:7474)

Connect URL `bolt://localhost:7687`, username `neo4j`, password `secure_graph_password`. That is the local development login set by `NEO4J_AUTH` in `docker-compose.yml`; change it there (and `NEO4J_PASSWORD` in `backend/.env`) before exposing Neo4j anywhere.

```
MATCH (p:Party)-[r:PARTY_TO]->(d:Document) RETURN p, r, d
MATCH (a:Clause)-[r:REFERENCES]->(b:Clause) RETURN a, r, b LIMIT 50
```

## Checked on the 5 saved contracts

Parties were correct in all 5 (for example the clinical trial: the institution, the investigator and the sponsor). Cross-references: 15 and 14 in the two contracts that use numbered references, 5 in another, and 0 in the other two, which is real: the services agreement has almost none, and Agape points at "Schedule A/B", which are not numbered clauses and are not linked yet.

## Limits

- Schedules and exhibits ("Schedule A") are not linked.
- The graph is not used by Ask yet. Next: use the parties to narrow retrieval ("the bank" means the contract with a bank), and follow references to bring in the clause a retrieved clause depends on, measured on the Evaluation tab.
- Party names are matched by lowercase name only, so "Acme Corp." and "Acme Corporation" are two nodes.

Check: `uv run python -W ignore -m tests.integration.test_graph` (fake party extractor, real Neo4j).
