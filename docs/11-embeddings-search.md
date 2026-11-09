# 11. Embeddings and search

Saved clauses can be turned into vectors and searched by meaning.

## What is stored

`clauses.embedding` is a pgvector `vector(1536)` column (null until embedded). The vector comes from OpenAI `text-embedding-3-small` applied to `"<clause id> <title>\n<content>"` (cut at 8,000 characters, about 2k tokens). It is a deferred column, so normal clause queries do not load the 6 KB vectors.

The key is your saved OpenAI key (key icon in the top bar), else `OPENAI_API_KEY` in `.env`. Without a key nothing breaks: contracts save as before and show "Not embedded".

## Where it happens

- **On save:** if an OpenAI key exists, the contract is embedded right after it is saved. A failure never fails the save.
- **My contracts:** each row shows `Embedded`, `Embedded n/m` or `Not embedded`, with a sparkle button to (re-)embed it, and one button to embed everything that needs it. Re-embed after the clause boundaries change.
- **Open a saved contract:** each clause shows an inspector line with the model, the size, and the first 8 of the 1536 numbers as bars (`GET /documents/{id}` returns `embedding_preview`).
- **Search tab:** `POST /search` with `{query}`.

## How search ranks

1. **Vector list:** top 20 clauses by cosine similarity to the embedded question.
2. **Keyword list:** top 20 by Postgres full-text rank (`websearch_to_tsquery`).
3. **Merge:** reciprocal rank fusion, `score = Σ 1 / (60 + rank)` over the lists a clause appears in. A clause found by both lists beats one found by either alone.

Each result shows its vector rank and similarity, its keyword rank and the fused score, so you can see why it matched. Results are always limited to your own contracts. Without a key (or if OpenAI fails) only the keyword list is used and the page says so.

## The embedding map

The Search tab draws your real vectors. `POST /embeddings/map` loads the stored vectors (all contracts, or one), squashes them from 1536 numbers to 3 with PCA (centre, SVD, keep the three strongest directions), and returns x/y/z per clause. A 2D/3D switch draws the first two or all three; 3D is a drag-to-rotate view with perspective (plain SVG, no 3D library). Nothing is stored.

- One colour per contract; the dropdown shows a single contract. Click a dot to see the clause and open it.
- After a search, your question is embedded and placed with the same squash (a star). Rings mark the 5 clauses nearest to it by true cosine similarity in all 1536 dimensions, which can differ from what looks close in 2D.
- The caption shows how much (2D keeps less than 3D) of the variation the two axes keep. PCA throws the rest away, so closeness on the map is a hint, not proof.
- At most 3000 points are drawn.

## Limits

- No vector or full-text index yet: both are exact scans, fine up to roughly 100k clauses. Add an HNSW index and a GIN index after that.
- A clause longer than about 2k tokens is cut, not split into chunks.
- The old `contract_chunks` table in `database.py` is unused.

Check: `uv run python -W ignore -m tests.integration.test_search` (fake embedder, no OpenAI call).
