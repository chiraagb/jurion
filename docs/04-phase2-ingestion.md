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
  3. **Fallback (Gemini or OpenAI):** if it finds fewer than 3 clauses, or the confidence is below 0.6, the AI is asked **which lines are headings**. It gets a short list (about 150 candidate lines, not the whole contract) and answers with line numbers. The clause text still comes from the PDF itself, so nothing is reworded and page numbers stay exact. If the AI's result scores no better than the local one, the local one is kept. A scanned PDF with no text is the exception: the whole file goes to the AI.

You can also trigger it yourself: the **Parse with Gemini** button in the Parser Lab re-runs the file with the AI and uses its result.

The local rules are meant to stay small. When a new contract parses badly, the answer is this AI step (and the test in "Regression test" below), not another special case in the regex rules.

Each clause comes out as:

```json
{ "clause_identifier": "SECTION 14.2", "title": "Governing Law", "content": "..." }
```

### Tables, attachments and signature blocks

- **Tables are kept as tables.** If a page has a table drawn with ruled lines, the parser reads each cell and stores the table as rows (`| Visit | Fee |`). The app shows it as a real table, not a run of text. Finding tables costs about 0.2s per page that has one.
- **Tables with only underlines (no grid).** The line detector sometimes finds the area but puts everything in one column, gluing each quantity onto the name above it. When a detected table has fewer than two columns holding text, the columns are rebuilt from where the words sit: a gap of 12pt or more that almost no row crosses is a column gutter, and a row that crosses one (a footer or title) is kept whole in the first cell. A tiny column with a stray page number is folded into its neighbour. If no two columns come out, it is not treated as a table and the lines stay plain text.
- **Still plain text:** a table on a page with no ruled lines at all.
- **A signature block stops at an attachment.** The signature block normally runs to the end of the file, but a heading like `ATTACHMENT 1`, `APPENDIX` or `ANNEX` (in capitals) starts a new section. Numbering restarts inside an attachment, so a second "1." there is not counted as a duplicate.
- **Only a short line starts a signature block.** "signed by the Investigator and returned…" is a normal sentence; "Signed at London" is a signature line. (A long sentence that began with "signed by" once swallowed 28 pages into one clause.)
- **Cross-references are not headings.** "Section 1.7 [Financial Disclosure], 1.8 …" inside a sentence is ignored.

### How does the parser know the layout is messy?

Five checks, each from 0 to 1. They are multiplied into one **confidence score**, which `POST /parse` returns as `confidence` and the Parser Lab shows as "Parse confidence".

| Check | Question it answers | Low score means |
|---|---|---|
| **coverage** | How much of the page text ended up inside clauses? | Text was dropped |
| **numbering** | Are clause numbers continuous (1, 2, 3 – not 1, 2, 4)? | Headings were missed |
| **titled** | How many headings got a real title (not "Section X")? | Heading detection is off |
| **unique** | Is each clause number used only once? | The contract reuses a number (or the parser split one section in two) |
| **balanced** | Does any one clause hold more than 40% of the text (documents of 4+ pages)? | A heading was missed and the rest of the contract is merged into one clause |

The API also returns `issues`: plain-language warnings shown as yellow notes above the clause list, for example:

> Number 3 is used twice: "COMPENSATION" (p.3) and "SUPPLY OF MATERIALS" (p.4). The contract reuses it.

We keep both clauses with their original numbers and never renumber. The warning tells a reviewer to check. In the clause tree, a sub-clause such as `3.7` attaches to the **nearest preceding** clause numbered `3`, so a reused number doesn't mix up two sections' sub-clauses.

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
- The model is set in `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) or `OPENAI_MODEL` (default `gpt-4o`). Change it in `.env` if a model is retired.
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

### Regression test on real contracts

`backend/tests/integration/test_corpus.py` parses real PDFs kept in `backend/tests/corpus/` (git-ignored, since they are real contracts) and checks each against `expectations.json`: minimum clause count, clause IDs that must exist, table rows, and a minimum score. When a new contract parses badly, put the PDF in that folder, add an entry, fix the parser, and the test keeps every earlier contract working.

### Limits and safety

PDFs come from users, so reading one is treated as risky work:

- **Worker processes.** PDFs are read in separate worker processes (`PARSE_WORKERS`, default 2), not inside the web server. Two uploads no longer wait for each other, and a PDF that crashes the reader cannot take the API down.
- **Page cap.** More than `MAX_PAGES` (default 300) pages is refused. Password-protected PDFs are refused too.
- **Time limit.** A read that takes longer than `PARSE_TIMEOUT_S` (default 45s) is killed, the user gets a clear error, and the workers restart. (This also cancels other uploads being read at that moment; they can be retried.)
- **Rate limits** (a counter in Redis, per signed-in user): 10 parses and 20 saves per minute; 20 sign-in attempts per minute per IP. Over the limit returns `429` with `Retry-After`. If Redis is down, the limit is skipped rather than blocking everyone.
- **Logging.** Each parse logs one line: user, pages, clauses, method, score, which steps ran, and time. LLM fallback failures and worker kills are logged as warnings. Contract text is never logged.

All three limits are settings in `backend/.env` (`MAX_PAGES`, `PARSE_TIMEOUT_S`, `PARSE_WORKERS`). Check them with `uv run python -m tests.integration.test_limits`.

### Measuring clause-boundary accuracy

Confidence is the parser grading itself, so accuracy is measured against labels:

1. `tests/corpus_big/selection.txt` lists the contracts (30 from CUAD, chosen from clean, many-duplicate-numbers, too-few-clauses, long, and weak-numbering groups).
2. `uv run python -m tests.label_draft` drafts labels in `tests/corpus_big/labels/`. The local parser and the AI heading step each mark where clauses start. Lines both mark (`=`) are accepted; lines only one marks (`L?` local only, `A?` AI only) are for a person to decide: change to `+` (starts a clause) or `-` (does not). A missed start is added as `+ p<page> | <exact line text>`.
3. `uv run python -m tests.eval` prints precision, recall and F1 per contract and overall (only for fully reviewed files), plus how often the AI fallback would trigger.

Limit: lines both drafters get wrong the same way are accepted unreviewed, so recall can look better than it is. Skim the `=` lines too.
