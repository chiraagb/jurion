# 16. Phase 4: the interface (plan vs. what was built)

The goal: a screen where legal staff can ask questions and *see* how the answer was found. The original plan was one split screen (chat on the left, a React Flow graph of the clauses used on the right). What was built is a small app with one page per job.

## The pages

| Page | What it does |
|---|---|
| **Ask** (`/ask`) | The chat. The answer streams in with `[1]` citations; a citation opens the clause beside the answer on its PDF page with the clause shaded. "How I got this answer" lists every clause considered, with why it was kept or dropped. A ring by the send button shows how much of the session's context is used. |
| **Search** | The same hybrid search as Ask, without the AI answer, for finding a clause by meaning or by words, with a 2D/3D map of the clause embeddings. |
| **My contracts** | Saved contracts, with embedding and graph status, the PDF with highlighted clauses, and each contract's graph panel. |
| **Graph** | A three-pane explorer (companies, contracts, clauses) drawn with React Flow, with impact analysis and similar clauses. React Flow is loaded only when this page opens. |
| **Parser Lab** | Drop one PDF to inspect how it is parsed, step by step, or several to parse and save them all. |
| **Evaluation** | The measured results (see [18](18-evaluation.md)). |
| **Problems & fixes** | The real problems found while building, with examples and numbers. |
| **Parser report** | The parser's results on public contracts ([09](09-parser-test-results.md)). |
| **Sessions** | Chats live in the sidebar under Ask (rename, delete, new). The `/sessions` page is the same list for small screens. |

The sidebar collapses to icons (with tooltips) and the layout works down to phone width. Light and dark themes share one set of colour tokens.

## What changed from the plan

- **One graph on its own page, not beside the chat.** In Ask, the graph is used behind the scenes (narrowing and widening) and shown as text ("Narrowed by the graph", "pulled in by 9.1"); the picture lives on the Graph and contract pages, where there is room for it.
- **Upload progress** is shown in the Parser Lab as the real steps (read, local parse, AI if needed), with timings, not a staged progress bar: parsing and saving each finish within one request.
- **No separate `Dashboard`, `ChatInterface`, `IngestionTracker` components**: each page owns its feature folder under `frontend/src/features/`.

## Built with

React, Vite and Tailwind v4 with a parchment theme; pdf.js for the highlighted PDF; React Flow for the graph. No component library, no global state library: the URL (`/ask?s=<session>`) is the state that matters.
