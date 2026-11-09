# 7. Looking at the database

Postgres runs in Docker (`jurion_postgres`). Two easy ways to see what is stored.

## Terminal

```bash
docker exec -it jurion_postgres psql -U lexi_user -d jurion_db
```

Inside `psql`: `\dt` lists tables, `\d users` shows a table's columns, `select * from users;` shows rows, `\q` quits.

## DBeaver (free GUI)

1. Find the connection details in `backend/.env` (`DATABASE_URL`).
2. New Database Connection → **PostgreSQL**.
3. Host `localhost`, port `5432`, database `jurion_db`, user `lexi_user`, password from `DATABASE_URL`.
4. **Test Connection** (let it download the driver the first time) → **Finish**.
5. Browse: `jurion_db → Schemas → public → Tables`. Double-click a table → **Data** tab. Open a SQL editor with Cmd+].

Edits in the grid are written to the real database when you press Save. Deleting a `users` row also deletes that user's saved keys.

## What is stored today

| Table | Holds |
|---|---|
| `users` | One row per person who signed in: `google_sub`, `email`, `name`, `picture` |
| `documents` | One row per saved contract: owner (`user_id`), `filename`, `pages`, `method`, `confidence`, and the original PDF (`pdf`, bytea) |
| `clauses` | One row per parsed clause: `document_id`, `position` (reading order), `clause_identifier`, `title`, `content`, `page_number`, `parent_identifier` |
| `llm_api_keys` | One row per user and provider: encrypted `ciphertext`, a masked `hint` like `sk-…abcd`, `updated_at`. The real key cannot be read here. |

Not yet in Postgres:
- **Embeddings.** `contract_chunks` is defined in code but not created; it arrives with the embeddings step.
- **Login sessions.** They live in Redis, not Postgres.

`/parse` itself still saves nothing. A contract is stored only when you press **Save contract**; deleting a `users` row removes their documents and clauses too.

Handy query: which saved keys belong to whom.

```sql
select u.email, k.provider, k.hint, k.updated_at
from llm_api_keys k join users u on u.id = k.user_id;
```

## Later: an admin panel inside the app

[SQLAdmin](https://github.com/aminalaee/sqladmin) gives a Django-admin-style `/admin` for FastAPI and SQLAlchemy models. If added, limit it to admin accounts with the Google sign-in, since it can edit any row.

## Full text first, clauses as ranges

When you save a contract, the server reads the PDF once more and stores its **full text in reading order** in `documents.lines` (one entry per visual line: text, page, position, font size, bold, and a flag for tables). Each clause row then has `start_line` and `end_line`: the clause is lines `start_line` up to (not including) `end_line`.

Why: the text is never lost, whatever the splitter does. A wrong split is fixed by moving a boundary, and a new splitter (or the AI heading step) can be re-run on the saved lines without opening the PDF again. The same lines will feed the graph (cross-references, definitions) and the search index later.

- `clauses.content` is still stored: it is the readable version of those lines, kept so the UI and queries stay simple.
- Contracts saved before this change have no lines (`lines` is empty). Open and save them again to get them.
- A scan with no text layer has no lines and no ranges.
- The server checks each range fits inside the text before saving, because the browser sends it.

- `documents.sha256` is the SHA-256 of the stored PDF (hex). It is used to refuse saving the same file twice for one user; see [Saved contracts](10-saved-contracts.md).
- `clauses.embedding` is a pgvector `vector(1536)` (null until embedded); see [Embeddings and search](11-embeddings-search.md).
