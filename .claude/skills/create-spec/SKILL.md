---
name: create-spec
description: Write a feature spec for Jurion (FastAPI + Neo4j + Postgres/pgvector backend, React/Vite frontend, RAG contract-Q&A pipeline) before implementation. Use when the user wants to create, draft, or write a spec, design doc, or feature plan, e.g. "create a spec for clause-compare".
argument-hint: "Short feature name e.g. 'clause-compare' or 'agent-tool-loop'"
allowed-tools: Read, Write, Glob, Bash(git:*), Bash(find:*), Bash(grep:*)
---

Write a spec for: $ARGUMENTS

## Step 1 — Names

- `feature_slug`: kebab-case, a-z/0-9/-, max 40 chars. `feature_title`: Title Case.
- Spec path: `docs/specs/<feature_slug>.md`. If you can't infer the name, ask.

## Step 2 — Read before writing

- Existing files in `docs/specs/` (don't duplicate) and `docs/02-architecture.md`.
- Only the files the feature touches, using the map below. Never sweep a folder.

| Concern | Path |
|---|---|
| Q&A workflow (scope → retrieve → grade → rewrite → widen → answer → followups), `POST /ask` | `backend/app/ask/workflow.py` |
| Graph widening, company facts, library questions | `backend/app/ask/facts.py` |
| Agent (LangGraph loop) and `/ask/compare`; its tools; models and `/ask/models` | `backend/app/ask/agent.py`, `tools.py`, `models.py` |
| Chat sessions + context limit | `backend/app/ask/sessions.py` |
| Embeddings, hybrid search | `backend/app/search/embeddings.py` |
| Neo4j graph | `backend/app/search/graph.py`, `reconcile.py` |
| Ingestion: saved contracts, PDF reading, clause splitting | `backend/app/ingestion/documents.py`, `parser.py` (entry), `pdf_text.py`, `rules.py`, `llm_parse.py` |
| Settings, DB models and clients, auth, LLM keys, rate limits | `backend/app/core/` (`config.py`, `database.py`, `auth.py`, `llm_keys.py`, `ratelimit.py`) |
| App wiring, health, key settings; evaluation results route | `backend/app/main.py`, `backend/app/evaluation.py` |
| DB migrations | `backend/migrations/versions/` (Alembic) |
| Backend tests | `backend/tests/integration`, `tests/run_all.py` |
| QA / answer evals and question sets | `tests/eval_qa.py`, `tests/eval_answers.py`, `tests/qa/*.json` |
| Frontend features | `frontend/src/features/<ask,ask/agent,documents,graph,search,sessions,evaluation,...>` |
| Frontend API client, routing | `frontend/src/lib/api.ts`, `router.tsx` |

## Step 3 — Spec structure (exact)

```
# Spec: <feature_title>

## Overview            one paragraph: what, why, which layer it touches
## Affected layers     checklist: ingestion / graph (Neo4j) / vector search (pgvector) /
                       Q&A pipeline / sessions / auth & limits / evaluation / frontend
## Depends on          existing features or data required
## Backend changes     endpoints (METHOD path — purpose — auth), DB/Alembic migration,
                       Neo4j schema changes, pipeline-step changes (describe the change,
                       not just the file), LLM calls added (model, cost per request)
## Frontend changes    components, api.ts clients, types
## Files to create     path — one-line purpose
## Files to modify     path — what changes
## New dependencies    or "No new dependencies."
## Evaluation          how quality is measured (new cases in tests/eval_qa.py or
                       eval_answers.py, expected metric) — "N/A" only for non-AI features
## Risks / open questions
## Definition of done  testable checklist; must include `uv run python -W ignore -m tests.run_all`
                       passing and the frontend type check + lint + build passing
```

Verify against existing models and endpoints before writing any "Model / data changes" or "Endpoints" claim.

## Step 4 — Save and report

Save to `docs/specs/<feature_slug>.md` (create the folder if missing). Reply with only:

```
Spec file: docs/specs/<feature_slug>.md
Feature:   <feature_title>
```

Then: "Review the spec, then enter Plan Mode (Shift+Tab twice) to implement." Don't print the spec in chat unless asked.
