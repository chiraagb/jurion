import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api";
import RerankEffect from "./RerankEffect";
import WorkflowVsAgent from "./WorkflowVsAgent";

type Mode = "vector" | "keyword" | "hybrid" | "rerank" | "context" | "scope" | "soft" | "graph";
type Kind = "direct" | "paraphrase" | "broad" | "graph" | "multi" | "none";
interface Score { "hit@1": number; "hit@3": number; "hit@5": number; "hit@10": number; mrr: number; n: number }
type Summary = Record<"all" | "direct" | "paraphrase" | "broad" | "graph" | "multi", Partial<Record<Mode, Score>>>;
interface Row { id: number; question: string; kind: Kind; ranks: Partial<Record<Mode, number | null>>; top?: string[]; scope?: string[]; widened?: string[] }
interface Run { summary: Summary; rows: Row[]; ran_at?: string }
interface AnswerRow {
  id: number; question: string; kind: Kind; answer: string; sources: number; refused: boolean;
  context_has_gold?: boolean; cited_gold?: boolean; faithfulness?: number | null; unsupported?: string[]; answers_question?: boolean;
}
interface AnswerStats { n: number; answered: number | null; right_clause_in_context: number | null; right_clause_cited: number | null; answered_wrong_clause: number | null; faithfulness: number | null; addresses_question: number | null }
interface Answers { summary: Record<"all" | "direct" | "paraphrase" | "broad", AnswerStats> & { none: { n: number; correctly_refused: number | null } }; rows: AnswerRow[]; answer_model: string; judge_model: string; ran_at: string }
interface Data { available?: false; ran_at: string; embedding_model: string; questions: number; baseline?: Run; retrieval: Run; answers?: Answers; answers_5_contracts?: Answers }

const MODES: { id: Mode; label: string; note: string }[] = [
  { id: "vector", label: "Vector only", note: "meaning match" },
  { id: "keyword", label: "Keyword only", note: "Postgres full-text" },
  { id: "hybrid", label: "Hybrid", note: "vector + keyword" },
  { id: "rerank", label: "Reranked", note: "hybrid re-scored by bge-reranker" },
  { id: "context", label: "Hybrid + context", note: "headings widened" },
  { id: "scope", label: "Hard narrowing", note: "only the contracts the graph picks" },
  { id: "soft", label: "Soft narrowing", note: "picked contracts first, plus the best of all" },
  { id: "graph", label: "+ Widened", note: "soft narrowing + linked clauses (Ask)" },
];
const GROUPS = [["all", "All"], ["direct", "Same words"], ["paraphrase", "Other words"], ["broad", "Whole section"], ["graph", "Names a party"], ["multi", "Needs two clauses"]] as const;
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
  const metrics = [["hit@1", "Right clause is #1"], ["hit@3", "…in the top 3"], ["hit@5", "…in the top 5"], ["hit@10", "…in the top 10"], ["mrr", "Mean reciprocal rank"]] as const;
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

      <WorkflowVsAgent data={data as unknown as Record<string, unknown>} />

      <h2 className="border-t border-line pt-8 font-display text-3xl font-semibold tracking-tight">Retrieval: does the right clause come back?</h2>

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

      <RerankEffect summary={now} />

      <GraphEffect rows={data.retrieval.rows} />

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
                    <tr className="bg-canvas"><td colSpan={MODES.length + 1} className="px-3 py-2 text-xs text-muted">
                      {r.scope && r.scope.length > 0 ? <>The graph narrowed this to <b>{r.scope.join(", ")}</b>.<br /></> : null}
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
      {data.answers && data.answers_5_contracts && <CorpusGrowth before={data.answers_5_contracts} after={data.answers} />}

      <div className="max-w-3xl space-y-2 text-sm text-fg-soft">
        <h2 className="text-lg font-semibold text-fg">What to trust, and what not</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>It is a small set ({answerable} questions, 5 contracts). One question is about {(100 / answerable).toFixed(1)} points, so differences of a point or two are noise.</li>
          <li>Hybrid is about as good as vector-only here. Keyword search alone is weak because a question rarely has all its words in one clause. I tried matching any word: it helped questions that reuse the contract's words but hurt paraphrased ones, so I kept the original.</li>
          <li>“Hybrid + context” counts the text of the clauses that follow a heading-only clause, because that is what the Ask tab gives the model.</li>
          <li>Prefixing each sub-clause's embedding with its section title made no measurable difference.</li>
          <li>The graph fixed the failures it was built for (questions that name a contract) and left overall search quality about the same. Narrowing can also hurt: the first version broke four questions by guessing a contract from the topic.</li>
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Answered" value={p(s.answered)} note={`of ${s.n} answerable questions, rest refused`} />
        <Stat label="Cites the right clause" value={p(s.right_clause_cited)} note={`right clause was in context ${p(s.right_clause_in_context)}`} />
        <Stat label="Answered from the wrong clause" value={p(s.answered_wrong_clause)} note="confident and cited, but not the right clause (varies 0–5% between runs)" />
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

/** Did narrowing by the graph help? Counted question by question: rescued (missed before, found now) vs broken (found before, missed now). */
function GraphEffect({ rows }: { rows: Row[] }) {
  const ans = rows.filter((r) => r.kind !== "none" && r.ranks.graph !== undefined);
  if (ans.length === 0) return null;
  const rescued = ans.filter((r) => r.ranks.context == null && r.ranks.graph != null);
  const broken = ans.filter((r) => r.ranks.context != null && r.ranks.graph == null);
  const better = ans.filter((r) => r.ranks.context != null && r.ranks.graph != null && r.ranks.graph < r.ranks.context).length;
  const worse = ans.filter((r) => r.ranks.context != null && r.ranks.graph != null && r.ranks.graph > r.ranks.context).length;
  // Widening alone: narrowed vs narrowed + widened, on the same questions.
  const wGain = ans.filter((r) => r.ranks.soft == null && r.ranks.graph != null);
  const wLoss = ans.filter((r) => r.ranks.soft != null && r.ranks.graph == null);
  const wUp = ans.filter((r) => r.ranks.soft != null && r.ranks.graph != null && r.ranks.graph < r.ranks.soft).length;
  const wDown = ans.filter((r) => r.ranks.soft != null && r.ranks.graph != null && r.ranks.graph > r.ranks.soft).length;
  const widenedAny = ans.filter((r) => (r.widened?.length ?? 0) > 0).length;
  // Hard vs soft narrowing on the same questions: did hedging recover what a wrong guess lost?
  const hs = ans.filter((r) => r.ranks.soft !== undefined);
  const hLost = hs.filter((r) => r.ranks.context != null && r.ranks.scope == null);
  const hBack = hs.filter((r) => r.ranks.context != null && r.ranks.scope == null && r.ranks.soft != null);
  const hStill = hs.filter((r) => r.ranks.context != null && r.ranks.soft == null);
  const List = ({ rs }: { rs: Row[] }) => <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg-soft">{rs.map((r) => <li key={r.id}>{r.question}{r.scope && r.scope.length > 0 ? <span className="text-muted"> (narrowed to {r.scope.join(", ")})</span> : null}</li>)}</ul>;
  return (
    <div className="rounded-md border border-line bg-surface p-5">
      <p className="font-semibold">Step 2: using the graph in Ask, counted question by question</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">The graph narrows a question to the contracts it names (by company, role or kind of document) and pulls in clauses that a found clause refers to. Compared with the same search without it:</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div><p className="text-sm"><b className="text-accent-fg">{rescued.length} rescued</b> <span className="text-muted">(missed in the top 10 before, found now)</span></p>{rescued.length ? <List rs={rescued} /> : <p className="mt-1 text-sm text-muted">none</p>}</div>
        <div><p className="text-sm"><b className="text-warn">{broken.length} broken</b> <span className="text-muted">(found before, missed now)</span></p>{broken.length ? <List rs={broken} /> : <p className="mt-1 text-sm text-muted">none</p>}</div>
      </div>
      {hs.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-semibold">Hard vs soft narrowing</p>
          <p className="mt-1 text-sm text-fg-soft">
            Searching only the contracts the graph picks lost the right clause for <b className="text-warn">{hLost.length}</b> question{hLost.length === 1 ? "" : "s"} that plain search found (a wrong guess hides the answer).
            Adding the best results from every contract brought <b className="text-accent-fg">{hBack.length}</b> back; <b>{hStill.length}</b> {hStill.length === 1 ? "is" : "are"} still lost compared with no narrowing.
          </p>
          {hLost.length > 0 && <List rs={hLost} />}
        </div>
      )}
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-sm font-semibold">Widening on its own (soft narrowing vs soft narrowing + pulled-in clauses)</p>
        <p className="mt-1 text-sm text-fg-soft">
          Widening added clauses for <b>{widenedAny}</b> of {ans.length} questions. It rescued <b className="text-accent-fg">{wGain.length}</b>, broke <b className="text-warn">{wLoss.length}</b>, and of those found both ways ranked {wUp} higher and {wDown} lower.
          {wGain.length === 0 && wLoss.length === 0 && wUp === 0 ? " So on these questions it changes nothing measurable." : ""}
        </p>
        {wGain.length > 0 && <List rs={wGain} />}
      </div>
      <p className="mt-3 text-sm text-muted">Of the questions found both ways, {better} ranked higher with the graph and {worse} lower. If these two lists are about the same size, the graph is not paying for itself yet, and we say so.</p>
    </div>
  );
}

/** Answers on the SAME questions when the library was 5 contracts and when it is 15: more contracts means more look-alike clauses. */
function CorpusGrowth({ before, after }: { before: Answers; after: Answers }) {
  const prior = new Map(before.rows.map((r) => [r.id, r]));
  const ids = after.rows.filter((r) => r.kind !== "none" && prior.has(r.id)).map((r) => r.id);
  const now = new Map(after.rows.map((r) => [r.id, r]));
  const stat = (rows: AnswerRow[]) => {
    const f = rows.filter((r) => !r.refused && r.faithfulness != null).map((r) => r.faithfulness as number);
    return {
      answered: rows.filter((r) => !r.refused).length / rows.length,
      cited: rows.filter((r) => r.cited_gold).length / rows.length,
      wrong: rows.filter((r) => !r.refused && !r.cited_gold).length / rows.length,
      faith: f.length ? f.reduce((a, b) => a + b, 0) / f.length : null,
    };
  };
  const b = stat(ids.map((i) => prior.get(i)!)), a = stat(ids.map((i) => now.get(i)!));
  const rows: [string, number | null, number | null][] = [["Answered, not refused", b.answered, a.answered], ["Cites the right clause", b.cited, a.cited], ["Answered from the wrong clause", b.wrong, a.wrong], ["Faithful to the clauses given", b.faith, a.faith]];
  const changed = ids.filter((i) => { const x = prior.get(i)!, y = now.get(i)!; return x.refused !== y.refused || !!x.cited_gold !== !!y.cited_gold; });
  const p = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">The same {ids.length} questions: 5 contracts vs 15 contracts</h2>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-raised text-left"><tr><th className="px-3 py-2">Measure</th><th className="px-3 py-2">5 contracts</th><th className="px-3 py-2">15 contracts</th></tr></thead>
          <tbody>{rows.map(([l, x, y]) => <tr key={l} className="border-t border-line"><td className="px-3 py-2 text-fg-soft">{l}</td><td className="px-3 py-2 tabular-nums">{p(x)}</td><td className="px-3 py-2 tabular-nums font-semibold">{p(y)}</td></tr>)}</tbody>
        </table>
      </div>
      {changed.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-soft">
          {changed.map((i) => { const x = prior.get(i)!, y = now.get(i)!; return <li key={i}>{x.question}: <span className="text-muted">{x.refused ? "refused" : x.cited_gold ? "right clause" : "wrong clause"}</span> → <b>{y.refused ? "refused" : y.cited_gold ? "right clause" : "wrong clause"}</b></li>; })}
        </ul>
      )}
      <p className="max-w-3xl text-xs text-muted">More contracts means more clauses that look alike, so search has more to confuse. Some of the drop is questions that now have several valid answers in different contracts while the test accepts one. Single runs: answers differ slightly between runs, and one question is about {(100 / ids.length).toFixed(1)} points.</p>
    </div>
  );
}
