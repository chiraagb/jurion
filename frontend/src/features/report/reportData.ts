/** Content of the Parser report tab. Mirrors docs/14-parser-test-results.md (3 Nov 2026); update both together. */

export const tiles = [
  { label: "Contracts surveyed", value: "510", note: "public CUAD set, local parser only" },
  { label: "Need the AI fallback", value: "16%", note: "down from 19% after the number fix" },
  { label: "Boundary accuracy", value: "Not measured", note: "draft labels wait for review", warn: true },
];

export const worked = [
  "Tables are kept as real tables (156 table rows in the clinical trial agreement).",
  "Attachments, signature blocks and cross-reference lines no longer swallow or split clauses.",
  "The AI heading step works live: 72 clauses in 7.5s on the 32-page clinical trial agreement (local: 71).",
  "A stuck PDF is killed after 45s and the next upload still works; page cap and rate limits are tested.",
  "Fixing stray clause numbers moved 16 contracts up in score and none down.",
  "The corpus of four real contracts guards every earlier fix against coming back.",
];

export const findings = [
  "A year or zip code at the start of a line (2000., 22314.) was read as a clause number and wrecked the score. Fixed.",
  "The first version of that fix crashed on 17 contracts (an empty set of numbers). The re-run caught it; fixed and tested.",
  "Some PDFs put clause numbers in a separate column. The local parser then picks 1., 2., 3. as clauses and loses the headings; the AI finds the real ones.",
  "47% of the 510 contracts reuse a clause number. Some are real (numbering restarts in an exhibit), some are probably false headings.",
  "The confidence score is the parser grading itself. It once gave 100% to a result with 4 clauses, so an “evenly split” check was added.",
  "gemini-3.8-flash often returns 503 (busy) and gemini-2.5-flash is retired; the default is now gemini-3.5-flash-lite.",
];

export const gaps = [
  "No measured boundary accuracy yet: the draft labels (1,768 disputed lines across 30 contracts) have not been reviewed.",
  "No OCR. All 510 test PDFs had a text layer, so scans are untested (they go whole to the AI).",
  "Borderless tables and two-column layouts are untested.",
  "37 contracts gave fewer than 3 clauses and 39 fewer than 10; not yet looked at one by one.",
  "Slow on long contracts with tables: median 1.7s, slowest 10 to 50s with four parses at once.",
  "Contract text goes to Google or OpenAI when the AI is used; the policy for real client contracts is undecided.",
];

export const next = [
  "Review the 24 smaller label files (646 decisions), then run the accuracy script for precision and recall.",
  "Look at the contracts with too few clauses, and at the duplicate-number cases, to find the next real failure type.",
  "Add OCR for scanned PDFs, and test borderless and two-column layouts.",
  "Speed up table detection on long documents; move parsing to a background job.",
  "Re-parse on the server when saving instead of trusting the browser's clauses; add CI and migrations.",
  "Then the search side: embeddings in pgvector, the Neo4j graph, answers with clause citations.",
];

export const checks = [
  ["uv run python -m tests.integration.test_parse", "Parser rules on synthetic PDFs, the AI fallback with a stubbed model (used, skipped, failed, forced, no key), sign-in required"],
  ["uv run python -m tests.integration.test_corpus", "Four real contracts: clause count, required clause IDs, table rows, score, even split"],
  ["uv run python -m tests.integration.test_documents", "Save, list, open, delete against real Postgres; stored text and line ranges; other users get 404"],
  ["uv run python -m tests.integration.test_limits", "Page cap, a stuck worker killed and replaced, rate limit"],
  ["uv run python -m tests.eval", "Boundary precision and recall against reviewed labels (needs the labels reviewed first)"],
];

export const corpus = {
  head: ["Contract", "Pages", "Clauses", "Table rows", "Score"],
  rows: [
    ["Clinical trial agreement", "32", "71", "156", "0.96"],
    ["NDA template", "7", "48", "0", "1.0"],
    ["Widget contract", "12", "122", "1", "0.9"],
    ["Signed CNDA", "5", "16", "0", "1.0"],
  ],
  note: "These were used to fix the parser, so passing them proves nothing new. They only guard against breaking old fixes.",
};

export const survey = {
  head: ["510 CUAD contracts (local parser)", "First run", "After the fix"],
  rows: [
    ["Found clauses", "474", "472"],
    ["Fewer than 3 clauses", "35", "37"],
    ["Timed out (90s)", "1", "1"],
    ["Median confidence", "0.98", "0.98"],
    ["Score 0.95 or more", "304", "320"],
    ["Score below 0.6", "63", "43"],
    ["Numbering score below 0.9", "34", "15"],
    ["Would call the AI fallback", "99 (19%)", "81 (16%)"],
    ["Weakest 5% of contracts (score)", "0.21", "0.45"],
  ],
  note: "This is the parser grading itself, not accuracy against correct answers.",
};

export const aiRuns = [
  "Clinical trial agreement (32 pages): 72 clauses in 7.5s with gemini-3.5-flash-lite; all 156 table rows kept.",
  "Vgrab contract (8 pages, numbered-column layout): Parse with Gemini returned 22 clauses in 7.2s with real headings like RECITALS and SCOPE OF WORK.",
];

export const labels = [
  ["Contracts picked", "30 (clean, many duplicates, too few clauses, long, weak numbering)"],
  ["Starts both drafters agree on", "1,211 (accepted)"],
  ["Disputed starts", "1,768 (1,511 local only, 257 AI only)"],
  ["AI fallback would trigger", "15 of 30 (a deliberately hard set)"],
  ["Suggested review", "24 files with 70 or fewer disputes: 646 decisions"],
];
