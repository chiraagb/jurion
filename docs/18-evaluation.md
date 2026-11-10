# 18. Evaluation: does the right clause come back?

Run: `cd backend && uv run python -W ignore -m tests.eval_qa` (about 40 embedding calls, a fraction of a cent). Results land in `backend/tests/qa/results.json` and show on the **Evaluation** tab (`/evaluation`, served by `GET /evaluation`).

## The question set (`tests/qa/questions.json`)

54 questions over the 5 saved contracts (50 answerable: 17 direct, 17 paraphrase, 4 broad, 6 that name a party or document, 6 that need two linked clauses; plus 4 with no answer). Each has a *gold* definition: "a clause of the contract whose file name starts with `doc` and whose text contains `phrase`". A phrase, not a clause number, so re-parsing the contracts does not break it.

| Kind | Count | What it tests |
|---|---|---|
| direct | 17 | The question reuses the clause's words |
| paraphrase | 17 | Same meaning, different words ("walk away" for "terminate") |
| broad | 4 | Names a whole section whose heading holds no text ("What are the terms and conditions?") |
| graph | 6 | Names a company, role or kind of document ("the Marketing Affiliate", "Metavante", "the clinical trial agreement"): where narrowing by the graph should matter |
| multi | 6 | The answer needs two clauses at once, linked by a cross-reference ("how long does it run, and when can it be ended early?"). Counted as found when the top results together contain both answer phrases. |
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

Ask now asks, before searching, which contracts the question names (by company, role or kind of document), using the parties in Neo4j, and searches those first; after grading, it adds clauses that the relevant ones refer to. See `docs/15-ask.md`. The evaluation has a fifth column, **+ Graph**, for retrieval, and the answers are re-scored.

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

### Widening on its own (second run, 50 answerable questions)

A separate column, **+ Narrowed**, shows narrowing without widening, so widening's own effect is the difference between it and **+ Widened** (a pulled-in clause is placed right after the clause that referred to it). Two changes went in first: a clause pulled in by reference that is itself only a heading ("Article 12") now brings its section too, and six questions were added that need two linked clauses (`multi`).

| Right clause(s) in the top 5 | Plain context | + Narrowed | + Widened |
|---|---|---|---|
| All 50 answerable questions | 84% | 86% | 88% |
| The 6 questions that need two linked clauses | 50% | 67% | 83% |

Widening added clauses for 12 of the 50 questions. It **rescued one question outright** (the outsourcing agreement's "what other warranties" question: found in neither of the other columns, found at rank 4 once Article 12 was pulled in) and moved another up (7 → 4). Four questions ranked lower with widening, only because the pulled-in clause sits inside the list and pushes later results down; in Ask every pulled-in clause is in the answer's context, so that is a measuring artefact, not a loss, but it means the rank columns understate widening.

How to read it: this is the first evidence that cross-reference widening helps, and it is thin. It rests on six questions that I wrote knowing which clauses link, one clear rescue, and one run. It supports "widening helps on questions that need linked clauses", not a general claim. Narrowing alone also helped here (+2 points in the top 5 over all questions, 50% → 67% on the linked-clause questions).

## Growing the library from 5 to 15 contracts

Ten public contracts (cooperation, sponsorship, app development, endorsement, outsourcing, technology development, hosting, co-branding and intellectual-property agreements) were added to the same account through the app's own steps (`tests/qa/load_corpus.py`: parse, embed, build the graph), and 29 questions with verified answer text were added: 83 questions in all, 77 with an answer and 6 without. Nothing else changed, so the effect of a larger library is visible.

**It got harder.** On the same 44 questions, the right clause was cited in **95.5% of answers with 5 contracts and 84.1% with 15**; right-clause-in-top-5 fell from the mid 80s to the high 70s. The 27 new questions scored about the same as the old ones did on 15 contracts (about 85%).

**What the 12 answers that missed the right clause were** (15 contracts, soft narrowing):
- 7 refusals: the right clause was not found, even after the retry (for example "What does the bank owe if it ends the contract early?" is refused again, now that there are more contracts to confuse it).
- 2 real mistakes: the question named a contract, but the answer used a look-alike ("manifest system services agreement" was answered from a generic Master Services Agreement; "mask outsourcing agreement" from the Oriental outsourcing agreement).
- 2 ambiguous questions: "Who owns the new inventions created during the work?" and "Which courts have jurisdiction over disputes?" now have valid answers in several contracts, and the test accepts one. Not a failure of the system.
- 1 correct answer whose citation was written "clause 12.3" instead of `[n]`, so it did not count.

**Narrowing at this size.** The first measurement showed **hard** narrowing (search only the contracts the graph picks) losing the right clause for questions that name a document type several contracts share ("the technology development agreement") or a topic ("inventions"). So Ask now uses **soft narrowing**: the named contracts first (8 results) plus the best 4 from every contract. Measured on the clauses Ask actually gives the grader (77 answerable questions): right clause present for 68 with no narrowing (88.3%), 69 with hard (89.6%), **71 with soft (92.2%)**. Soft narrowing recovered 2 of the 3 questions that hard narrowing lost, and 1 is still lost. Narrowing rescued 4 questions that plain search missed. The router is an AI model, so its choices differ between runs (hard narrowing's top-10 rate was 88.3% in one run and 90.9% in the next); at this size the soft-versus-hard difference is two questions.

**Widening, now on the larger library.** On the 6 questions that need two linked clauses, the right clauses are in the top 10 for 50% with plain context, 83% with narrowing, and **100% with widening**; in the top 5, 33% → 67% → 83%. Still only six questions I wrote knowing which clauses link, but the direction held on a library three times the size.

**Answers on 15 contracts with soft narrowing** (77 answerable): answered 90.9%, cites the right clause 84.4%, answered from the wrong clause 6.5% (4.5% on 5 contracts), faithful 99.1%, and 6 of 6 unanswerable questions refused.

## Growing from 15 to 22 contracts (look-alikes)

Added a distributor agreement with two amendments, three services agreements and a duplicate development agreement. Same 77 questions, same code, run twice (the "Which contract?" step is off in both):

| | 15 contracts | 22 contracts |
|---|---|---|
| Right clause in top 10 (graph) | 90.9% | 92.2% |
| Right clause in top 1 (graph) | 49.4% | 50.6% |
| Answered | 94.8% | 92.2% |
| Cites the right clause | 87.0% | 79.2% |
| Answered from the wrong clause | 9.1% | 13.0% |
| Faithful | 98.2% | 97.8% |
| Refused correctly | 6 of 6 | 6 of 6 |

Retrieval did not move; the answer step cites the wrong clause more often when several contracts have a similar clause. Run-to-run noise is about 13 flipped questions, so 1 to 3 points mean nothing. The "Which contract?" step is the intended fix and is not yet measured.

## Re-measured on 28 contracts (10 Nov 2026)

The 15 and 22-contract columns above were quoted from runs that were not all archived: the later 15-contract run overwrote the 22-contract one in `results.json`, so the 22-contract figures could not be traced to a stored file. Both full evaluations were re-run on the library as it stands (22 public contracts plus the 6 realistic test contracts in `demo/test-contracts/`), and the stored 15-contract results were kept as `retrieval_15_contracts` and `answers_15_contracts`.

| | 5 contracts | 15 contracts | 28 contracts |
|---|---|---|---|
| Right clause in the top 5 (hybrid + context) | | 77.9% | 75.3% |
| Right clause in the top 10 with the graph | | 90.9% | 88.3% |
| Answered | 100% | 94.8% | 93.5% |
| Cites the right clause | 95.5% (44 questions) | 87.0% | 81.8% |
| Answered from the wrong clause | 4.5% | 9.1% | 13.0% |
| Faithful (AI judge) | 100% | 98.2% | 97.1% |
| Unanswerable refused | 4 of 4 | 6 of 6 | 6 of 6 |

Linked-clause questions (6): right clauses in the top 10 for 50% with plain context, 67% with narrowing, **100% with widening** (top 5: 33%, 50%, 83%), the same direction as before. The 6 `graph` questions (they name a contract) and the 6 `multi` ones were all cited correctly; the weak spots are `paraphrase` (78% cited) and `broad` (50% of 4).

The trend is steady, not a collapse: each tripling of the library costs roughly 5 to 10 points of right-clause-cited, with most of the loss being the answer step choosing a look-alike clause, not retrieval (top 10 moved 2.6 points). Run-to-run noise is about 13 flipped questions, so compare columns, not single points.

## "Which contract?" rate (10 Nov 2026)

Run on the router alone (`scope()`), without searching, over the 83 evaluation questions and 28 contracts. First prompt: **26 of 83 (31%)** flagged as needing a contract choice. Reading them: about half were fair ("What are the payment terms?" names no contract), but several named their contract by kind or role ("the outsourcing agreement", "the manifest system services agreement", "the Marketing Affiliate") or asked across contracts ("Which agreement requires…"), where asking the user is only friction. The prompt now says so, and `ambiguous` is forced to false in code whenever the router returned a contract. Re-measured: **19 of 83 (23%)**, and the remaining ones name nothing. The router is an AI model and varies between runs (a different handful of questions flipped), so this is a rate for this deliberately vague question set, not for real use.

## A document with no sections (found 10 Nov 2026)

One of the four public Federated files, a 5-page limited power of attorney, is one block of prose with no headings. The local parser found no structure and the AI heading picker found none either, so the upload ended in the error "LLM found no structure". It is now kept as **one clause** (identifier `DOC`, confidence capped at 0.5, with the note "No sections were found, so the whole document is kept as one clause"), so it can still be saved, searched and cited. A test in `tests/integration/test_parse.py` covers it. The other three Federated files parse normally (11, 4 and 6 clauses, scores 0.91, 1.0 and 0.8).

## Limits

- Widening is measured on only 6 questions I designed to need it, with one clear rescue.
- 38 answerable questions over 5 contracts: one question is 2.6 points, so a point or two is noise. Query embeddings from OpenAI also vary slightly between runs, which can move a tie by one rank.
- "Hybrid + context" counts the expanded text, which is exactly what the Ask model receives, but it is a looser test than a single clause.
- The questions and gold phrases were written by one person (and an AI assistant) after reading the contracts; a second reviewer would catch ambiguous questions (for example "When does the clinical trial agreement start?" competes with every contract's start date).
- Answer scores use an AI judge for faithfulness; a person has read only a handful of the answers. The `ragas` package was not used: its newest release crashes on import (a module removed from `langchain_community`), so the judge is a small prompt of our own that follows the same idea (claims supported by the context).
- The refusal pattern only knows common openings; an answer that refuses in an unusual way would be counted as an answer.
