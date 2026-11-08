# 18. The contract graph (Neo4j)

Neo4j holds the *links*: who the parties are, and which clause points at which. Text, vectors and the PDF stay in Postgres; the graph holds only ids, names and relationships, and can be rebuilt from Postgres at any time (`backend/app/graph.py`).

```
(Party)-[:PARTY_TO {role, aliases}]->(Document)-[:CONTAINS]->(Clause)-[:REFERENCES]->(Clause)
```

- **Party:** one node per user and normalised name, so the same company in two contracts is one node, and its page lists "Also in N other contracts".
- **Parties come from AI:** one call per contract (not per clause) on the first ~6,000 characters, returning each party's name, role and the short names the text uses for it ("the Bank", "Metavante"). Needs an OpenAI key; this sends that text to OpenAI, as Ask already does.
- **References come from a pattern, no AI** (including a list after a colon, "The following Sections shall survive: 4.2, 5.3, 7, 8 and 14", and "Section 8" pointing at 8.1 when the parser found no clause 8 of its own): "Section 5.3", "Clauses 4.1 and 4.2", "Article 18" become `REFERENCES` links when the number matches a clause of the same contract. "Section 5.3 of the Securities Act" or "of the MSA" are skipped (they point outside). A reference to a clause itself is dropped. When numbering restarts in an attachment, the nearest clause with that number is taken, which can be wrong.

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
- Ask uses the graph in two ways (see `docs/16-ask.md`), and the measured gain is small and mostly on questions that name a contract; the cross-reference widening is built and tested but not isolated by any evaluation question.
- Narrowing can be wrong: the first version guessed a contract from the topic and broke 4 questions, so it now decides only from a company name, a role or a kind of document in the question, includes every contract that fits, and Ask retries across all contracts when the narrowed search finds nothing relevant.
- Company names are normalised before they are compared (`party_key`): accents, punctuation, "the", "and" and trailing legal suffixes (Inc, Corp, Corporation, Ltd, Limited, LLC, Pty, GmbH...) are ignored, so "Acme Corp.", "ACME Corporation Inc." and "The Acme Company" are one company. On every API start `reconcile_graph` re-keys stored parties with the current rule and merges the ones that now match (roles kept). This does NOT resolve nicknames or different forms ("Acme Group", "Oriental Financial" vs "Oriental Financial Group"); that would need an AI or human check.

Check: `uv run python -W ignore -m tests.integration.test_graph` (fake party extractor, real Neo4j).

## The Graph page (`/graph`)

A three-pane explorer: **list** (search; Contracts and Companies tabs) → **picture** → **inspector** (what you can do with the selection). Four cards on top: contracts, companies, shared companies, clause links.

- **Library picture:** contracts as boxes, companies as pills (React Flow). A company in more than one contract is the red pill between them.
- **Contract selected:** its summary and companies, and three actions: *Explore clause links* (or *Browse its clauses* when it has none), *Ask about it* (sends a prefilled question to the chat through `/ask?q=`), *Open contract*.
- **Company selected:** every contract it is in, and an *Ask* button.
- **Clause picture:** the clauses that refer to each other, with arrows, a word filter, and "Most connected clauses" (the ones a change ripples furthest through).
- **Impact analysis:** select a clause and the inspector lists *Depends on it* and *It relies on*, each split into direct (one step) and further away (through another clause). On the picture, solid outlines are one step away and dashed outlines are further. The logic is `reach()` and `hubs()` in `frontend/src/features/graph/logic.ts`, tested by `npm test`.
- **No dead canvas:** a contract with no numbered references shows its clauses as a list instead, with the same inspector.
- **Same clause in your other contracts:** `GET /documents/{id}/clauses/{n}/similar` returns the closest clauses (pgvector cosine distance) from the user's *other* contracts, with a similarity %, so you can see how different contracts word the same thing. Tested in `tests/integration/test_search.py`.
- **Compare strip:** under the picture, the selected clause beside each clause it links to, in full.
- `GET /graph` returns the library (contracts with their clause-link counts, companies, links). `rebuild_references(db, doc)` in `app/graph.py` recomputes only a contract's clause links, with no AI.

Not done: a force-directed layout (rings are fine up to a few dozen nodes), and finding similar clauses by exact wording (it is meaning-based).
