# 7. Phase 5: Evaluation (is it actually right?)

Goal: measure answer quality with numbers, so changes don't quietly make things worse.

## Step 1 – A test set of 25 questions

Write 25 questions where we already know the correct answer ("ground truth"). Cover the hard cases:

- SOW vs Master Agreement conflicts
- Indemnity chains across 3+ companies
- Which country's law applies when contracts disagree
- Definitions that change across amendments

Each test looks like:

```json
{
  "question": "Does the liability cap in SOW #2 supersede Section 11 of the 2021 MSA?",
  "ground_truth": "Yes. SOW #2 Section 4 overrides MSA Section 11, capping liability at $250,000.",
  "expected_nodes": ["MSA_2021_Sec11", "SOW_2_Sec4"],
  "relationship_traversed": "SUPERSEDES"
}
```

## Step 2 – Score with Ragas

Run every question through Jurion, then let **Ragas** score the results on four things:

| Metric | Plain-English question it answers |
|---|---|
| **Faithfulness** | Did the answer stick to the retrieved clauses, or make things up? |
| **Answer relevancy** | Did it actually answer the question asked? |
| **Context precision** | Were the retrieved clauses mostly useful (little junk)? |
| **Context recall** | Did we retrieve *all* the clauses needed? |

Run this after every significant change. If scores drop, something broke.

## Done when

- One command runs all 25 questions and prints the four scores
