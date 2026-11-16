# 4. Phase 1: Setup

Goal: get all the pieces running and prove they can talk to each other.

## Step 1 – Create the projects

**Backend** uses `uv` (a very fast Python package manager):

```bash
uv init backend --no-package
cd backend
uv add "fastapi[standard]" "sqlalchemy[asyncio]" greenlet asyncpg pgvector neo4j "redis[hiredis]" pydantic-settings python-dotenv
```

> `greenlet` is needed for SQLAlchemy to work in async mode. Without it you get confusing errors.

**Frontend** uses Vite:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install @tailwindcss/vite tailwindcss reactflow lucide-react axios
```

Tailwind v4 needs just one line in `src/index.css`:

```css
@import "tailwindcss";
```

## Step 2 – The Vite proxy

The frontend calls `/api/...`. Vite forwards those calls to the backend and removes the `/api` part. So `/api/health` → `http://127.0.0.1:8000/health`.

This is set in `frontend/vite.config.ts` using the `VITE_API_BASE_URL` env variable. Default should be `http://127.0.0.1:8000`.

## Step 3 – Start the databases

All three databases are defined in `docker-compose.yml`. Start them with:

```bash
docker compose up -d postgres neo4j redis
```

| Service | Port | Login |
|---|---|---|
| Postgres | 5432 | `lexi_user` / `secure_password`, db `jurion_db` |
| Neo4j | 7474 (browser UI), 7687 (app) | `neo4j` / `secure_graph_password` |
| Redis | 6379 | none |

> These passwords are for local development only.

## Step 4 – Config and database connections

- `app/core/config.py` – reads settings (database URLs, passwords) from `.env`, with local defaults.
- `app/core/database.py` – creates the connections to Postgres, Neo4j and Redis, and defines the `contract_chunks` table:

| Column | Meaning |
|---|---|
| `id` | unique id |
| `document_id` | which contract it came from |
| `clause_identifier` | e.g. `SECTION 14.2` |
| `content` | the clause text |
| `embedding` | 1536 numbers representing meaning |
| `created_at` | when it was saved |

The `embedding` column has an **HNSW index** so similarity search stays fast as data grows.

The table should be created when the app starts (a FastAPI `lifespan` function that runs `CREATE EXTENSION IF NOT EXISTS vector` and `create_all`).

## Step 5 – Health check

A `/health` endpoint checks Postgres, Neo4j and Redis at the same time. Each check gives up after 2 seconds so a stuck database can't freeze the API.

Run the backend:

```bash
uv run fastapi dev app/main.py
```

Run the frontend:

```bash
npm run dev
```

Open the frontend and you'll see a green/red status for each service.

## Done when

- `docker compose ps` shows all three databases running
- The dashboard shows everything green
