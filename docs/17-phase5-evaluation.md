# 17. Phase 5: evaluation (plan vs. what was built)

The goal: measure quality with numbers, so changes do not quietly make things worse. The results and findings are in [18. Evaluation](18-evaluation.md); this page records the original plan and how it changed.

## The plan

25 hand-written questions with known answers, scored by the **Ragas** library on faithfulness, answer relevancy, context precision and context recall, run after every significant change.

## What was built

- **83 questions** (77 with an answer, 6 that the contracts cannot answer) over public contracts. Each has a *gold* definition ("a clause of a contract whose file name starts with X and whose text contains this phrase"), so re-parsing a contract does not break it.
- **Retrieval metrics** (right clause in the top 1, 3, 5, 10 and the mean reciprocal rank) for each search setup: vector only, keyword only, hybrid, plus heading context, plus narrowing, plus widening.
- **Answer metrics** from running the real Ask pipeline: answered or refused, cited the right clause, answered from the *wrong* clause (the failure that misleads), faithfulness, and refusing the unanswerable ones.
- **Two commands**, `tests.eval_qa` (retrieval, about 40 embedding calls) and `tests.eval_answers` (answers, a few cents), whose results are shown live on the Evaluation page.

## What changed from the plan

- **Ragas was not used.** Its newest release crashes on import (a module was removed from `langchain_community`), so faithfulness is judged by a small prompt of our own with the same idea: list each claim in the answer and mark it supported or not by the clauses. The judge is a larger model than the one that wrote the answer.
- **Answer relevancy was dropped as a headline**: it came out 100% for every row, so it tells us nothing. It is recorded but ignored.
- **The "did it refuse?" check is a pattern, not an AI judge.** A yes/no AI judge flagged clean answers as refusals; a pattern on how the answer starts is reliable and free.
- **Context recall became "right clause present"** because a gold clause is a known phrase, which is a stricter test than recall over a free-text ground truth.
- **The numbers are not a single score.** Run-to-run noise is about 13 flipped questions out of 77, so the page reports ranges and says what a difference of a point or two means (nothing).

## Still true from the plan

Run it after every significant change, and read some of the rows, not only the totals: two of the bugs recorded in [18](18-evaluation.md) were in the measuring, not the system.
