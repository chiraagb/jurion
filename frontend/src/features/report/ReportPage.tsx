import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, Search } from "lucide-react";
import { aiRuns, checks, corpus, findings, gaps, labels, next, survey, tiles, worked } from "./reportData";

/** What was tested, what the numbers say, what is still open. Static: it mirrors docs/09-parser-test-results.md. */
export default function ReportPage() {
  return (
    <div className="space-y-10">
      <section aria-labelledby="report-title" className="max-w-2xl">
        <p className="caption mb-3">Exhibit B · Findings of the court</p>
        <h1 id="report-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Parser report</h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          What was tested, what worked, what the numbers say, and what is still open. As of 3 Nov 2026.
        </p>
        <div className="mt-6 h-1.5 w-24 border-y border-accent" aria-hidden />
      </section>

      <dl className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border border-line paper p-4">
            <dt className="caption">{t.label}</dt>
            <dd className={`mt-1 font-display text-3xl font-semibold ${t.warn ? "text-warn" : "text-fg"}`}>{t.value}</dd>
            <p className="mt-1 text-sm text-muted">{t.note}</p>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="What worked" items={worked} icon={<Check className="h-4 w-4 text-success" aria-hidden />} />
        <Card title="What we found" items={findings} icon={<Search className="h-4 w-4 text-accent-fg" aria-hidden />} />
        <Card title="Gaps" items={gaps} icon={<AlertTriangle className="h-4 w-4 text-warn" aria-hidden />} />
        <Card title="What's next" items={next} icon={<ArrowRight className="h-4 w-4 text-accent-fg" aria-hidden />} />
      </div>

      <Section title="Tests you can run" sub="From the backend folder.">
        <ul className="divide-y divide-line rounded-md border border-line paper">
          {checks.map(([cmd, what]) => (
            <li key={cmd} className="space-y-1 p-4">
              <code className="break-all font-mono text-sm text-accent-fg">{cmd}</code>
              <p className="text-sm text-muted">{what}</p>
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Four real contracts" sub={corpus.note}>
          <Table head={corpus.head} rows={corpus.rows} />
        </Section>
        <Section title="510 CUAD contracts" sub={survey.note}>
          <Table head={survey.head} rows={survey.rows} />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="AI fallback, tried for real">
          <ul className="space-y-2 rounded-md border border-line paper p-4 text-sm text-fg-soft">
            {aiRuns.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </Section>
        <Section title="Label drafts (boundary accuracy)" sub="Precision and recall need these reviewed first.">
          <dl className="divide-y divide-line rounded-md border border-line paper">
            {labels.map(([k, v]) => (
              <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-3 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div>
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  return (
    <Section title={title}>
      <ul className="space-y-3 rounded-md border border-line paper p-5">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-sm leading-relaxed text-fg-soft">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line paper">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-raised text-left text-fg">
          <tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-line">
              {r.map((c, i) => <td key={i} className={`px-3 py-2 tabular-nums ${i ? "text-right text-fg" : "text-fg-soft"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
