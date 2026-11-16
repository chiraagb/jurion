# 15. Ask: answers with citations (CRAG)

The **Ask** tab (`/ask?q=...`) answers a question from your saved contracts and cites the clauses it used.

## The pipeline (`backend/app/ask/workflow.py`)

0. **Narrow with the graph (when 2+ contracts have graphs):** one cheap AI call reads the question and each contract's parties and roles, and returns the contracts the question names by company, role or kind of document ("the bank", "the clinical trial agreement"). It must not guess from the topic, and if a name fits several contracts it returns all of them. Those contracts are searched first (8 results), and the best 4 results from **every** contract are added after them (**soft narrowing**), so a wrong guess cannot hide the right clause; the retry (step 3) also searches every contract. Soft narrowing was added after growing the library to 15 contracts showed hard narrowing losing the right clause when a question named a document type several contracts share ("the technology development agreement").
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

- **Chats are sessions.** A chat is one row in `query_sessions` (kind `chat`) holding every turn: question, answer, cited clauses and the retrieval trace. The browser sends only the `session_id`; the server loads the chat, so it survives a reload.
- **The chat has memory.** The answer model is sent the earlier questions and answers of the session (citation marks like [1] removed, clauses not repeated), then the new question with its own retrieved clauses. A follow-up that names no contract ("how fast must they report a breach?") stays in the contract the chat was last searched in, instead of asking "Which contract?" again.
- **Each session has a context limit** (`ASK_SESSION_TOKENS`, 16,000 tokens by default, estimated at 4 characters a token). The Ask header shows how much is left. When the chat leaves less than 4,000 tokens for the next question's clauses, the session is full and asks you to start a new one. The limit is deliberately far below the model's window: answers get worse as the context grows.
- **Sessions tab** (`/sessions`): your chats with their meters. Open one to continue it in Ask (`/ask?s=<id>`); delete with the bin icon. Sessions are private to you. Saved searches are still stored and open at `/sessions/<id>`, but are not listed. The old side-by-side compare was removed.
- **Jump to the clause:** clicking a `[1]` citation, a source, a trace row, a search result or a clause in the "in both" strip opens a side panel with the clause's PDF page and its full text (the exact text the model saw), without leaving the page. *Jump to clause* in the panel opens `/contracts/<id>?page=N&clause=<n>` in a new tab: the contract scrolled to that clause, opened and outlined, with the PDF on its page. Clicking a dot on the embedding map goes there directly.

## The highlighted PDF

Saved contracts are drawn with **pdf.js** (`pdfjs-dist`, loaded only when a PDF is first shown), not the browser's built-in viewer, so the cited clause can be shaded.

- `GET /documents/{id}/clauses/{n}/boxes` returns one rectangle per page for clause `n`. The stored lines keep their left edge, top and bottom but no right edge, so the server reads the PDF again and takes the right-most word inside that band as the right edge. Coordinates are PDF points, origin top-left, the same as the stored lines.
- The viewer scales points to the screen width, draws the rectangle over the canvas, scrolls to it, and shows "Clause on p.6 p.7" buttons when a clause crosses pages.
- It is used in the side panel (every citation and search hit) and on the contract screen: opening any clause card there moves the PDF and shades that clause. The Parser Lab keeps the browser's viewer, since an unsaved parse has no stored lines.
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
- The Ask tab stays mounted, so a running answer and the thread survive a visit to another tab; New chat clears it. Every answer is saved in the chat's session.

## "How I got this answer" explains the choices

- **Which contract?** Each search says how the contract was chosen: "Narrowed to X first, with the best of all 15 contracts added after", or "None was named, so all 15 contracts were searched", with the router's one-sentence reason.
- **Used because / Left out because.** The grader gives a one-sentence reason for every clause it keeps or drops, shown under that clause. The reasons are saved in the session too.
- **A question that names no contract is never answered for an invented one.** "Which law governs the agreement?" does not say which agreement, and the grader is told never to assume one: every clause from any contract that answers it counts, and the answer is given per contract ("For the Endorsement Agreement: Florida. For the Development Agreement: New York…"). Before this was added, the grader quietly treated the top-ranked clause's contract as "our agreement" and dropped the rest. The reasons in the panel are what exposed it.

## Questions about the library itself

"How many contracts do we have?", "list my contracts", "how many companies?" and "which companies are in more than one contract?" are not written in any clause, so searching clauses can only fail (it used to answer "I couldn't find this"). `library_kind()` in `app/ask/workflow.py` recognises these by shape, short and anchored at both ends so "how many contracts mention indemnity?" still goes to search, and `library_answer()` answers from Postgres and Neo4j with no OpenAI call. Anything else about the library (for example "which contracts have no termination clause?") is still a search question and may be answered badly: that needs an aggregate step, not built.

## Companies, relationships and follow-ups

- **Company facts:** clause search cannot answer "what is Ingram Micro?" or "how are these two contracts related?". `company_facts()` in `app/ask/workflow.py` looks for company names (and aliases) in the question and in the last two questions of the chat (sent as `before`, so "these two contracts" works), and gives the answer model what the graph knows: each company's role in each contract, the contract summaries, and which companies the contracts share. The user sees it under "Used the contract graph". If no clause is relevant but the graph has facts, the answer is written from the facts.
- **Follow-ups:** after an answer the model suggests three next questions (`followups()`), shown as "Ask next" chips; library answers and "not found" use fixed suggestions with no model call. `tests/eval_answers.py` turns them off so the evaluation does not pay for them.
- "List my contracts" now shows every contract, not the first 25.

## "Which contract do you mean?"

If a question is about ONE contract ("the bank", "the contract", "what are the payment terms?") but does not say which, any answer is a guess, because each contract answers differently. The router (`scope()`) now also returns `ambiguous`. When it is true and there is more than one contract, Ask searches nothing and answers with a question plus a `clarify` event: the contracts that could fit (or all of them), shown as cards, and a "Search all contracts" button. Picking a card re-asks with `only=[id]` (that contract is searched first, reason "You chose this contract."); the button re-asks with `anywhere=true`. Questions about contracts in general ("across my contracts", "which contracts…") are not flagged. The evaluation scripts pass `clarify=False`, so their numbers are unchanged and still measure retrieval and answers, not this prompt. **Measured** (83 evaluation questions, 28 contracts, the router alone): it flagged 26 (31%). Reading them, about half were fair ("What are the payment terms?" names no contract) but several named their contract by kind or role ("the outsourcing agreement", "the Marketing Affiliate") or asked across contracts ("Which agreement requires…"). Fix: the prompt now says those are not ambiguous, and in code `ambiguous` is forced false whenever the router returned any contract (the named ones are searched first anyway). Re-measured: 19 of 83 (23%), and the ones left are questions that name nothing. Router answers vary between runs, so read it as roughly a fifth to a quarter of this deliberately vague question set, not a fixed rate.

