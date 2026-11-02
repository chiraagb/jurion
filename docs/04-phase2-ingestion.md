# 4. Phase 2: Ingestion (PDF → data)

Goal: take an uploaded contract PDF and store it so we can search it later – both by meaning (vectors) and by relationships (graph).

## The flow

```
 PDF
  |
  v
 Split into clauses (by structure)
  |
  v
 Background job
  |-------------------------------|
  v                               v
 AI pulls out relationships     Make embeddings
  |                               |
  v                               v
 Save to Neo4j                  Save to Postgres (pgvector)
```

## Step 1 – Split by structure, not by size

Normal tools cut text every N words. That chops clauses in half.

Jurion cuts at **real contract headings** – "ARTICLE IV", "Section 14.2", etc. – so each piece is one complete clause.

We have two versions in the code:
- `app/parser.py` – simple: uses a regex to find headings.
- `app/hybrid_parser.py` – smarter:
  1. **Fast path (local, < 50ms):** looks at headings using regex *plus* font size and bold text.
  2. **Fallback (Gemini, ~2s):** if it finds fewer than 3 clauses (messy layout), it sends the PDF to an AI and asks it to list the clauses.

Each clause comes out as:

```json
{ "clause_identifier": "SECTION 14.2", "title": "Governing Law", "content": "..." }
```

## Step 2 – Ask the AI what each clause is connected to

For each clause, we ask an LLM to return JSON with:

| Field | Example |
|---|---|
| `parties_mentioned` | `["Acme Corp", "Vendor Ltd"]` |
| `referenced_clauses` | `["Section 1.1", "Section 10"]` |
| `supersedes_or_modifies` | `["MSA Section 10"]` |
| `key_obligations` | `["Vendor must notify breaches within 72h"]` |

We use **structured output** (a JSON schema) so the AI always returns this exact shape.

This runs as a **background job** because it's slow (one AI call per clause).

## Step 3 – Save to both databases

**Postgres (pgvector):** save the clause text + its embedding. This powers "find clauses that mean something like X".

**Neo4j:** save the relationships:

```
(Document) -CONTAINS-> (Clause)
(Party)    -BOUND_TO-> (Clause)
(Clause)   -REFERENCES-> (Clause)
(Clause/Document) -SUPERSEDES-> (Clause/Document)
```

We use Cypher `MERGE`, which means "create it if it doesn't exist, otherwise reuse it". So uploading the same thing twice doesn't create duplicates.

## Done when

- You can upload a PDF to an endpoint (e.g. `POST /documents`)
- Its clauses appear in the `contract_chunks` table with embeddings
- You can see the document, clauses and links in the Neo4j browser (http://localhost:7474)
