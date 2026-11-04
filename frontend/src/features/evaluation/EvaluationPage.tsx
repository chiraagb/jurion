import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Mode = "vector" | "keyword" | "hybrid" | "context";
type Kind = "direct" | "paraphrase" | "broad" | "none";
interface Score { "hit@1": number; "hit@3": number; "hit@5": number; "hit@10": number; mrr: number; n: number }
type Summary = Record<"all" | "direct" | "paraphrase" | "broad", Partial<Record<Mode, Score>>>;
interface Row { id: number; question: string; kind: Kind; ranks: Partial<Record<Mode, number | null>>; top?: string[] }
interface Run { summary: Summary; rows: Row[]; ran_at?: string }
interface AnswerRow {
  id: number; question: string; kind: Kind; answer: string; sources: number; refused: boolean;
  context_has_gold?: boolean; cited_gold?: boolean; faithfulness?: number | null; unsupported?: string[]; answers_question?: boolean;
}
interface AnswerStats { n: number; answered: number | null; right_clause_in_context: number | null; right_clause_cited: number | null; faithfulness: number | null; addresses_question: number | null }
interface Answers { summary: Record<"all" | "direct" | "paraphrase" | "broad", AnswerStats> & { none: { n: number; correctly_refused: number | null } }; rows: AnswerRow[]; answer_model: string; judge_model: string; ran_at: string }
interface Data { available?: false; ran_at: string; embedding_model: string; questions: number; baseline?: Run; retrieval: Run; answers?: Answers }

const MODES: { id: Mode; label: string; note: string }[] = [
  { id: "vector", label: "Vector only", note: "meaning match" },
  { id: "keyword", label: "Keyword only", note: "Postgres full-text" },
  { id: "hybrid", label: "Hybrid", note: "vector + keyword" },
  { id: "context", label: "Hybrid + context", note: "what Ask uses" },
];
const GROUPS = [["all", "All"], ["direct", "Same words"], ["paraphrase", "Other words"], ["broad", "Whole section"]] as const;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function EvaluationPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>("all");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api.get<Data>("/evaluation").then((r) => setData(r.data)).catch((e) => setError(e.response?.data?.detail ?? e.message));
  }, []);

  if (error) return <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-muted" aria-busy>Loading…</p>;
  if (data.available === false)
    return <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">No evaluation yet. Run <code className="font-mono">uv run python -W ignore -m tests.eval_qa</code> in <code className="font-mono">backend</code>.</p>;

  const now = data.retrieval.summary, before = data.baseline?.summary;
  const metrics = [["hit@1", "Right clause is #1"], ["hit@3", "…in the top 3"], ["hit@5", "…in the top 5"], ["mrr", "Mean reciprocal rank"]] as const;
  const answerable = data.retrieval.rows.filter((r) => r.kind !== "none").length;
  const broad = (s?: Summary, m: Mode = "hybrid") => s?.broad[m];

  return (
    <section aria-labelledby="eval-title" className="space-y-8">
      <div>
        <p className="caption mb-3">Does the right clause come back?</p>
        <h1 id="eval-title" className="font-display text-4xl font-semibold tracking-tight">Evaluation</h1>
        <p className="mt-3 max-w-3xl text-fg-soft">
          {answerable} questions with a known answer clause (and {data.questions - answerable} with none), asked against the contracts saved in this app, using <code className="font-mono text-sm">{data.embedding_model}</code>.
          A question counts as answered when a clause of the right contract containing the answer text appears among the results.
          Run on {new Date(data.ran_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
        </p>
      </div>

      {before && broad(before) && broad(now, "context") && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-5">
          <p className="font-semibold">Fix: a heading with no text now brings its section with it</p>
          <p className="mt-1 text-fg-soft">
            Questions about a whole section (“What are the terms and conditions?”) used to retrieve a heading that held no text. For those, the right text is in the top 3 results{" "}
            <b>{pct(broad(before)!["hit@3"])} → {pct(broad(now, "context")!["hit@3"])}</b> of the time, and #1 <b>{pct(broad(before)!["hit@1"])} → {pct(broad(now, "context")!["hit@1"])}</b> (4 questions).
            Over all questions, the right clause is in the top 5 <b>{pct(before.all.hybrid!["hit@5"])} → {pct(now.all.context!["hit@5"])}</b>.
          </p>
        </div>
      )}

      <div>
        <div role="group" aria-label="Question type" className="mb-3 flex flex-wrap gap-2">
          {GROUPS.map(([id, label]) => (
            <button key={id} onClick={() => setGroup(id)} aria-pressed={group === id}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent ${group === id ? "border-accent bg-accent/10 font-semibold text-accent-fg" : "border-line text-muted hover:text-fg"}`}>
              {label} <span className="font-mono text-xs text-subtle">({now[group].hybrid?.n})</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-raised text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Metric</th>
                {MODES.map((m) => <th key={m.id} className="px-3 py-2 font-semibold">{m.label}<span className="block text-xs font-normal text-muted">{m.note}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {metrics.map(([k, label]) => (
                <tr key={k} className="border-t border-line">
                  <td className="px-3 py-2 text-fg-soft">{label}</td>
                  {MODES.map((m) => {
                    const v = now[group][m.id]?.[k];
                    return <td key={m.id} className="px-3 py-2 tabular-nums">{v === undefined ? "—" : k === "mrr" ? v.toFixed(3) : pct(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Every question</h2>
        <p className="mb-3 text-sm text-muted">The number is the rank of the right clause (1 is best); — means it was not in the top 10. Click a row to see what hybrid retrieved.</p>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-raised text-left">
              <tr><th className="px-3 py-2">Question</th>{MODES.map((m) => <th key={m.id} className="px-3 py-2 font-semibold">{m.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.retrieval.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer border-t border-line align-top hover:bg-raised">
                    <td className="px-3 py-2"><span className="mr-2 rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-muted">{r.kind === "none" ? "no answer" : r.kind}</span>{r.question}</td>
                    {MODES.map((m) => <td key={m.id} className="px-3 py-2">{r.kind === "none" ? <span className="text-subtle">n/a</span> : <Rank n={r.ranks[m.id]} />}</td>)}
                  </tr>
                  {open === r.id && (
                    <tr className="bg-canvas"><td colSpan={5} className="px-3 py-2 text-xs text-muted">
                      Hybrid's top results: {r.top?.length ? r.top.join("  ·  ") : "none"}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.answers && <AnswerQuality a={data.answers} />}

      <div className="max-w-3xl space-y-2 text-sm text-fg-soft">
        <h2 className="text-lg font-semibold text-fg">What to trust, and what not</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>It is a small set ({answerable} questions, 5 contracts). One question is about {(100 / answerable).toFixed(1)} points, so differences of a point or two are noise.</li>
          <li>Hybrid is about as good as vector-only here. Keyword search alone is weak because a question rarely has all its words in one clause. I tried matching any word: it helped questions that reuse the contract's words but hurt paraphrased ones, so I kept the original.</li>
          <li>“Hybrid + context” counts the text of the clauses that follow a heading-only clause, because that is what the Ask tab gives the model.</li>
          <li>Prefixing each sub-clause's embedding with its section title made no measurable difference.</li>
          <li>Answer scores come from an AI judge, not a person: a different, larger model than the one that wrote the answers, but still a model. Read a few answers yourself.</li>
        </ul>
      </div>
    </section>
  );
}

function Rank({ n }: { n?: number | null }) {
  if (n === undefined) return <span className="text-subtle">—</span>;
  const tone = n === null ? "text-danger" : n <= 3 ? "text-accent-fg font-semibold" : "text-warn";
  return <span className={`tabular-nums ${tone}`}>{n === null ? "—" : n}</span>;
}

const Stat = ({ label, value, note }: { label: string; value: string; note: string }) => (
  <div className="rounded-md border border-line bg-surface p-4">
    <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
    <p className="mt-1 text-sm font-semibold">{label}</p>
    <p className="text-xs text-muted">{note}</p>
  </div>
);

/** The written answers, scored: given at all, cites the right clause, sticks to what the clauses say, answers the question. */
function AnswerQuality({ a }: { a: Answers }) {
  const [open, setOpen] = useState<number | null>(null);
  const s = a.summary.all, none = a.summary.none;
  const p = (n: number | null) => (n === null ? "—" : pct(n));
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Answer quality</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The full Ask pipeline run on every question. Answers written by <code className="font-mono">{a.answer_model}</code>, scored by <code className="font-mono">{a.judge_model}</code>.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Answered" value={p(s.answered)} note={`of ${s.n} answerable questions, rest refused`} />
        <Stat label="Cites the right clause" value={p(s.right_clause_cited)} note={`right clause was in context ${p(s.right_clause_in_context)}`} />
        <Stat label="Faithful" value={p(s.faithfulness)} note="claims supported by the clauses given" />
        <Stat label="Addresses the question" value={p(s.addresses_question)} note="of the answers given" />
        <Stat label="Refuses when no answer" value={p(none.correctly_refused)} note={`${none.n} questions the contracts can't answer`} />
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-raised text-left"><tr><th className="px-3 py-2">Question</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Faithful</th></tr></thead>
          <tbody>
            {a.rows.map((r) => {
              const good = r.kind === "none" ? r.refused : !r.refused && r.cited_gold && (r.faithfulness ?? 1) >= 1;
              return (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer border-t border-line align-top hover:bg-raised">
                    <td className="px-3 py-2"><span className="mr-2 rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-muted">{r.kind === "none" ? "no answer" : r.kind}</span>{r.question}</td>
                    <td className={`px-3 py-2 ${good ? "text-accent-fg" : "text-warn"}`}>
                      {r.kind === "none" ? (r.refused ? "Refused ✓" : "Answered ✗") : r.refused ? "Refused ✗" : r.cited_gold ? "Cited right clause ✓" : r.context_has_gold ? "Had it, cited another" : "Missed the clause"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.faithfulness == null ? "—" : pct(r.faithfulness)}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-canvas"><td colSpan={3} className="space-y-2 px-3 py-3 text-sm">
                      <p className="whitespace-pre-wrap text-fg-soft">{r.answer}</p>
                      {r.unsupported && r.unsupported.length > 0 && <p className="text-xs text-warn">Not supported by the clauses: {r.unsupported.join(" · ")}</p>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
