# 22. Agentic Ask: the agent, and how it is measured against the workflow

Ask has two ways to answer, and you choose per question (the chip above the message box):

- **Workflow** (`pipeline()` in `backend/app/ask/workflow.py`): fixed steps. Pick the contract, search, check each clause, reword once if nothing fits, answer. The code decides every step.
- **Agent** (`backend/app/ask/agent.py`): a model-driven loop. The model chooses which tool to call next, looks at what came back, and decides when it has enough. Then the same answer prompt writes a cited answer from the clauses it chose.
- **Compare**: both at once, side by side. Saved as its own kind of session (a "Compare" badge in Sessions), never used as chat memory.

The workflow stays for two reasons: it is the baseline the agent is measured against, and it is the fallback if the agent cannot run.

## How the agent works

It is a LangGraph graph with three nodes, `plan` → `tools` → `plan` … → `answer`:

| Tool | What it does |
|---|---|
| `list_contracts` | Your contracts with their summaries and parties |
| `search_clauses` | Hybrid (meaning + keyword) search, optionally narrowed to chosen contracts |
| `read_clause` | One clause in full (for a heading with no text, or a cut-off snippet) |
| `follow_references` | The clauses a clause refers to ("subject to Section 8") |
| `company_info` | What the contract graph knows about a company |
| `library_stats` | Counts and lists about the library itself |
| `ask_user` | Ask which contract you mean (ends the investigation until you answer) |
| `finish` | Stop, and list the clause numbers that answer the question (or say nothing does) |

Every call carries a one-sentence `reason`, shown in "What the agent did" under the answer.

**Safety, enforced in code rather than in the prompt**
- The model never supplies a user id or a database id. It refers to contracts and clauses by small numbers it was shown; a number that was not shown is refused, so it can only ever reach the signed-in user's own data.
- If you chose a contract, searches stay inside it whatever the model asks for.
- All tools are read-only. Clause text is treated as untrusted data.
- Limits per question: `AGENT_MAX_STEPS` (6), `AGENT_MAX_TOOL_CALLS` (10), `AGENT_MAX_TOKENS` (20,000). At a limit the agent answers from what it has and the page says so.
- If the agent fails before it starts writing, the workflow answers and the page says why (a `fallback` event).
- "Not found" is never made up: with no evidence the answer model is not called.

**Choosing the model.** `AGENT_MODEL` is `provider:model` (default `openai:gpt-4o-mini`), chosen from `AGENT_ALLOWED_MODELS` (OpenAI, Anthropic, Google). Add the provider's key with the key icon. Search embeddings stay on OpenAI whatever the agent model is, so an OpenAI key is always needed. Selecting another provider sends clause text to that provider.

**Tracing.** Do not turn on LangSmith/LangChain tracing: it would send contract text to a third party.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `ASK_DEFAULT_MODE` | `workflow` | What Ask uses when the request does not say |
| `AGENT_MODEL` | `openai:gpt-4o-mini` | The agent's model |
| `AGENT_ANSWER_MODEL` | empty | Model that writes the answer (empty = same as `AGENT_MODEL`) |
| `AGENT_ALLOWED_MODELS` | list | Which `provider:model` values may be chosen |
| `AGENT_MAX_STEPS` / `AGENT_MAX_TOOL_CALLS` / `AGENT_MAX_TOKENS` | 6 / 10 / 20,000 | Per-question limits |

## How it is measured

The Evaluation page opens with **Workflow vs Agent**. It explains every criterion in plain words before showing any number, with a real passing and failing answer for each. Every number comes from the same questions and the same scoring for both systems.

```bash
cd backend
uv run python -W ignore -m tests.eval_answers --runs 3                              # workflow, the 83 original questions
uv run python -W ignore -m tests.eval_answers --mode agent --runs 3                 # agent, same questions
uv run python -W ignore -m tests.eval_answers --set agentic --runs 3                # workflow, 16 multi-step questions
uv run python -W ignore -m tests.eval_answers --mode agent --set agentic --runs 3   # agent, same
uv run python -W ignore -m tests.eval_answers --mode agent --model anthropic:claude-sonnet-5-5 --runs 3   # another model
```

- The multi-step questions (`tests/qa/agentic_questions.json`) need more than one clause: an amendment that changes a clause, two contracts compared, or a company named before the clause. Every answer phrase was checked against the stored contracts.
- Each row records its cost (model calls, tokens, time), so the comparison is on cost as well as accuracy.
- Repeat runs (`--runs 3`) are kept so the page shows a lowest to highest range. Models vary between runs: a gap inside that range is not a result.
- The pass/fail rules are text matches against the known answer, not an AI's opinion, except "faithful", which a larger model judges.

**Pre-registered success criteria** (decided before the runs, so the result is not tuned):

1. The agent cites the right clause at least as often as the workflow on the original questions, within run noise.
2. Its confidently-wrong rate is no higher.
3. On multi-step questions it finds every required clause more often than the workflow, by more than the run-to-run range.
4. Its median model calls are at most twice the workflow's.

The agent becomes the default only if 1, 2 and 4 hold. The results below say which did.

## Results

`gpt-4o-mini` for both systems, judged by `gpt-4o`, 3 repeated runs each (the range is lowest to highest). Source: `backend/tests/qa/results.json`; the Evaluation page shows the same numbers with the question-by-question detail.

| Measure | Workflow | Agent |
|---|---|---|
| **83 original questions (77 answerable)** | | |
| Cite the right clause | 79% to 80% | 73% (every run) |
| Confidently wrong (answered, cited, not the right clause) | 13% to 16% | 13% to 17% |
| Faithful to the clauses given | 96% to 99% | 99% |
| Answered (did not refuse) | 92% to 96% | 86% to 90% |
| Unanswerable questions refused | 6 of 6 | 6 of 6 |
| Median model calls / tokens | 3 / 5,900 to 6,000 | 4 / 8,100 to 8,200 |
| Median time / slowest 1 in 10 | 11 s / 13 to 14 s | 8 s / 12 s |
| **16 multi-step questions** | | |
| Cite the right clause | 81% | 81% to 94% |
| Cite every required clause | 63% to 69% | 75% to 88% |
| Median model calls / tokens | 3 / 5,500 to 5,700 | 4 / 7,600 |

By question type (right clause cited):

| Type | Workflow | Agent |
|---|---|---|
| Compare two contracts (5) | 60% (found every piece: 40% to 60%) | 100% |
| Company named first (5) | 80% | 100% |
| Needs two linked clauses (6) | 83% to 100% | 100% |
| Amendment / follow-up (6) | 100% (found every piece: 67%) | 50% to 83% (found every piece: 33% to 67%) |
| Names a party (6) | 100% | 83% |
| Other wording (32) | 72% to 78% | 63% to 69% |
| Whole section (4) | 50% to 75% | 25% to 50% |

### Against the pre-registered criteria

1. **Cite the right clause at least as often on the original questions: not met.** The agent is 73% in all three runs against 79% to 80%, outside run noise.
2. **Confidently wrong no higher: met**, within noise (13% to 17% against 13% to 16%).
3. **Finds every required clause more often on multi-step questions: met**, with the caveat of 16 questions. The agent's worst run (75%) is above the workflow's best (69%).
4. **At most twice the model calls: met** (4 against 3), at about 1.4 times the tokens.

The default needs criteria 1, 2 and 4, so **`ASK_DEFAULT_MODE` stays `workflow`**. The agent is available per question.

### What the numbers mean

- The agent wins where the question needs evidence from more than one place: two contracts, or a company named before the clause. It decides to search twice and keep both pieces.
- It loses on ordinary lookups. With only a short snippet and no separate relevance check it keeps fewer right clauses for paraphrased and whole-section questions, and it sometimes finishes after one search.
- The amendment questions (the base clause plus the amendment that changes it) are the agent's weakest multi-step type: it often cites only one of the two.
- It is faster at the median because it skips the scope, grade and rewrite calls, but it reads more text per answer.
- Likely next step, not done: route by question shape (plain lookup to the workflow, multi-step to the agent), or give the agent a grading step.
