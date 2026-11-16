/** Every number on the Workflow vs Agent scoreboard, in plain words. One place, so the guide, the scoreboard and the tooltips never disagree.
 *  `key` is the field in tests/eval_answers.py's summary; `decidedBy` says who or what makes the call. Keep in step with that file. */
export interface AnswerRow {
  id: number; question: string; kind: string; answer: string; sources: number; refused: boolean;
  context_has_gold?: boolean; cited_gold?: boolean; found_all?: boolean; faithfulness?: number | null; unsupported?: string[];
  llm_calls?: number; tokens?: number; latency_ms?: number; steps?: number; fallback?: boolean; budget?: boolean; invalid_citations?: number;
}

export type Format = "pct" | "num" | "ms";
export interface Criterion {
  key: string;
  name: string;
  means: string; // one plain sentence
  decidedBy: string; // who or what decides pass or fail
  better: "higher" | "lower";
  format: Format;
  pass?: (r: AnswerRow) => boolean; // a row that shows a pass, for the guide's real example
  fail?: (r: AnswerRow) => boolean;
}

export const CRITERIA: Criterion[] = [
  { key: "answered", name: "Answered", means: "It gave an answer instead of saying it could not find one.", decidedBy: "A text pattern on how the answer starts (“I couldn't find…”, “The clauses do not…”).",
    better: "higher", format: "pct", pass: (r) => !r.refused && r.kind !== "none", fail: (r) => r.refused && r.kind !== "none" },
  { key: "right_clause_cited", name: "Cited the right clause", means: "A clause it cited is from the right contract and contains the known answer text.", decidedBy: "A match against the answer text we wrote down for each question (the “gold” phrase). No AI judge involved.",
    better: "higher", format: "pct", pass: (r) => r.cited_gold === true, fail: (r) => r.cited_gold === false && !r.refused },
  { key: "answered_wrong_clause", name: "Confidently wrong", means: "It answered and cited clauses, but not the right one. The failure that misleads you.", decidedBy: "Answered, and did not cite the right clause (same match as above).",
    better: "lower", format: "pct", pass: (r) => r.cited_gold === true, fail: (r) => !r.refused && r.cited_gold === false },
  { key: "faithfulness", name: "Faithful", means: "Every claim in the answer is backed by the clauses it was given.", decidedBy: "A larger AI model lists each claim and marks it supported or not. It is a different, bigger model than the one that wrote the answer.",
    better: "higher", format: "pct", pass: (r) => r.faithfulness === 1, fail: (r) => r.faithfulness != null && r.faithfulness < 1 },
  { key: "found_all", name: "Found every piece", means: "For questions that need clauses from two places (an amendment, or two contracts), it cited a clause for each piece.", decidedBy: "One gold phrase per piece; all must appear in clauses the answer cites.",
    better: "higher", format: "pct", pass: (r) => r.found_all === true, fail: (r) => r.found_all === false },
  { key: "llm_calls_median", name: "Model calls", means: "How many times a language model was called to produce one answer (embeddings not counted). Typical question.", decidedBy: "A counter on every model call.",
    better: "lower", format: "num" },
  { key: "tokens_median", name: "Tokens", means: "How much text the models read and wrote for one answer. This drives cost.", decidedBy: "The token counts the providers report.",
    better: "lower", format: "num" },
  { key: "latency_p90_ms", name: "Slow answers (p90)", means: "How long you wait for the slowest 1 in 10 answers.", decidedBy: "A wall-clock timer around the whole answer.",
    better: "lower", format: "ms" },
];

export const NONE_CRITERION = { key: "correctly_refused", name: "Refuses when it should", means: "For questions the contracts cannot answer, it says so instead of making something up.", decidedBy: "The same text pattern as “Answered”, on questions with no answer.", better: "higher" as const, format: "pct" as const };

export const fmt = (v: number | null | undefined, f: Format) => (v == null ? "n/a" : f === "pct" ? `${Math.round(v * 100)}%` : f === "ms" ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? v.toLocaleString() : String(Math.round(v * 10) / 10));
