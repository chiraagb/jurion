# 20. Operations: migrations, tests, CI and keeping the databases in step

## Database migrations (Alembic)

Schema changes are versioned migrations in `backend/migrations/versions/`, applied automatically when the API starts (`run_migrations` in `app/main.py`, in a worker thread because Alembic runs its own event loop). A down database does not stop the API from starting; the failure is logged.

| Revision | What it does |
|---|---|
| `0001` baseline | The whole schema as it was when migrations began. Every statement is `IF NOT EXISTS`, so it runs cleanly on a database the old start-up code already created, and its `ALTER`s bring older databases up to the baseline. |
| `0002` unique document hash | `UNIQUE (user_id, sha256) WHERE sha256 IS NOT NULL` on `documents`. |

Add a change: copy `0002`, set `down_revision` to the previous revision, write plain SQL in `upgrade()` and `downgrade()`. Run by hand with `uv run alembic upgrade head`, and see the current version with `uv run alembic current`. The Neo4j indexes and constraints are separate and created at start-up (`ensure_schema` in `app/graph.py`).

Checked by `tests/integration/test_migrations.py`: it migrates an empty scratch database to the latest revision and compares its columns and indexes with the real database's, runs the migrations twice, and downgrades and re-applies the newest one.

## Duplicate saves are now guaranteed against

The save endpoint first looks for the same file and offers "replace". That check alone has a race: two saves of the same file at the same moment both pass it. The unique index (migration 0002) refuses the second, and the endpoint turns the database error into the same "you already saved this contract" answer. The test forces the race on purpose (it slows the PDF reading so both requests pass the check first) and expects one saved contract and one refusal.

## Postgres and Neo4j can drift

Contract text lives in Postgres and the links live in Neo4j; there is no transaction across the two. `app/reconcile.py` compares them:

- It **removes** graph data for contracts that are not in Postgres (safe: the graph can be rebuilt).
- It **reports** contracts Postgres says have a graph that Neo4j lacks (`graph_missing`) and contracts with no graph, but does not guess: rebuild those from the contract page (parties need an AI key).

It runs on every API start and by hand: `uv run python -m app.reconcile`. Anything that deletes users or contracts outside the API must also call `app.graph.drop_user` / `drop_document` (the tests do).

Not done, and what a larger system would add: an **outbox**, a row written in Postgres in the same transaction as the change, which a worker uses to retry the graph update until it succeeds.

## Tests and CI

`uv run python -W ignore -m tests.run_all` runs the ten integration suites, each as its own process, against real Postgres, Redis and Neo4j (start them with `docker compose up -d postgres neo4j redis`). No OpenAI call is made: the tests use fakes. `.github/workflows/ci.yml` runs the same command in GitHub Actions against service containers with the same credentials the app defaults to, plus the frontend `tsc`, `oxlint` and `vite build`.

CI also installs Tesseract (`apt-get install tesseract-ocr`) so the OCR test runs there; without it the test skips itself. Locally: `brew install tesseract`.

The two evaluations (`tests.eval_qa`, `tests.eval_answers`) call OpenAI and read your saved contracts, so they are run by hand, not in CI.
