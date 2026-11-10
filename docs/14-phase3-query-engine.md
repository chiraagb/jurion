# 14. Phase 3: the query engine (plan vs. what was built)

The goal: take a question, find the right clauses, check they are relevant, and write a cited answer. The full, current description is [15. Ask](15-ask.md); this page records the original plan and how it changed.

## The plan

A "check, and retry if bad" loop (Corrective RAG): classify the question, search (vector for simple questions, a Neo4j graph query for multi-step ones), grade the results with an LLM, rewrite the question and retry if the grade is low, then write an answer with citations. Written as a hand-made state machine, with no framework.

## What was built, and what changed

| Plan | Built | Why it changed |
|---|---|---|
| Classify into direct / multi-hop / global | **No classifier.** One hybrid search for every question, plus a small "which contract?" router | A classifier call adds cost and a way to be wrong; the router only decides which *contracts* to search first |
| Vector search or graph search | **Hybrid search** (vector + keyword, merged) in Postgres; the graph is used to *narrow* (which contract) and *widen* (clauses a relevant clause refers to) | Measured: keyword alone is weak, vector alone misses exact terms; the graph helps most with names and cross-references ([18](18-evaluation.md)) |
| Grade with a 0-1 confidence score, threshold 0.7 | The grader returns **which clauses help**, with a one-sentence reason each | A score threshold is arbitrary; per-clause reasons can be shown to the user ("Used because / Left out because") |
| Up to 3 rewrites | **One rewrite**, then stop | A second miss means the contracts do not say it; looping hides that |
| Answer with `[SOW_2: Section 4]` style citations | Numbered `[1] [2]` citations that open the clause on its PDF page | The UI can link a number; free-text names could not be checked |
| `POST /query` | `POST /ask`, streamed as one JSON event per line | The page shows each step as it happens |

Added later, not in the plan: a refusal that never calls the answer model when nothing is relevant; "Which contract do you mean?" when a question is about one contract but does not say which; answers to questions about the library itself ("how many contracts?") straight from the databases; company facts from the graph; and chat sessions with memory and a context limit.

## Still true from the plan

- The answer model sees only the retrieved clauses and is told to use nothing else, and to treat text inside a clause as data, never as instructions.
- Bad retrieval triggers a rewrite or an honest "I couldn't find this", not a made-up answer.
- The retry is bounded: it can never loop.
