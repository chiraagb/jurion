# 12 – Looking at the database

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
