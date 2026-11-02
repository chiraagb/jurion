# 2. Architecture

Jurion has four layers.

```
  [ Frontend: React ]  ← you use this
          |
          v
  [ Backend: FastAPI ] ← the API; also kicks off background jobs
     |          |
     v          v
 [ Workers ]  [ AI agent (query engine) ]
     |          |
     v          v
 [ Neo4j ]  [ Postgres + pgvector ]  [ Redis ]
```

## The layers

### Frontend
- **React + Vite + Tailwind CSS** – the web app.
- **React Flow** – draws the graph of clauses the AI looked at, so you can *see* its reasoning.
- **Streaming (SSE)** – answers appear word-by-word instead of all at once.

### Backend
- **FastAPI** – the Python web server. All requests go through it.
- **Background jobs** (Celery or FastAPI BackgroundTasks, using Redis as the queue) – reading a big PDF and calling the AI takes time, so it runs in the background instead of making the user wait.

### Storage
- **Neo4j** – a graph database. Stores things as dots and lines: documents, clauses, parties, and relationships between them like `CONTAINS`, `REFERENCES`, `SUPERSEDES`, `INDEMNIFIES`.
- **Postgres + pgvector** – a normal database that can also store *embeddings* (lists of numbers that represent meaning). Uses an **HNSW index** so "find similar" searches are fast.
- **Redis** – a fast in-memory store. Used as a job queue and a cache.

### AI
- **LLM** (e.g. GPT-4o or Claude) – used to pull out relationships from clauses, decide how to answer a question, and write the final answer. We ask it for **structured JSON** so its output is predictable.
- **Embedding model** (e.g. OpenAI `text-embedding-3-small`, 1536 numbers per text) – turns text into vectors for similarity search.

### Testing quality
- **Ragas** – a library that scores how good the answers are (more in [Phase 5](07-phase5-evaluation.md)).

## Where we are today

Built so far:
- Docker Compose with Postgres (pgvector), Neo4j, Redis
- FastAPI app with a `/health` endpoint that checks all three databases
- `contract_chunks` table defined (not yet created automatically)
- Two PDF parsers (`parser.py`, `hybrid_parser.py`) – not wired to any endpoint yet
- React dashboard showing database health

Not built yet: upload endpoint, embeddings, graph writes, query engine, chat UI, evaluation.
