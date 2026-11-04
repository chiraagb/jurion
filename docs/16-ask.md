# 16. Ask: answers with citations (CRAG)

The **Ask** tab (`/ask?q=...`) answers a question from your saved contracts and cites the clauses it used.

## The pipeline (`backend/app/ask.py`)

1. **Retrieve:** the same hybrid search as the Search tab (vector + keyword, merged), top 8 clauses.
2. **Grade (the corrective step of CRAG):** one LLM call reads the 8 clauses and returns which ones actually help answer the question.
3. **Rewrite, at most once:** if none passed, the question is rewritten in the wording a contract would use ("cancel early" becomes "termination for convenience") and steps 1–2 run again. A second miss stops there; there is no loop.
4. **Answer:** the relevant clauses are numbered `[1] [2] …` and given to the model with the rule "use only these clauses and cite them". With no relevant clause the answer is "I couldn't find this in your saved contracts." and the answer model is never called, so it cannot make something up.

The API streams one JSON object per line (`retrieved`, `graded`, `rewritten`, `sources`, `token`, `done` or `error`), so the page shows each step as it happens.

## The page

- The answer streams in; `[1]` markers become links that open the contract on the cited page.
- Numbered sources below it show the clause, contract, page and a snippet.
- **How I got this answer** lists every retrieved clause with a tick (passed the relevance check) or a cross, and shows the rewritten question if there was one.

## Cost and safety

- Per question: 1 embedding call, 1 grade call, 1 answer call; 2 more calls if it rewrites. All on the user's OpenAI key. `ASK_MODEL` (default `gpt-4o-mini`) in `.env` sets the model for grading, rewriting and answering.
- Limit: 10 questions per minute per user.
- Contract text is treated as data: the prompts tell the model never to follow instructions found inside a clause.
- The page re-asks when you reload or come back to `/ask?q=...`.

Check: `uv run python -W ignore -m tests.integration.test_ask` (fake OpenAI calls, covers rewrite-once, no evidence, error, no key).
