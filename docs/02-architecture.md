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

## Where things are

Grouped by what they are for, most important first. A file is split when it mixes topics, not at a line count;
in practice that keeps files under about 700 lines.

```
backend/app/
  ask/         the question-answering feature
    workflow.py   the fixed pipeline (the baseline), POST /ask, and the answer helpers both modes share
    facts.py      graph widening, company facts, library questions ("how many contracts?")
    agent.py      the LangGraph agent loop, /ask/compare
    tools.py      the agent's tools and what each request has seen
    models.py     which chat models the agent may use, /ask/models
    sessions.py   chats, their memory and context limit
  search/      finding things
    embeddings.py clause embeddings, hybrid (meaning + keyword) search
    graph.py      the Neo4j contract graph
    reconcile.py  keeps the graph consistent with the database
  ingestion/   getting contracts in
    parser.py     lines -> clauses (rules, confidence, LLM fallback)
    pdf_text.py   PDF -> lines (worker pool, tables, OCR)
    documents.py  saving, listing and opening contracts
  core/        shared plumbing
    config.py database.py auth.py llm_keys.py ratelimit.py
  main.py      app wiring, health, key settings   evaluation.py   serves the evaluation results

frontend/src/
  features/ask/            the chat; ask/agent/ holds the agent trace, mode chip and Compare view
  features/sessions/       the sessions list, sidebar list and context meter
  features/evaluation/     Workflow vs Agent, the criteria guide, retrieval scores
  features/{documents,search,graph,parser,clause,pdf,...}   one folder per screen or topic
  components/  shared dialogs and layout     lib/   API client, router, store (browser prefs), text helpers
```
