import type { Clause, ParseResult } from "../types";
import type { View } from "../useParseContract";
import { formatMs } from "@/lib/format";

const tableRows = (cs: Clause[]) => cs.reduce((n, c) => n + c.content.split("\n").filter((l) => l.startsWith("| ")).length, 0);
const stepMs = (r: ParseResult, name: "local" | "llm") => r.steps.find((s) => s.name === name)?.ms;
const pct = (r: ParseResult) => (r.confidence ? `${Math.round(r.confidence.score * 100)}%` : "–");

interface Props {
  local: ParseResult;
  ai: ParseResult;
  view: View;
  onView: (v: View) => void;
  aiName: string;
}

/** Local parser and AI result side by side, with a switch for which one the results below show. */
export default function Comparison({ local, ai, view, onView, aiName }: Props) {
  const onlyLocal = onlyIn(local.clauses, ai.clauses);
  const onlyAi = onlyIn(ai.clauses, local.clauses);
  const same = new Set(local.clauses.map((c) => c.clause_identifier)).size - onlyLocal.length;

  const rows: [string, string, string][] = [
    ["Clauses", String(local.clauses.length), String(ai.clauses.length)],
    ["Parse confidence", pct(local), pct(ai)],
    ["Table rows kept", String(tableRows(local.clauses)), String(tableRows(ai.clauses))],
    ["Warnings", String(local.confidence?.issues?.length ?? 0), String(ai.confidence?.issues?.length ?? 0)],
    ["Time", formatMs(stepMs(local, "local") ?? 0), formatMs(stepMs(ai, "llm") ?? 0)],
  ];

  return (
    <section aria-labelledby="compare-title" className="space-y-4 rounded-md border border-line paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="compare-title" className="font-display text-2xl font-semibold">Compare parsers</h2>
        <div role="group" aria-label="Result shown below" className="flex overflow-hidden rounded-lg border border-line-strong text-sm">
          {(["local", "ai"] as const).map((v, i) => (
            <button
              key={v}
              onClick={() => onView(v)}
              aria-pressed={view === v}
              className={`cursor-pointer px-3 py-1.5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent ${i ? "border-l border-line-strong" : ""} ${
                view === v ? "bg-accent font-medium text-canvas" : "text-fg-soft hover:bg-raised"
              }`}
            >
              {v === "local" ? "Local parser" : aiName}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="caption py-1 pr-3 font-bold"><span className="sr-only">Measure</span></th>
            <th className="caption py-1 text-right font-bold">Local parser</th>
            <th className="caption py-1 text-right font-bold">{aiName}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-t border-line">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-fg-soft">{label}</th>
              <td className="py-2 text-right tabular-nums text-fg">{a}</td>
              <td className="py-2 text-right tabular-nums text-fg">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-sm text-muted">{same} clause numbers appear in both.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Diff title="Only in the local parser" clauses={onlyLocal} />
        <Diff title={`Only in ${aiName}`} clauses={onlyAi} />
      </div>
    </section>
  );
}

/** Clauses whose identifier does not appear in `other`. */
function onlyIn(clauses: Clause[], other: Clause[]) {
  const have = new Set(other.map((c) => c.clause_identifier));
  return clauses.filter((c) => !have.has(c.clause_identifier));
}

function Diff({ title, clauses }: { title: string; clauses: Clause[] }) {
  const shown = clauses.slice(0, 24);
  return (
    <div>
      <p className="caption mb-2">{title} ({clauses.length})</p>
      {clauses.length === 0 ? (
        <p className="text-sm text-muted">Nothing.</p>
      ) : (
        <p className="flex flex-wrap gap-1.5">
          {shown.map((c, i) => (
            <span key={i} title={c.title} className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent-fg">
              {c.clause_identifier.length > 22 ? `${c.clause_identifier.slice(0, 21)}…` : c.clause_identifier}
            </span>
          ))}
          {clauses.length > shown.length && <span className="px-1 py-0.5 text-xs text-muted">+{clauses.length - shown.length} more</span>}
        </p>
      )}
    </div>
  );
}
