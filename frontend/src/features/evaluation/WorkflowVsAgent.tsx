import { Fragment, useMemo, useState } from "react";
import { Check, Minus, X } from "lucide-react";
import CriteriaGuide from "./CriteriaGuide";
import { CRITERIA, NONE_CRITERION, fmt, type AnswerRow, type Criterion } from "./criteria";

type Summary = Record<string, Record<string, number | null>>;
interface Run { summary: Summary; rows: AnswerRow[]; runs?: Summary[]; ran_at: string; answer_model: string; judge_model: string }
type Data = Record<string, unknown>;

const SETS = [
  { id: "original", label: "Original questions", note: "one clause answers each", workflow: "answers", agent: /^answers_agent(__.*)?$/ },
  { id: "agentic", label: "Multi-step questions", note: "amendments, two contracts, a named company first", workflow: "answers_agentic_workflow", agent: /^answers_agentic_agent(__.*)?$/ },
] as const;
const GROUP_LABEL: Record<string, string> = { all: "All", direct: "Same words", paraphrase: "Other words", broad: "Whole section", graph: "Names a party", multi: "Needs two clauses", multihop: "Amendment / follow-up", party_then_clause: "Company first", compare: "Compare contracts" };

/** The value of one criterion for one system, with the lowest and highest across repeated runs (when the run was repeated). */
const read = (r: Run, group: string, key: string) => {
  const v = r.summary[group]?.[key] ?? null;
  const all = (r.runs ?? []).map((s) => s[group]?.[key]).filter((x): x is number => typeof x === "number");
  return { v, lo: all.length > 1 ? Math.min(...all) : null, hi: all.length > 1 ? Math.max(...all) : null, n: r.summary[group]?.n ?? 0, runs: all.length };
};

type Verdict = "agent" | "workflow" | "tie" | "unknown";
function verdict(c: Criterion, a: ReturnType<typeof read>, w: ReturnType<typeof read>): Verdict {
  if (a.v == null || w.v == null) return "unknown";
  const spread = Math.max((a.hi ?? a.v) - (a.lo ?? a.v), (w.hi ?? w.v) - (w.lo ?? w.v));
  const floor = c.format === "pct" ? 0.05 : Math.max(a.v, w.v) * 0.1; // the docs record 0 to 5% run-to-run noise: smaller gaps are not a result
  const diff = a.v - w.v;
  if (Math.abs(diff) <= Math.max(spread, floor)) return "tie";
  return (diff > 0) === (c.better === "higher") ? "agent" : "workflow";
}
const WORDS: Record<Verdict, string> = { agent: "Agent better", workflow: "Workflow better", tie: "No clear difference", unknown: "n/a" };

function Bar({ label, value, max, f, lo, hi, tone }: { label: string; value: number | null; max: number; f: Criterion["format"]; lo: number | null; hi: number | null; tone: "w" | "a" }) {
  const pct = value == null || !max ? 0 : Math.max(2, (value / max) * 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <div className="h-3 min-w-0 flex-1 rounded-full bg-raised" aria-hidden>
        <div style={{ width: `${pct}%` }} className={`h-full rounded-full ${tone === "a" ? "bg-accent" : "bg-fg-soft/50"}`} />
      </div>
      <span className="w-28 shrink-0 text-right font-mono text-xs">{fmt(value, f)}{lo != null && hi != null && lo !== hi ? <span className="text-muted"> ({fmt(lo, f)}–{fmt(hi, f)})</span> : null}</span>
    </div>
  );
}

const rightOf = (r?: AnswerRow) => (!r ? null : r.kind === "none" ? r.refused : (r.found_all ?? r.cited_gold ?? false));

/** The workflow and the agent on the same questions: criteria first, then the scoreboard, then every question where they differ. */
export default function WorkflowVsAgent({ data }: { data: Data }) {
  const [setId, setSetId] = useState<(typeof SETS)[number]["id"]>("original");
  const set = SETS.find((s) => s.id === setId)!;
  const workflow = data[set.workflow] as Run | undefined;
  const agentKeys = Object.keys(data).filter((k) => set.agent.test(k));
  const [pick, setPick] = useState<string>("");
  const agent = (data[agentKeys.includes(pick) ? pick : agentKeys[0]] as Run | undefined);
  const [group, setGroup] = useState("all");
  const [differ, setDiffer] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  const groups = useMemo(() => Object.keys(workflow?.summary ?? {}).filter((g) => g !== "none"), [workflow]);
  const rows = useMemo(() => {
    const w = new Map((workflow?.rows ?? []).map((r) => [r.id, r]));
    const a = new Map((agent?.rows ?? []).map((r) => [r.id, r]));
    return [...new Set([...w.keys(), ...a.keys()])].sort((x, y) => x - y).map((id) => ({ id, w: w.get(id), a: a.get(id) }));
  }, [workflow, agent]);

  const tabs = (
    <div role="group" aria-label="Question set" className="flex flex-wrap gap-2">
      {SETS.map((s) => (
        <button key={s.id} onClick={() => { setSetId(s.id); setGroup("all"); setOpen(null); }} aria-pressed={setId === s.id}
          className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${setId === s.id ? "border-accent bg-accent/10 font-semibold text-accent-fg" : "border-line text-muted hover:text-fg"}`}>
          {s.label} <span className="text-xs text-subtle">· {s.note}</span>
        </button>
      ))}
    </div>
  );

  if (!workflow || !agent) {
    return (
      <section aria-labelledby="wva-title" className="space-y-4">
        <h2 id="wva-title" className="font-display text-2xl font-semibold">Workflow vs Agent</h2>
        {tabs}
        <p className="rounded-md border border-dashed border-line-strong p-8 text-center text-muted">
          No {workflow ? "agent" : "workflow"} run for these questions yet. Run <code className="font-mono">uv run python -W ignore -m tests.eval_answers {workflow ? "--mode agent" : ""}{set.id === "agentic" ? " --set agentic" : ""} --runs 3</code> in <code className="font-mono">backend</code>.
        </p>
      </section>
    );
  }

  const list = [...CRITERIA, ...(group === "all" ? [] : [])].filter((c) => read(workflow, group, c.key).v != null || read(agent, group, c.key).v != null);
  const results = list.map((c) => { const w = read(workflow, group, c.key), a = read(agent, group, c.key); return { c, w, a, v: verdict(c, a, w) }; });
  const better = results.filter((r) => r.v === "agent").map((r) => r.c.name.toLowerCase());
  const worse = results.filter((r) => r.v === "workflow").map((r) => r.c.name.toLowerCase());
  const none = { w: workflow.summary.none?.[NONE_CRITERION.key] ?? null, a: agent.summary.none?.[NONE_CRITERION.key] ?? null, n: workflow.summary.none?.n ?? 0 };
  const shown = rows.filter((r) => (group === "all" || (r.w ?? r.a)?.kind === group) && (!differ || rightOf(r.w) !== rightOf(r.a)));
  const runs = agent.runs?.length ?? 1;

  return (
    <section aria-labelledby="wva-title" className="space-y-8">
      <div>
        <p className="caption mb-3">Fixed pipeline or model-driven agent?</p>
        <h2 id="wva-title" className="font-display text-3xl font-semibold tracking-tight">Workflow vs Agent</h2>
        <p className="mt-3 max-w-3xl text-fg-soft">
          The <b>workflow</b> always runs the same steps: search, check, answer. The <b>agent</b> decides for itself what to search, read and follow, then answers. Same contracts, same questions, same scoring.
          {runs > 1 ? ` Each score is the latest of ${runs} runs, with the lowest–highest range in brackets, because models do not repeat themselves exactly.` : " This was one run: models vary between runs, so treat small gaps as noise."}
        </p>
      </div>

      <CriteriaGuide rows={[...(workflow.rows ?? [])]} />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {tabs}
          {agentKeys.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-fg-soft">
              <span className="text-muted">Agent model</span>
              <select value={agentKeys.includes(pick) ? pick : agentKeys[0]} onChange={(e) => setPick(e.target.value)} className="h-9 cursor-pointer rounded-md border border-line-strong bg-surface px-2 text-fg focus-visible:outline-2 focus-visible:outline-accent">
                {agentKeys.map((k) => <option key={k} value={k}>{(data[k] as Run).answer_model}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="text-xs text-muted">Workflow: {workflow.answer_model} · Agent: {agent.answer_model} · judge: {agent.judge_model} · run {new Date(agent.ran_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>

        <div role="group" aria-label="Question type" className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button key={g} onClick={() => { setGroup(g); setOpen(null); }} aria-pressed={group === g}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${group === g ? "border-accent bg-accent/10 font-semibold text-accent-fg" : "border-line text-muted hover:text-fg"}`}>
              {GROUP_LABEL[g] ?? g} <span className="font-mono text-xs text-subtle">({workflow.summary[g]?.n})</span>
            </button>
          ))}
        </div>

        <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-fg-soft">
          {better.length === 0 && worse.length === 0 ? "No clear winner here: the differences are within run-to-run noise." : <>
            {better.length > 0 && <>The agent is clearly better on <b>{better.join(", ")}</b>. </>}
            {worse.length > 0 && <>The workflow is clearly better on <b>{worse.join(", ")}</b>.</>}
          </>}
        </p>

        <ul className="space-y-3">
          {results.map(({ c, w, a, v }) => {
            const max = c.format === "pct" ? 1 : Math.max(w.hi ?? w.v ?? 0, a.hi ?? a.v ?? 0, 1e-9);
            return (
              <li key={c.key} className="rounded-2xl border border-line bg-surface p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{c.name} <span className="text-xs font-normal text-muted">· {c.better === "higher" ? "higher" : "lower"} is better · n={w.n}</span></h3>
                  <span className="text-xs font-semibold text-fg-soft">{WORDS[v]}</span>
                </div>
                <div className="space-y-1.5">
                  <Bar label="Workflow" value={w.v} max={max} f={c.format} lo={w.lo} hi={w.hi} tone="w" />
                  <Bar label="Agent" value={a.v} max={max} f={c.format} lo={a.lo} hi={a.hi} tone="a" />
                </div>
              </li>
            );
          })}
          {group === "all" && none.n > 0 && (
            <li className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-2 font-semibold">{NONE_CRITERION.name} <span className="text-xs font-normal text-muted">· higher is better · n={none.n}</span></h3>
              <div className="space-y-1.5">
                <Bar label="Workflow" value={none.w} max={1} f="pct" lo={null} hi={null} tone="w" />
                <Bar label="Agent" value={none.a} max={1} f="pct" lo={null} hi={null} tone="a" />
              </div>
            </li>
          )}
        </ul>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-xl font-semibold">Question by question</h3>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-soft">
            <input type="checkbox" checked={differ} onChange={(e) => setDiffer(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /> Only where they differ
          </label>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-raised text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2 font-semibold">Question</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Workflow</th><th className="px-3 py-2 font-semibold">Agent</th></tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">{differ ? "They got every question here the same." : "No questions."}</td></tr>}
              {shown.map(({ id, w, a }) => (
                <Fragment key={id}>
                  <tr className="border-t border-line align-top hover:bg-raised/50">
                    <td className="px-4 py-2"><button onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} className="cursor-pointer text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent">{(w ?? a)?.question}</button></td>
                    <td className="px-3 py-2 text-muted">{GROUP_LABEL[(w ?? a)?.kind ?? ""] ?? (w ?? a)?.kind}</td>
                    <Cell r={w} /><Cell r={a} />
                  </tr>
                  {open === id && (
                    <tr className="border-t border-line bg-surface">
                      <td colSpan={4} className="grid gap-4 px-4 py-4 md:grid-cols-2">
                        {([["Workflow", w], ["Agent", a]] as const).map(([name, r]) => (
                          <div key={name} className="min-w-0">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{name}{r?.llm_calls != null ? ` · ${r.llm_calls} model calls` : ""}{name === "Agent" && r?.steps ? ` · ${r.steps} steps` : ""}{r?.latency_ms != null ? ` · ${(r.latency_ms / 1000).toFixed(1)} s` : ""}{r?.fallback ? " · agent failed, workflow answered" : ""}{r?.budget ? " · stopped at its limit" : ""}</p>
                            <p className="whitespace-pre-wrap text-fg-soft [overflow-wrap:anywhere]">{r?.answer || "(no answer)"}</p>
                            {r?.unsupported && r.unsupported.length > 0 && <p className="mt-1 text-xs text-danger">Not backed by the clauses: {r.unsupported[0]}</p>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">✓ = got the question right (cited the right clause, or every required clause; for unanswerable questions, refused). ✗ = did not.</p>
      </div>
    </section>
  );
}

function Cell({ r }: { r?: AnswerRow }) {
  const ok = rightOf(r);
  return (
    <td className="px-3 py-2">
      {ok == null ? <span className="inline-flex items-center gap-1 text-muted"><Minus className="h-3.5 w-3.5" aria-hidden /> not run</span>
        : ok ? <span className="inline-flex items-center gap-1 text-accent-fg"><Check className="h-3.5 w-3.5" aria-hidden /> right</span>
        : <span className="inline-flex items-center gap-1 text-danger"><X className="h-3.5 w-3.5" aria-hidden /> wrong</span>}
    </td>
  );
}
