# 2. Architecture

Jurion has four layers.

```
  [ Frontend: React ]  ← you use this
          |
          v
  [ Backend: FastAPI ] ← the API; also kicks off background jobs
     |          |
     v          v
 [ Workers ]  [ RAG pipeline (query) ]
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
- **Ragas** – a library that scores how good the answers are (more in [Phase 5](17-phase5-evaluation.md)).

## Where we are today

Built so far:
- Docker Compose with Postgres (pgvector), Neo4j, Redis
- FastAPI app with a `/health` endpoint that checks all three databases
- `contract_chunks` table defined (not yet created automatically)
- Two PDF parsers (`parser.py`, `hybrid_parser.py`) – not wired to any endpoint yet
- React dashboard showing database health

Not built yet: upload endpoint, embeddings, graph writes, query engine, chat UI, evaluation.

## Where things are

Grouped by what they are for, most important first.

```
backend/app/
  ask/         the question-answering feature
    workflow.py   the fixed pipeline (the baseline) and POST /ask
    agent.py      the LangGraph agent, /ask/models, /ask/compare
    sessions.py   chats, their memory and context limit
  search/      finding things
    embeddings.py clause embeddings, hybrid (meaning + keyword) search
    graph.py      the Neo4j contract graph
    reconcile.py  keeps the graph consistent with the database
  ingestion/   getting contracts in
    parser.py     PDF -> clauses
    documents.py  saving, listing and opening contracts
  core/        shared plumbing
    config.py database.py auth.py llm_keys.py ratelimit.py
  main.py      app wiring, health, key settings   evaluation.py   serves the evaluation results

frontend/src/
  features/ask/            the chat; ask/agent/ holds the agent trace, mode chip and Compare view
  features/sessions/       the sessions list, sidebar list and context meter
  features/evaluation/     Workflow vs Agent, the criteria guide, retrieval scores
  features/{documents,search,graph,parser,clause,pdf,...}   one folder per screen or topic
  components/  shared dialogs and layout     lib/   API client, router, helpers
```
