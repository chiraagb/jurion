# Spec: Code Cleanup

## Overview
This is an audit of unused and duplicated code, plus a size rule for when a file should be split. Scans used were vulture and ruff (backend), knip (frontend), and two code walks. There is no official limit on file size. Most guidance puts a comfortable file at about 150–500 lines and calls 500–1000 lines worth a look, and every source says to split where the topic changes, not at a line count. Rule for Jurion: split only files over about 750 lines, and only at their natural seams. This spec fixes two bugs found during the audit, deletes unused code, merges real duplication, and splits the four oversized files. Behaviour does not change.

## Affected layers
- [x] ingestion (parser split)
- [ ] graph (Neo4j)
- [x] vector search (unused `ContractChunk` model removed)
- [x] Q&A pipeline (shared helpers, splits, `suggest` bug)
- [ ] sessions
- [ ] auth & limits
- [x] evaluation (agent cost numbers include a stray follow-ups call)
- [x] frontend

## Depends on
Current `main` (layout grouped by feature). There are no data dependencies.

## Backend changes
- **Bug:** `agent_pipeline(suggest=False)` still made the follow-ups LLM call. The compare route and `eval_answers` pass `suggest=False`, so the agent's measured calls and tokens included one extra call per question. Fix: `Ctx.suggest`, checked before `followups`.
- **Delete:**
  - `backend/main.py` (a stub) and the empty `requirements.txt`.
  - The empty `tests/unit/`.
  - The `ContractChunk` model: no migration creates it and nothing queries it.
  - An unused import (`embeddings.py`) and an unused variable (`parser.py` `loop`).
- **Shared helpers in `ask/workflow.py`, used by the agent:**
  - `finish_answer` (no evidence → NONE_FOUND, sources/context events, guarded follow-ups).
  - `contract_options`.
  - `stem`.
- **Splits** (no behaviour change; tests still monkeypatch names on `app.ask.workflow`):
  - `ask/workflow.py` gives up `ask/facts.py` (graph widening, company facts, library answers).
  - `ask/agent.py` gives up `ask/tools.py` (tool schemas, Ctx, run_tool) and `ask/models.py` (model factory, allow-list, `GET /ask/models`).
  - `ingestion/parser.py` gives up `ingestion/pdf_text.py` (PDF reading, layout, tables, OCR) and `ingestion/llm_parse.py` (LLM fallback).
- No new endpoints, migrations or LLM calls. Removing the stray follow-ups call saves one LLM call per agent compare or eval question.

## Frontend changes
- **Bug:** `AskPage.tsx` `top-(--heasder-h)` typo, which meant the phone reference sheet was not pinned under the header.
- **Delete:**
  - The unused devDependencies `postcss` and `autoprefixer`.
  - The 6 unused animation variants and the unused props in `animated-theme-toggler.tsx`.
  - Then `lib/utils.ts` (`cn`) plus `clsx` and `tailwind-merge`, which become unused.
  - The `export` keyword on symbols used only inside their own file.
- **Shared:** `lib/text.ts` (`stem`, `middle`) and `lib/store.ts` (localStorage read/write wrapped in try/catch).
- **AskPage split:**
  - `ask/events.ts`: the stream reducers and the stored-session-to-turns mapping.
  - `ask/useResizablePane.ts`.
  - `ask/Clarify.tsx` and `ask/Followups.tsx`.
  - The two identical `onPick` handlers become one.

## Files to create
- `backend/app/ask/facts.py`: widen, company facts, library answers
- `backend/app/ask/tools.py`: agent tool schemas, context, `run_tool`
- `backend/app/ask/models.py`: chat model factory, allow-list, `GET /ask/models`
- `backend/app/ingestion/pdf_text.py`: PDF text, layout, tables, OCR
- `backend/app/ingestion/llm_parse.py`: LLM clause-heading fallback
- `frontend/src/lib/text.ts`, `frontend/src/lib/store.ts`: small shared helpers
- `frontend/src/features/ask/events.ts`, `useResizablePane.ts`, `Clarify.tsx`, `Followups.tsx`: pieces split out of AskPage

## Files to modify
- `backend/app/ask/workflow.py`, `agent.py`, `ingestion/parser.py`, `core/database.py`, `search/embeddings.py`, `main.py`: imports, shared helpers, deletions
- `frontend/src/features/ask/AskPage.tsx`, `AnswerCard.tsx`, `agent/*`, `graph/GraphPage.tsx`, `components/ui/animated-theme-toggler.tsx`, `package.json`
- `docs/02-architecture.md`, `.claude/skills/create-spec/SKILL.md`: file map

## New dependencies
No new dependencies. Removes `postcss`, `autoprefixer`, `clsx` and `tailwind-merge`.

## Evaluation
Answer quality does not change, because no prompt or retrieval logic changes. The agent's efficiency numbers (criterion 4) were inflated by the follow-ups bug. Re-run `uv run python -W ignore -m tests.eval_answers --mode agent` to refresh calls and tokens.

## Risks / open questions
- Tests monkeypatch `workflow.grade` and similar names, so moved functions must still be looked up through `workflow`. Keep those in `workflow.py`.
- Code that is already merged is not going back through a shared review, so the risk is mistakes while moving code. Run the test suite after each file.

## Definition of done
- [ ] `uv run python -W ignore -m tests.run_all` passes
- [ ] `uvx ruff check app tests --select F401,F841` is clean
- [ ] `npm run build`, `npm run lint` and `npm test` pass, and `npx knip` reports nothing
- [ ] In the agent with `suggest=False`, no follow-ups event is sent
- [ ] Ask in workflow, agent and compare still works by hand
