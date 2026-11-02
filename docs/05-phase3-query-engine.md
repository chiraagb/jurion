# 5. Phase 3: Query Engine (answering questions)

Goal: take a user's question, find the right clauses, check they're actually relevant, and write a cited answer.

This is built as a small **state machine** (using LangGraph): a set of steps, where each step decides which step runs next.

## The flow

```
 Question
    |
    v
 1. Classify the question
    |
    +--- simple ------> 2a. Vector search (Postgres)
    |                        |
    +--- multi-step --> 2b. Graph search (Neo4j)
                             |
                             v
                    3. Grade the results
                       |            |
                  good (≥ 0.7)   bad (< 0.7)
                       |            |
                       v            v
              5. Write answer   4. Rewrite the question
                 with citations     and search again
```

This "check, and retry if bad" pattern is called **Corrective RAG (CRAG)**.

## Step 1 – Classify the question

An LLM puts the question in one of three buckets:

| Type | Meaning | Example |
|---|---|---|
| `DIRECT_LOOKUP` | Find one clause | "What's the standard indemnity window?" |
| `MULTI_HOP` | Follow links between clauses/documents | "Does SOW 3's liability cap override the MSA?" |
| `GLOBAL_AGGREGATION` | Look across all contracts | "Which agreements lack a GDPR addendum?" |

## Step 2 – Search

- **Direct lookup:** turn the question into an embedding and find the closest clauses in pgvector.
- **Multi-hop:** run a Cypher query in Neo4j that follows `SUPERSEDES`, `REFERENCES`, etc.

## Step 3 – Grade the results

Ask an LLM: *"Do these clauses actually answer this question?"* It returns:

```json
{ "is_relevant": true, "confidence_score": 0.85, "critique": "..." }
```

If the score is below **0.7**, the results aren't good enough.

## Step 4 – Rewrite and retry

If grading fails, ask the LLM to rephrase the question (using legal synonyms, cross-references) and search again. Keep a counter (`rewrite_count`) so it never loops forever – stop after **at most 3 tries**, then answer with what was found and say the evidence is weak.

## Step 5 – Write the answer with citations

The LLM writes the answer using **only** the retrieved clauses. Every fact must have a citation like:

> The liability cap is $250,000 **[SOW_2: Section 4]**, which overrides the MSA **[MSA_2021: Section 11]**.

Temperature is set to 0 so answers are consistent, not creative.

## Done when

- `POST /query` returns a cited answer
- Bad retrievals trigger a rewrite instead of a made-up answer
