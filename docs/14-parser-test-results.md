# Parser test results

What was tested on the contract parser, the numbers, and what is still unknown. Dates are from the build session (3 Nov 2026).

The same content is in the app: open the **Parser report** tab. It is static text in `frontend/src/features/report/reportData.ts`, so when numbers here change, update that file too.

## The checks you can run

All from `backend/`:

| Command | What it checks |
|---|---|
| `uv run python -m tests.integration.test_parse` | Parser rules on synthetic PDFs, the AI fallback with a stubbed model (used, skipped, failed, forced, no key), sign-in required on `/parse` |
| `uv run python -m tests.integration.test_corpus` | Four real contracts: minimum clauses, required clause IDs, table rows, score, even split |
| `uv run python -m tests.integration.test_documents` | Saving, listing, opening, deleting contracts against real Postgres; stored text and line ranges; other users get 404 |
| `uv run python -m tests.integration.test_limits` | Page cap, a stuck worker being killed and replaced, rate limit |
| `uv run python -m tests.eval` | Clause-boundary precision and recall against reviewed labels (see "Labels" below) |

## Four real contracts (regression set)

| Contract | Pages | Clauses | Table rows | Score |
|---|---|---|---|---|
| Clinical trial agreement | 32 | 71 | 156 | 0.96 |
| NDA template | 7 | 48 | 0 | 1.0 |
| Widget contract | 12 | 122 | 1 | 0.9 |
| Signed CNDA | 5 | 16 | 0 | 1.0 |

These were used to fix the parser, so passing them proves nothing new. They only guard against breaking old fixes.

## 510 CUAD contracts (a larger, unseen set)

The public CUAD set (510 real contract PDFs from SEC filings). The local parser only, no AI. This is the parser grading itself, not accuracy.

| | First run | After fixing stray numbers |
|---|---|---|
| Found clauses | 474 | 472 |
| Fewer than 3 clauses | 35 | 37 |
| Timed out (90s) | 1 | 1 |
| Median confidence | 0.98 | 0.98 |
| Score 0.95 or more | 304 | 320 |
| Score below 0.6 | 63 | 43 |
| Numbering score below 0.9 | 34 | 15 |
| Would call the AI fallback | 99 (19%) | 81 (16%) |
| Weakest 5% of contracts (score) | 0.21 | 0.45 |

Speed (4 parses at once): median 1.7s, slowest 10 to 50s. Slow ones are long documents with many tables.

**What the first run found, and what was fixed:**
- A year or zip code at the start of a line (`2000.`, `22314.`) was read as a clause number and wrecked the numbering score. Clause numbers are now limited to 3 digits, and the score ignores far-out outliers. This moved 16 contracts up and none down.
- The first version of that fix crashed on 17 contracts (an empty set of numbers). It was caught by the re-run, fixed, and a test added.

**Still open from the survey:**
- 47% of contracts have a clause number used twice. Some are real (numbering restarts in an exhibit); others are probably false headings. Only labels can tell which.
- 39 contracts got fewer than 10 clauses, and 37 got fewer than 3.
- No file was a scan (all had a text layer), so OCR is untested.

## Number columns and underlined tables (two fixes from screenshots)

- **Numbers stored apart from titles.** In the Cybergy affiliate agreement the number column is separate text, so the parser paired `1.` with the wrong titles (`2.1 Effective Date and Term` instead of `1.`). Each bare marker is now moved next to the text on its baseline: score 0.26 to 0.94. Over all 510 contracts: 6 scores up, 0 down, 0 crashes; AI fallback rate 16% to 15%.
- **Table with only underlines.** In the Agape supply agreement the detector found the table but put everything in one column (`150gm packaged 15,000` glued together). Columns are now rebuilt from word positions when a detected grid has fewer than two filled columns; the result is `| 150gm packaged | 15,000 |` with the product name row above it. A "table" that cannot be rebuilt is no longer a table: its lines stay plain text.
- **Checked on the 30 selected contracts** (not the full 510): 25 identical to before, 0 worse, 1 better (a contract that had no clauses now parses). 57 tables seen: 56 read normally, 1 dropped as not-a-table, 0 needed the word-position rebuild (that case is not among the 30; it is covered by the synthetic test and the Agape contract).

## AI fallback, tried for real

- The AI heading step ran on the clinical trial agreement with `gemini-3.5-flash-lite`: 72 clauses in 7.5s (local: 71), same score, all 156 table rows kept.
- `/parse?force_llm=true` ran end to end on a contract the local parser handled badly (Vgrab, 8 pages): 22 clauses in 7.2s.
- `gemini-3.8-flash` often returned "503 high demand"; `gemini-2.5-flash` and `gemini-2.5-flash-lite` are retired (404). The default is now `gemini-3.5-flash-lite`.

## The "Parse with Gemini" button and the comparison

In the Parser Lab, the results page has **Parse with Gemini** (or OpenAI, whichever is chosen in Settings). It re-runs the same file with the AI picking the headings, even if the local score looked fine, and uses the AI's result. It needs an API key in Settings (or on the server).

Both results are kept. Once the AI result exists, a **Compare parsers** panel appears above the results with a switch between *Local parser* and *Gemini* (switching does not re-parse), a side-by-side table (clauses, confidence, table rows kept, warnings, time) and the clause numbers found by only one of them. The button then reads **Re-run with Gemini**. If the AI is busy or fails, you get a message and keep the local result. When a low-confidence parse is upgraded to the AI automatically, the local result is still sent along (`local_result`), so the comparison works then too.

## Labels (boundary accuracy)

30 contracts were picked (clean, many duplicate numbers, too few clauses, long, weak numbering). The local parser and the AI each marked clause starts:

- 1,211 starts were marked by both (accepted).
- 1,768 were marked by only one: 1,511 by the local parser only, 257 by the AI only. These need a person to decide.
- The AI fallback would trigger on 15 of the 30 (this set was chosen to be hard).

Drafts are in `backend/tests/corpus_big/labels/`. Precision and recall are not available until someone reviews them. Suggested scope: the 24 files with 70 or fewer disputed lines (646 decisions), skipping 4 very long contracts.

What the disagreements showed: some PDFs put clause numbers in a separate column, so the local parser picks `1.`, `2.`, `3.` as clause starts and loses the headings. The AI finds the real headings in those.

## Known gaps

- No measured boundary accuracy yet (labels not reviewed).
- No OCR for scans; scanned PDFs go whole to the AI.
- Tables on pages with no ruled lines at all are still read as plain text, and two-column layouts are untested.
- The two page-footer lines inside the underlined table from the Agape contract still end up as junk rows at the end of that table.
- The AI step has been run live on only a few contracts.
- Reading long contracts with tables is slow (up to about 50s under load).
