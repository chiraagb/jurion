# 16. Ask: answers with citations (CRAG)

The **Ask** tab (`/ask?q=...`) answers a question from your saved contracts and cites the clauses it used.

## The pipeline (`backend/app/ask.py`)

0. **Narrow with the graph (when 2+ contracts have graphs):** one cheap AI call reads the question and each contract's parties and roles, and returns the contracts the question names by company, role or kind of document ("the bank", "the clinical trial agreement"). It must not guess from the topic, and if a name fits several contracts it returns all of them. Those contracts are searched first; the retry (step 3) searches every contract, so a wrong narrowing is recoverable.
1. **Retrieve:** the same hybrid search as the Search tab (vector + keyword, merged), top 8 clauses.
2. **Grade (the corrective step of CRAG):** one LLM call reads the 8 clauses and returns which ones actually help answer the question.
3. **Rewrite, at most once:** if none passed, the question is rewritten in the wording a contract would use ("cancel early" becomes "termination for convenience") and steps 1–2 run again. A second miss stops there; there is no loop.
3b. **Widen with the graph:** clauses that a relevant clause refers to ("subject to Section 8") are added to the references, marked "pulled in by 9.1". They are dependencies, not matches, so they are not graded.
4. **Answer:** the relevant clauses are numbered `[1] [2] …` and given to the model with the rule "use only these clauses and cite them". With no relevant clause the answer is "I couldn't find this in your saved contracts." and the answer model is never called, so it cannot make something up.

The API streams one JSON object per line (`retrieved`, `graded`, `rewritten`, `sources`, `token`, `done` or `error`), so the page shows each step as it happens.

## The page

- The answer streams in; `[1]` markers become links that open the contract on the cited page.
- Numbered sources below it show the clause, contract, page and a snippet.
- **How I got this answer** lists every retrieved clause with a tick (passed the relevance check) or a cross, and shows the rewritten question if there was one.

## Sessions, clause jumps and comparing

- **Every Ask and Search is saved** to the `query_sessions` table (kind, question, and the full result: answer, cited clauses with their text, and the retrieval trace). Asking the same question again within 10 minutes updates its session instead of adding a copy, so reloads and the back button don't fill the history.
- **History tab** (`/sessions`): your past questions and searches. Open one at `/sessions/<id>`; delete with the bin icon. Sessions are private to you.
- **Compare:** tick two sessions and press *Compare side by side* (`/sessions/compare?a=<id>&b=<id>`). The two answers (or result lists) sit in two columns, with a strip above listing the clauses that appear in **both**.
- **Jump to the clause:** clicking a `[1]` citation, a source, a trace row, a search result or a clause in the "in both" strip opens a side panel with the clause's PDF page and its full text (the exact text the model saw), without leaving the page. *Jump to clause* in the panel opens `/contracts/<id>?page=N&clause=<n>` in a new tab: the contract scrolled to that clause, opened and outlined, with the PDF on its page. Clicking a dot on the embedding map goes there directly.

## The highlighted PDF

Saved contracts are drawn with **pdf.js** (`pdfjs-dist`, loaded only when a PDF is first shown), not the browser's built-in viewer, so the cited clause can be shaded.

- `GET /documents/{id}/clauses/{n}/boxes` returns one rectangle per page for clause `n`. The stored lines keep their left edge, top and bottom but no right edge, so the server reads the PDF again and takes the right-most word inside that band as the right edge. Coordinates are PDF points, origin top-left, the same as the stored lines.
- The viewer scales points to the screen width, draws the rectangle over the canvas, scrolls to it, and shows "Clause on p.6 p.7" buttons when a clause crosses pages.
- It is used in the side panel (every citation, search hit and compare entry) and on the contract screen: opening any clause card there moves the PDF and shades that clause. The Parser Lab keeps the browser's viewer, since an unsaved parse has no stored lines.
- Checked against the 5 saved contracts: each box's top-left matches where the clause heading is found in the PDF.
- Limits: on a two-column page the box can extend over the other column (one rectangle per page, not per line); a scan has no highlight; the viewer has fit-width and page buttons only (no text search or zoom).

## Cost and safety

- Per question: 1 embedding call, 1 grade call, 1 answer call; 2 more calls if it rewrites. All on the user's OpenAI key. `ASK_MODEL` (default `gpt-4o-mini`) in `.env` sets the model for grading, rewriting and answering.
- Limit: 10 questions per minute per user.
- Contract text is treated as data: the prompts tell the model never to follow instructions found inside a clause.
- The page re-asks when you reload or come back to `/ask?q=...`.

Check: `uv run python -W ignore -m tests.integration.test_ask` (fake OpenAI calls, covers rewrite-once, no evidence, error, no key).

## The chat screen

- A conversation thread with the message box pinned at the bottom (Enter sends, Shift+Enter adds a line, a Stop button replaces Send while it answers).
- Each new question scrolls to the **top** of the thread, so attention is on it while the answer streams in beneath.
- Every `[1]` chip and every reference card opens the clause **beside the answer** (docked on wide screens, a sheet on narrow ones) with its PDF page and the clause shaded, plus previous/next buttons across the references. References can be **minimized** to a row of chips (remembered).
- The Ask tab stays mounted, so a running answer and the thread survive a visit to another tab; New chat clears it. Every answer is saved to History.
