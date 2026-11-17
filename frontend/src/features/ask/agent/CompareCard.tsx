import { Link } from "@/lib/router";
import { AnswerCard } from "../AnswerCard";
import AgentTrace from "./AgentTrace";
import Thinking, { type Stage } from "../Thinking";
import type { AgentStep, AskMode, Brief, Stats } from "../api";
import type { ClauseRef } from "@/features/clause/ClausePanel";
import { stem } from "@/lib/text";

export interface Side { answer: string; sources: Brief[]; steps: AgentStep[]; stats?: Stats; stage: Stage | null; error: string | null; fallback?: string; budget?: { hit: string } | null }
export interface Cmp { workflow: Side; agent: Side; compared?: { same_clauses: number; only_agent: [string, number][]; only_workflow: [string, number][] } }
export const emptySide = (): Side => ({ answer: "", sources: [], steps: [], stage: "search", error: null });

/** "Agent · 4 steps · 5 LLM calls · 3.2 s": what this answer cost, so the two modes can be compared on more than the text. */
export function StatsBadge({ stats, fallback }: { stats?: Stats; fallback?: string }) {
  if (!stats) return null;
  const mode = fallback ? "Workflow (the agent could not run)" : stats.mode === "agent" ? "Agent" : "Workflow";
  return (
    <p className="text-xs text-muted" title={fallback}>
      <span className="font-semibold text-fg-soft">{mode}</span>
      {stats.mode === "agent" && !fallback && stats.steps ? ` · ${stats.steps} step${stats.steps === 1 ? "" : "s"}` : ""}
      {` · ${stats.llm_calls} LLM call${stats.llm_calls === 1 ? "" : "s"} · ${stats.tokens.toLocaleString()} tokens · ${(stats.ms / 1000).toFixed(1)} s`}
      {stats.model && stats.mode === "agent" && !fallback ? ` · ${stats.model}` : ""}
    </p>
  );
}

const label = (h: Brief | undefined, key: [string, number]) => h ? `${h.clause_identifier} ${h.title} (${stem(h.filename).slice(0, 30)})` : `clause ${key[1]}`;

/** One question, answered twice: the fixed workflow on the left, the agent on the right, with which clauses each one cited. */
export default function CompareCard({ cmp, onPick }: { cmp: Cmp; onPick: (side: AskMode, c: ClauseRef, index: number) => void }) {
  const c = cmp.compared;
  const find = (side: Side, k: [string, number]) => side.sources.find((s) => s.document_id === k[0] && s.position === k[1]);
  return (
    <div className="space-y-3">
      {c && (
        <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg-soft">
          {c.only_agent.length === 0 && c.only_workflow.length === 0
            ? <>Both cited the same {c.same_clauses} clause{c.same_clauses === 1 ? "" : "s"}.</>
            : <>
                {c.same_clauses > 0 && <>Both cited {c.same_clauses} clause{c.same_clauses === 1 ? "" : "s"}. </>}
                {c.only_agent.length > 0 && <><b>Only the agent</b> cited {c.only_agent.map((k) => label(find(cmp.agent, k), k)).join("; ")}. </>}
                {c.only_workflow.length > 0 && <><b>Only the workflow</b> cited {c.only_workflow.map((k) => label(find(cmp.workflow, k), k)).join("; ")}.</>}
              </>}
          {" "}<Link to="/evaluation#criteria" className="underline underline-offset-2 hover:text-fg">How are these scored?</Link>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {(["workflow", "agent"] as const).map((m) => {
          const side = cmp[m];
          return (
            <section key={m} aria-label={m === "agent" ? "Agent answer" : "Workflow answer"} className="min-w-0 space-y-3">
              <h3 className="font-display text-lg font-semibold">{m === "agent" ? "Agent" : "Workflow"}</h3>
              <StatsBadge stats={side.stats} fallback={side.fallback} />
              {side.stage && !side.answer && <Thinking stage={side.stage} />}
              {side.error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{side.error}</p>}
              {(side.answer || (!side.stage && side.sources.length > 0)) && (
                <AnswerCard answer={side.answer} sources={side.sources} streaming={side.stage === "write"} selected={null} onPick={(c, i) => onPick(m, c, i)} />
              )}
              {m === "agent" && side.steps.length > 0 && <AgentTrace steps={side.steps} budget={side.budget} live={!!side.stage} onPick={(c) => { const i = side.sources.findIndex((s) => s.document_id === c.document_id && s.position === c.position); i >= 0 && onPick("agent", c, i); }} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
