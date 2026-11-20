# Spec: Answer Quality

## Overview
The evaluation shows each Ask mode wins where the other loses:
- **The agent** finds every needed clause on 75–88% of multi-step questions, against 63–69% for the workflow.
- **The workflow** cites the right clause on 79–80% of the 83 original questions, against 73% for the agent. The agent loses on paraphrased, broad, party-named and amendment questions because it stops after one weak search. The workflow grades the results and retries.

This spec closes that gap in five measured steps, cheapest first:
1. Re-run the agent evaluation, since the follow-ups bug fixed in `code-cleanup.md` inflated its cost numbers.
2. Give the agent the workflow's relevance grader.
3. Add an `auto` mode that routes each question to the mode that is better at that kind of question.
4. Grow the question set, so gains can be told from noise.
5. A reranker, built only if steps 2–3 miss their criteria.

Every step has a pass condition written before it runs. Agent mode or auto becomes the default only if it passes. The changes touch the Q&A pipeline (agent tools, routing), the evaluation harness, and the Ask and Evaluation pages.

## Affected layers
- [ ] ingestion
- [ ] graph (Neo4j)
- [x] vector search (pgvector), only if step 5 is built: reranking after `hybrid()`
- [x] Q&A pipeline: grading inside the agent's search tool, the `auto` router
- [x] sessions: turns record the routed mode and the reason
- [ ] auth & limits (unchanged: `auto` uses the `ask` rate limit)
- [x] evaluation: re-runs, an `--mode auto` option, routing accuracy, new questions
- [x] frontend: an Auto choice in the mode chip, a routing note, Auto on the Evaluation page

## Depends on
- `docs/specs/agentic-ask.md`, which provides agent mode, `/ask/compare`, `eval_answers --mode/--runs/--set`, the stored `answers*` keys and the pre-registered criteria.
- `docs/specs/code-cleanup.md`, which fixed `suggest=False` for the agent and created the shared helpers (`answer_opening`, `followups_event`) plus `ask/tools.py`.
- `grade()` (`workflow.py:130`): the yes/no relevance grader with a one-sentence reason per clause, one gpt-4o-mini call.
- `scope()` and `company_facts()`, which already detect named contracts and companies and need no extra call to reuse.
- The question sets `tests/qa/questions.json` (83, with `kind`: paraphrase, broad, …) and `tests/qa/agentic_questions.json` (16: multihop, party_then_clause, compare), both with gold phrases.
- An OpenAI key and the corpus loaded (`tests/qa/load_corpus.py`) for the eval runs.

## Backend changes
**Step 1. Re-measure (no code).** Run `eval_answers --mode agent --runs 3` on both sets to replace `answers_agent` and `answers_agentic_agent`. This refreshes `llm_calls` and `tokens` now that follow-ups are no longer counted. Quality numbers should stay within the old run range, because the bug only added a call after the answer.

**Step 2. Grading inside the agent's search tool** (`ask/tools.py`, `run_tool` → `search_clauses`):
- **What it does:** after `hybrid()` + `expand_thin()`, call `A.grade(c.key, query, hits)`.
- **What the model sees:** each clause line gets its verdict, `relevant` or `not relevant: <reason>`.
- **When nothing is relevant:** the tool's text ends with "None of these answer it. Search again with the wording a contract would use, or without narrowing." The step summary says "0 of N relevant".
- **Shared grading:** relevant clause ids are stored in `Ctx.relevant`. `chosen()` uses them as the fallback when the agent stops at a limit without `finish` (today the fallback is clauses it read, else the top 4 of the last search).
- **Not hidden:** clauses graded irrelevant still get a number, so the model can overrule the grader by listing them in `finish`.
- **Turning it off:** setting `AGENT_GRADE_SEARCH: bool = True` to false gives the A/B baseline.
- **Cost:** +1 gpt-4o-mini call per search, about 1.5–2.5k input tokens (8 clauses × ≤1200 chars). A typical agent answer makes 1–2 searches, so +1–2 calls, keeping it within about 1.5× the workflow's calls.
- **The step event:** it gains `relevant: number[]` (positions), so the trace can mark the kept clauses.

**Step 3. `auto` mode, a router with no extra LLM call by default:**
- **Request:** `AskIn.mode` accepts `^(agent|workflow|auto)$`. `ASK_DEFAULT_MODE` may be `auto`.
- **New `route(question, before, cards) -> (mode, reason)`** in the new `ask/route.py`. It's rule-based and goes to the agent when:
  - (a) `company_facts(cards, question)` names a company that appears in more than one contract, or the question names one company with a clause topic (party_then_clause);
  - (b) the question compares or spans contracts ("compare", "both", "difference between", "each of", "across", two contract names via `scope` cards);
  - (c) amendment wording ("amend", "amendment", "as amended", "supersede").

  Otherwise it goes to the workflow. Library questions always go to the workflow (they're answered with no search).
- **Why rules first:** they cost nothing and are explainable. An optional LLM classifier is used only if rule accuracy is below the bar in Evaluation. It would be one gpt-4o-mini structured call, `Route{reason, mode}`, behind `ASK_ROUTER: "rules" | "llm"`.
- **Events:** `ask()` sends a new `routed` event, `{mode, reason}`, before the chosen pipeline's events. The turn stores `routed: {mode, reason}`, and `stats.mode` stays the mode that actually answered.
- **`/ask/compare`** is unchanged: it compares workflow and agent, and auto is just a choice between them.

**Step 4. Grow the question set (data only).** Add about 40 questions to `tests/qa/questions.json` on the losing shapes:
- about 15 paraphrased (everyday wording, no legal terms);
- about 10 broad ("what are my obligations…");
- about 10 that name a party;
- about 5 about amendments.

Each gets a gold phrase checked against the stored clauses before it's added (same check as `agentic_questions.json`). IDs start at 101. The original 83 stay as they are, so old results remain comparable on that subset.

**Step 5. Reranker (only if steps 2–3 miss criterion 1).**
- **What it does:** `hybrid(..., rerank=True)` pulls the top 30 instead of 20, re-scores them with a local cross-encoder, and returns the top K.
- **Library:** FlashRank (ONNX, no torch, model about 30–100 MB, CPU), lazy-loaded once per process.
- **Settings:** `SEARCH_RERANK: bool = False` and `SEARCH_RERANK_MODEL`.
- **Cost:** no LLM call, about 50–150 ms of CPU per search.
- **Output:** results carry a `rerank_score` and the existing `vector_rank`/`keyword_rank`.

**Unchanged:**
- **Database:** no Alembic migration. Turns are JSONB, so `routed` needs no schema change.
- **Neo4j:** no change.
- **New endpoints:** none.

## Frontend changes
- **`features/ask/api.ts`:**
  - `AskMode` (the request type) gains `"auto"`.
  - A new `AskEvent` variant: `{ event: "routed"; mode: "agent" | "workflow"; reason: string }`.
  - `AgentStep` gains `relevant?: number[]`.
- **`features/ask/agent/ModeBar.tsx`:** a third radio choice, "Auto: picks the agent for multi-step and company questions, the workflow otherwise". The collapsed chip shows "Auto". Model choice stays available, because auto may run the agent.
- **`features/ask/events.ts`:** `turnOf` handles `routed` (stores `routed`, sets `mode`). `storedTurns` maps `routed`.
- **`features/ask/AskPage.tsx`:** above the trace, a one-line routing note: "Auto chose the agent: the question compares two contracts."
- **`features/ask/agent/AgentTrace.tsx`:** in a search step, kept clauses are marked "relevant", and the rest are dimmed with the grader's reason on hover or focus (text, not colour alone).
- **`features/evaluation/WorkflowVsAgent.tsx`:**
  - adds an "Auto" series when `answers_auto*` keys exist;
  - adds a routing-accuracy line (routed to the mode that wins that `kind`);
  - the per-question table shows where auto chose wrong.
- **`features/evaluation/criteria.ts`:** adds a "routing accuracy" definition with a pass and a fail example.

## Files to create
- `backend/app/ask/route.py`: the `route()` rules (and the optional LLM classifier) for auto mode
- `backend/tests/integration/test_route.py`: routing rules on fixed questions, the `routed` event, auto falling back to the workflow
- `docs/specs/answer-quality.md`: this spec

## Files to modify
- `backend/app/ask/tools.py`: grade inside `search_clauses`, `Ctx.relevant`, `chosen()` fallback, `relevant` in the step summary
- `backend/app/ask/agent.py`: `SYSTEM` adds one line about verdicts ("a clause marked not relevant is rarely evidence; search again instead")
- `backend/app/ask/workflow.py`: `AskIn.mode` pattern, `auto` resolution and the `routed` event in `ask()`, `routed` in the turn
- `backend/app/core/config.py`: `AGENT_GRADE_SEARCH`, `ASK_ROUTER`, `ASK_DEFAULT_MODE` doc (`auto` allowed), `SEARCH_RERANK*` (step 5)
- `backend/app/search/embeddings.py`: optional `rerank` (step 5 only)
- `backend/tests/eval_answers.py`: `--mode auto` (runs `route()` per question and records `routed_to` and `route_reason`), a routing-accuracy summary, a `--grade-search on|off` flag for the step-2 A/B, and result keys `answers_auto`, `answers_agentic_auto`, `answers_agent__nograde` (the old naming scheme)
- `backend/tests/qa/questions.json`: about 40 new questions (step 4)
- `backend/tests/integration/test_agent.py`: grading in search (the verdict is in the tool text, `chosen()` falls back to relevant clauses, `AGENT_GRADE_SEARCH=False` restores the old behaviour)
- `backend/tests/run_all.py`: register `test_route`
- `frontend/src/features/ask/api.ts`, `events.ts`, `AskPage.tsx`, `agent/ModeBar.tsx`, `agent/AgentTrace.tsx`: as in Frontend changes
- `frontend/src/features/evaluation/WorkflowVsAgent.tsx`, `criteria.ts`: the Auto series, routing accuracy
- `docs/22-agentic-ask.md`, `README.md`: new results and the decision (real numbers only)

## New dependencies
- Steps 1–4: no new dependencies.
- Step 5 only, if built: `flashrank`, pinned in `backend/pyproject.toml` and lazy-imported.

## Evaluation
Every number is over `--runs 3` and reported as a range. A gain counts only if the new run range sits above the old one, so no overlap. Run-to-run noise is 0–5 points. These conditions are written before the runs, in the same style as `agentic-ask.md`:

| # | Step | Measure | Pass if |
|---|---|---|---|
| A | 1 | Agent `llm_calls` / `tokens` (both sets) | Lower than the stored results; quality within the old range (sanity) |
| B | 2 | Agent "cited the right clause", original 83 | ≥ 79% across all 3 runs (matches the workflow's low end); today it's 73% |
| C | 2 | Agent `found_all`, the 16 multi-step questions | Stays ≥ 75% (grading must not cost the multi-step win) |
| D | 2 | Agent `llm_calls` (median) | ≤ 2× the workflow's |
| E | 3 | Auto "cited the right clause", original 83 | ≥ the workflow's high end (80%) in all 3 runs |
| F | 3 | Auto `found_all`, 16 multi-step | ≥ 75% (the agent's low end) |
| G | 3 | Routing accuracy: share of questions routed to the mode that wins that `kind` (from the step-1/2 runs) | ≥ 85%. Below that, try `ASK_ROUTER=llm` and measure again |
| H | 4 | Same B/E on the 40 new questions | Holds within 5 points of the original-set result (no overfit to the 83) |
| I | 5 | Retrieval: gold clause in the top 8, paraphrase kind (`tests/eval_qa.py`) | +5 points or more over the stored hybrid result; otherwise don't ship the reranker |

**What changes the default:**
- If **E, F and G** pass, `ASK_DEFAULT_MODE = "auto"`.
- Else if **B, C and D** pass, `ASK_DEFAULT_MODE = "agent"`.
- Otherwise it stays `"workflow"`, and `docs/22-agentic-ask.md` records why.

**Every result gets a note** in `docs/22-agentic-ask.md` answering: what we expected, what happened and why (which question kinds moved), and what we do next.

## Risks / open questions
- **The grader can be wrong.** A clause wrongly marked irrelevant might be skipped by the agent. Mitigation: it keeps its number and can still be listed in `finish`, and criterion C catches a multi-step regression.
- **Cost.** The grader adds 1–2 calls per agent answer. If D fails, grade only the first search, or only when the agent narrowed to specific contracts.
- **The rule router is brittle** across phrasings. G measures it, and the LLM router is the fallback at +1 call.
- **Who labels "the right mode" for G.** The per-`kind` winner comes from step-1/2 results on the original set, and step 4's new questions keep it honest. Open question: should a question whose two modes tie count as either-correct? Proposed: yes.
- **Small set.** 83 + 16 (+ about 40) questions over 28 contracts. Results describe this corpus, not contracts in general.
- **Step 5 adds a model file to the server** (download size, cold start). That's why it's gated behind criterion I and off by default.
- **New gold phrases must be verified** against the stored DB clauses before they're added. An unverified phrase silently lowers every score.

## Definition of done
- [ ] Step 1: re-run results are stored and the Evaluation page shows the corrected agent cost
- [ ] Step 2: in `test_agent`, the search tool text includes verdicts, `chosen()` falls back to relevant clauses, and `AGENT_GRADE_SEARCH=False` gives the old behaviour
- [ ] Step 3: `test_route` covers each rule (company in two contracts, compare, amendment, library → workflow, default → workflow) and `mode=auto` sends `routed` then the chosen pipeline's events
- [ ] A turn saved in auto mode reloads with its routing note, and old turns render unchanged
- [ ] Step 4: about 40 new questions added, each gold phrase verified against the DB, and the original 83 untouched
- [ ] Criteria A–H measured with `--runs 3`, written to `docs/22-agentic-ask.md` with the expected / happened / next note, and `ASK_DEFAULT_MODE` set by the rule above
- [ ] Step 5 built only if B or E failed, and shipped only if I passes
- [ ] `uv run python -W ignore -m tests.run_all` passes
- [ ] `cd frontend && npm run build && npm run lint` passes (type check included), and `npx knip` reports nothing unused
