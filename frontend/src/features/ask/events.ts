// How the Ask page's state follows the answer stream: one turn of the chat, one side of a comparison, and a chat loaded
// from Sessions. Pure functions, so the page only wires them to state.
import type { StoredTurn } from "@/features/sessions/api";
import type { Attempt } from "./AnswerCard";
import type { Cmp, Side } from "./agent/CompareCard";
import type { Stage } from "./Thinking";
import type { AgentStep, AskEvent, AskMode, Brief, Stats } from "./api";

export interface Turn {
  id: number;
  question: string;
  attempts: Attempt[];
  sources: Brief[];
  answer: string;
  facts?: string;
  followups?: string[];
  clarify?: { id: string; filename: string; summary: string }[];
  stage: Stage | null;
  error: string | null;
  saved: string | null;
  stopped?: boolean;
  mode?: AskMode;
  steps?: AgentStep[];
  stats?: Stats;
  fallback?: string;
  budget?: { hit: string } | null;
  cmp?: Cmp;
}

/** Folds one event into one turn of the chat. */
export function turnOf(t: Turn, e: AskEvent): Turn {
  switch (e.event) {
    case "retrieved":
      return {
        ...t,
        stage: "grade",
        attempts: [
          ...t.attempts,
          {
            query: e.query,
            mode: e.mode,
            note: e.note,
            scope: e.scope,
            contracts: e.contracts,
            scope_reason: e.scope_reason,
            hits: e.hits,
            relevant: null,
          },
        ],
      };
    case "graded":
      return {
        ...t,
        attempts: t.attempts.map((a, i) => (i === t.attempts.length - 1 ? { ...a, relevant: e.relevant, reasons: e.reasons } : a)),
      };
    case "rewritten":
      return { ...t, stage: "rewrite" };
    case "step":
      return { ...t, stage: "act", steps: [...(t.steps ?? []), e] };
    case "fallback":
      return { ...t, fallback: e.reason, mode: "workflow" };
    case "budget":
      return { ...t, budget: { hit: e.hit } };
    case "stats":
      return { ...t, stats: e };
    case "clarify":
      return { ...t, clarify: e.options };
    case "context":
      return t;
    case "full":
      return { ...t, stage: null };
    case "followups":
      return { ...t, followups: e.questions };
    case "facts":
      return { ...t, facts: e.text };
    case "sources":
      return { ...t, sources: e.sources };
    case "token":
      return { ...t, stage: "write", answer: t.answer + e.text };
    case "done":
      return { ...t, stage: null, saved: e.session_id };
    case "error":
      return { ...t, stage: null, error: e.detail };
  }
}

/** Folds one event into one side of a comparison (the same events as a normal answer). */
export function sideOf(s: Side, e: AskEvent): Side {
  switch (e.event) {
    case "step":
      return { ...s, stage: "act", steps: [...s.steps, e] };
    case "retrieved":
      return { ...s, stage: "grade" };
    case "sources":
      return { ...s, sources: e.sources };
    case "token":
      return { ...s, stage: "write", answer: s.answer + e.text };
    case "stats":
      return { ...s, stats: e, stage: null }; // a comparison side sends no `done`: its stats are the last thing it sends
    case "fallback":
      return { ...s, fallback: e.reason };
    case "budget":
      return { ...s, budget: { hit: e.hit } };
    case "done":
      return { ...s, stage: null };
    case "error":
      return { ...s, stage: null, error: e.detail };
    default:
      return s;
  }
}

/** A saved chat as turns. Only the last turn keeps its follow-ups and "which contract?" choices: older ones were answered. */
export function storedTurns(stored: StoredTurn[], sessionId: string, nextId: () => number): Turn[] {
  return stored.map((t, i) => {
    const last = i === stored.length - 1;
    return {
      id: nextId(),
      question: t.question,
      attempts: t.attempts,
      sources: t.sources,
      answer: t.answer,
      facts: t.facts,
      mode: t.mode ?? "workflow",
      steps: t.steps,
      stats: t.stats,
      fallback: t.fallback,
      budget: t.budget,
      followups: last ? t.followups : undefined,
      clarify: t.clarify && last ? (t.clarify_options ?? undefined) : undefined,
      stage: null,
      error: null,
      saved: sessionId,
    };
  });
}
