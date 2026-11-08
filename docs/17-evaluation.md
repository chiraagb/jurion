# 17. Evaluation: does the right clause come back?

Run: `cd backend && uv run python -W ignore -m tests.eval_qa` (about 40 embedding calls, a fraction of a cent). Results land in `backend/tests/qa/results.json` and show on the **Evaluation** tab (`/evaluation`, served by `GET /evaluation`).

## The question set (`tests/qa/questions.json`)

48 questions over the 5 saved contracts (44 answerable: 17 direct, 17 paraphrase, 4 broad, 6 that name a party or document; plus 4 with no answer). Each has a *gold* definition: "a clause of the contract whose file name starts with `doc` and whose text contains `phrase`". A phrase, not a clause number, so re-parsing the contracts does not break it.

| Kind | Count | What it tests |
|---|---|---|
| direct | 17 | The question reuses the clause's words |
| paraphrase | 17 | Same meaning, different words ("walk away" for "terminate") |
| broad | 4 | Names a whole section whose heading holds no text ("What are the terms and conditions?") |
| graph | 6 | Names a company, role or kind of document ("the Marketing Affiliate", "Metavante", "the clinical trial agreement"): where narrowing by the graph should matter |
| none | 4 | The contracts do not answer it (for refusal checks; not scored here) |

Metrics: hit@k (the right clause is in the top k) and MRR (mean of 1 / rank of the right clause), over the 38 answerable questions. Four columns: vector only, keyword only, hybrid (what Search uses), and hybrid + context (what Ask uses).

## Findings

1. **Hybrid is about as good as vector-only.** Keyword search alone is weak (right clause in the top 5: 26%) because the default full-text query needs every word of the question to appear in one clause.
2. **Matching any word did not help.** Tried: any-word keyword query (hybrid MRR 0.65 → 0.51), the same at keyword weights 0.5 and 0.3 (0.60, 0.62), and any-word only when the all-words query finds nothing (0.52, 0.57 at weight 0.5). Questions that reuse the contract's words improved (direct MRR up to 0.82) but paraphrased ones, how people really ask, got worse (0.58 → 0.26–0.44). Kept the original query.
3. **A heading with no text hid its section** (found by using the app: "What are the terms and conditions?" answered "not provided"). The parser cut the contract correctly, but "TERMS AND CONDITIONS" is a page title whose text lives in the clauses after it. Fix: when a retrieved clause is only a heading (fewer than ~60 characters beyond its number and title), the next 6 clauses (up to 3,500 characters) are appended before grading and answering (`expand_thin`).

| | Before | After |
|---|---|---|
| Whole-section questions: right text in the top 3 | 25% | 100% |
| Whole-section questions: right text at #1 | 0% | 75% |
| All questions: right clause in the top 5 | 84% | 90% |
| All questions: MRR | 0.608 | 0.709 |

4. **Prefixing each sub-clause's embedding with its section title** ("TERM > 2.1 Duration") made no measurable difference (hybrid MRR 0.608 → 0.624; one broad question moved from #1 to #3). Kept, since it costs nothing, but it is not a proven gain. Saved contracts must be re-embedded to pick it up (the sparkle button on My contracts).

## Answer quality (`uv run python -W ignore -m tests.eval_answers`, a few cents)

Runs the real Ask pipeline on every question and scores each answer. Written by `gpt-4o-mini` (`ASK_MODEL`), faithfulness scored by `gpt-4o` (`OPENAI_MODEL`), a larger model than the writer.

| Measure | Result (38 answerable) | How it is decided |
|---|---|---|
| Answered (did not refuse) | 95% | An answer is a refusal if there were no relevant clauses, or it starts like one ("The clauses do not…", "I couldn't find…") |
| Cites the right clause | 89.5% | A clause the answer cites as `[n]` is of the right contract and contains the gold phrase |
| Faithful to the clauses it was given | 98.4% | The judge lists each claim in the answer and marks it supported or not by the clauses |
| Refuses when the contracts have no answer | 4 of 4 | Same refusal test, on the 4 unanswerable questions |

By kind: same-words 94% cited, other-words 82%, whole-section 100% (4 questions).

The one failure that misleads a user is an answer that is confident and cited but not from the right clause ("answered from the wrong clause"). Faithfulness cannot catch it, because an answer can be faithful to the wrong clauses; only the gold-clause check does. It has its own metric on the page.

First run: 2 of 38 (5.3%). Q32 ("What does the bank owe if it ends the contract early?") was answered from the template services agreement, with the guess "(in this case, the bank)": the word "bank" only appears in the Oriental Bank contract. Q31 looked wrong but was not: several Service Level Credit clauses really do answer it, so its gold now accepts either phrase.

Fix (contract-aware Ask): the relevance grader now sees each clause's contract name and is told that if the question names a party or kind of document ("the bank", "the clinical trial"), a clause from a contract without it is not relevant. The answer prompt says to name the contract of each statement and never to assume which party the user means. Q32 is now refused in both later runs (the right clause is not retrieved, so "the clauses do not cover it" is the correct answer).

The count still moves between runs because the models are not deterministic: the next two full runs gave **0** and **2** of 38 (the two were broad questions, Q40 and Q41). Read it as "0 to 5%", not a fixed number. Other failures in the latest run: Q10 (retrieval missed, honest refusal), and a few answers with one "unsupported" sentence, mostly the judge marking "this comes from contract X" as unsupported even though the contract name was in its context.

Things found and fixed while building this (kept here because they change how far to trust the numbers):
- **The model cited clause numbers (`[1.1]`) instead of source numbers (`[1]`)** on broad questions, so the UI could not link them. The prompt now says the brackets are source numbers.
- **A yes/no AI judge for "did it refuse" was unreliable**: with a bare true/false answer it said "yes" to nearly everything, and still flagged correct answers after a reason field was added. It was replaced by the pattern test above. Lesson: do not trust an LLM judge for a decision a pattern can make, and read some rows.
- **The first "no answer" question about bitcoin was flawed**: "No, payments are in US dollars [clause]" is a legitimate evidence-based answer. It was replaced by "What is the vendor's annual revenue?".
- A measure "addresses the question" is 100% for every row and tells us nothing; it is recorded but should be ignored.

## Step 2: the graph in Ask (narrowing and widening)

Ask now asks, before searching, which contracts the question names (by company, role or kind of document), using the parties in Neo4j, and searches those first; after grading, it adds clauses that the relevant ones refer to. See `docs/16-ask.md`. The evaluation has a fifth column, **+ Graph**, for retrieval, and the answers are re-scored.

**First attempt, and why it was changed.** The first scoping prompt told the model to pick contracts the question was "clearly about". Retrieval got no better overall (the right clause in the top 5: 88.6% with plain context, 84.1% with the graph). It rescued the two failures it was built for (the "bank" question and the "clinical trial agreement" question) but broke four others:
- "Who owns the new inventions created during the work?" and "Who bears the risk of loss during shipments?" were narrowed to a contract on weak topic cues, not names.
- "What must the Client pay the Service Provider…?" was narrowed to one contract, although "Service Provider" is a role in two.

**The fix** (principle, not tuned to those questions): decide only from words in the question (a company name, a role, a kind of document), never from the topic; and if the name fits several contracts, return all of them. Ask also retries across every contract when the narrowed search finds nothing relevant.

**Result (second run, same 38 questions as before the graph):**

| | Before the graph | With the graph |
|---|---|---|
| Answered (not refused) | 94.7% | 100% |
| Cites the right clause | 89.5% | 94.7% |
| Faithful to the clauses given | 98.4% | 100% |
| Answered from the wrong clause | 5.3% | 5.3% (different questions) |
| Retrieval, right clause in the top 5 (44 questions) | 88.6% (context only) | 88.6% |

What changed question by question: Q10 ("When does the clinical trial agreement start?") and Q32 ("What does the bank owe…?") went from refused to answered with the right clause cited; Q41 improved; Q8 ("Who provides the study drug and at what cost?") got worse (it now cites another source than the right one).

How to read it: **the graph fixed the failure it was built for, questions that name a contract, and did not change overall search quality.** Roughly half the questions (22 of 44) trigger narrowing because many of them name a role. One run on 44 questions cannot separate a small gain from noise, and AI answers differ slightly between runs (the wrong-clause rate has been 0% to 5% across runs).

**The cross-reference widening is built and tested (`test_ask_graph.py`) but none of the evaluation questions isolates it**, because every question has a single right clause. It is not claimed to help.

## Limits

- 38 answerable questions over 5 contracts: one question is 2.6 points, so a point or two is noise. Query embeddings from OpenAI also vary slightly between runs, which can move a tie by one rank.
- "Hybrid + context" counts the expanded text, which is exactly what the Ask model receives, but it is a looser test than a single clause.
- The questions and gold phrases were written by one person (and an AI assistant) after reading the contracts; a second reviewer would catch ambiguous questions (for example "When does the clinical trial agreement start?" competes with every contract's start date).
- Answer scores use an AI judge for faithfulness; a person has read only a handful of the answers. The `ragas` package was not used: its newest release crashes on import (a module removed from `langchain_community`), so the judge is a small prompt of our own that follows the same idea (claims supported by the context).
- The refusal pattern only knows common openings; an answer that refuses in an unusual way would be counted as an answer.
