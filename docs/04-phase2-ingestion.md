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
  2. **Confidence check:** after the fast path, the parser scores itself from 0 to 1 (see below).
  3. **Fallback (Gemini, ~2s):** if it finds fewer than 3 clauses, or the confidence is below 0.6, it sends the PDF to an AI and asks it to list the clauses.

Each clause comes out as:

```json
{ "clause_identifier": "SECTION 14.2", "title": "Governing Law", "content": "..." }
```

### How does the parser know the layout is messy?

Three checks, each from 0 to 1. They are multiplied into one **confidence score**, which `POST /parse` returns as `confidence` and the Parser Lab shows as "Parse confidence".

| Check | Question it answers | Low score means |
|---|---|---|
| **coverage** | How much of the page text ended up inside clauses? | Text was dropped |
| **numbering** | Are clause numbers continuous (1, 2, 3 – not 1, 2, 4)? | Headings were missed |
| **titled** | How many headings got a real title (not "Section X")? | Heading detection is off |

Below **0.6** the parser tries Gemini. If there is no Gemini key, or Gemini fails, you still get the local result with its score, never an error.

### Where to put your API key

Click the **key icon** in the top bar, pick Gemini or OpenAI (ChatGPT), paste your key and Save.

- The key is **encrypted** (Fernet) and stored in the Postgres table `llm_api_keys`. The database holds only ciphertext plus a masked hint like `sk-…a1b2`.
- The API **never sends a key back**. The key icon shows only the hint, with Remove and "paste a new key to replace it".
- The key is decrypted on the server only to make the LLM call.
- The encryption master key is `ENCRYPTION_KEY` in `backend/.env`. Generate one with `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`. Lose or change it and saved keys can no longer be decrypted; just paste them again.
- The table is created automatically on API start.
- API: `GET /settings/llm` (hints), `PUT /settings/llm/{provider}`, `DELETE /settings/llm/{provider}`.
- Fallback: `GEMINI_API_KEY` / `OPENAI_API_KEY` in `.env` are used when no key is saved in the database.

Keys belong to the signed-in user (`llm_api_keys` is keyed by `user_id` + provider), and every endpoint except `/health` requires sign-in. See `docs/11-auth.md`.

### LLM fallback: one attempt, never a loop

- The Gemini call is made **once**. There is no retry loop.
- It has a hard **60-second timeout** (`GEMINI_TIMEOUT_S`). On timeout or any error, the parser returns the local result and marks the Gemini step as a warning.
- The model is set in `GEMINI_MODEL` (default `gemini-3.8-flash`) or `OPENAI_MODEL` (default `gpt-4o`). Change it in `.env` if a model is retired.
- If you add retries later (for example for rate limits), cap them at 2 or 3 with a growing delay, and keep the timeout.

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
