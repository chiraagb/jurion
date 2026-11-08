import { Fragment, useId, useState } from "react";
import { Check, ChevronDown, FileText, Loader2, Network, PanelRight, X } from "lucide-react";
import type { ClauseRef } from "@/features/clause/ClausePanel";
import type { Brief } from "./api";

export interface Attempt {
  query: string;
  mode: "hybrid" | "keyword";
  note: string | null;
  scope?: string[]; // contracts the graph narrowed this search to
  contracts?: number; // how many contracts there were to choose from
  scope_reason?: string; // the router's one sentence on why (or why no contract was picked)
  hits: Brief[];
  relevant: number[] | null; // null until graded
  reasons?: Record<string, string>; // the grader's one sentence for each clause, kept or left out
}

/** Long file names keep their start and their ending ("…Supply Agreement.pdf"). */
export const shortName = (n: string, max = 40) => (n.length <= max ? n : `${n.slice(0, max - 16)}…${n.slice(-14)}`);

const MIN_KEY = "jurion.refs.minimized";
const readMin = () => { try { return localStorage.getItem(MIN_KEY) === "1"; } catch { return false; } }; // storage can be blocked: never required

/** The references as cards, or minimized to one row of chips. A click opens that clause; `selected` is the one open beside the answer. */
export function ReferenceCards({ sources, selected, onPick }: { sources: Brief[]; selected?: number | null; onPick: (c: ClauseRef, index: number) => void }) {
  const [min, setMin] = useState(readMin);
  const listId = useId();
  const toggle = () => setMin((m) => { try { localStorage.setItem(MIN_KEY, m ? "0" : "1"); } catch { /* ignore */ } return !m; });
  return (
    <section aria-label="References" className={`border-t border-line px-5 pt-3 ${min ? "pb-3" : "pb-5"}`}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        References <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-xs font-normal text-muted">{sources.length}</span>
        <button
          onClick={toggle}
          aria-expanded={!min}
          aria-controls={listId}
          className="ml-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-normal text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          {min ? "Show details" : "Minimize"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${min ? "" : "rotate-180"}`} aria-hidden />
        </button>
      </h3>
      {min ? (
        <ul id={listId} className="flex flex-wrap gap-2 pb-1">
          {sources.map((s, i) => {
            const on = selected === i;
            return (
              <li key={`${s.document_id}-${s.position}`}>
                <button
                  onClick={() => onPick(s, i)}
                  aria-pressed={on}
                  title={`${s.clause_identifier} ${s.title} · ${s.filename}${s.page_number ? ` · p.${s.page_number}` : ""}`}
                  className={`inline-flex h-10 max-w-[16rem] cursor-pointer items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    on ? "border-accent bg-accent/10 text-fg" : "border-line-strong bg-surface text-fg-soft hover:border-accent hover:text-fg"
                  }`}
                >
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold ${on ? "bg-accent text-canvas" : "bg-accent/10 text-accent-fg"}`}>{i + 1}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{s.clause_identifier}</span>
                  <span className="min-w-0 truncate">{s.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
      <ul id={listId} className="grid gap-3 sm:grid-cols-2">
        {sources.map((s, i) => {
          const on = selected === i;
          return (
            <li key={`${s.document_id}-${s.position}`}>
              <button
                onClick={() => onPick(s, i)}
                aria-pressed={on}
                className={`group flex h-full w-full cursor-pointer flex-col gap-2 rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  on ? "border-accent bg-accent/5 shadow-[0_0_0_1px_var(--accent)]" : "border-line bg-surface hover:border-line-strong hover:bg-raised/50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold ${on ? "bg-accent text-canvas" : "bg-accent/10 text-accent-fg"}`}>{i + 1}</span>
                  <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-xs text-fg-soft">{s.clause_identifier}</span>
                  {s.via && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-warn/15 px-1.5 py-0.5 text-xs text-fg" title="Not a search match: the graph pulled this clause in because a matched clause refers to it">
                      <Network className="h-3 w-3" aria-hidden /> pulled in by {s.via}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 font-display text-base font-semibold leading-snug text-fg">{s.title}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={s.filename}>{shortName(s.filename, 34)}</span>
                  {s.page_number && <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-fg-soft">p.{s.page_number}</span>}
                </span>
                {s.snippet && <span className="line-clamp-3 border-l-2 border-line-strong pl-2.5 text-sm leading-relaxed text-fg-soft">{s.snippet}</span>}
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs text-muted transition-colors group-hover:text-accent-fg">
                  <PanelRight className="h-3.5 w-3.5" aria-hidden /> {on ? "Open beside the answer" : "Open beside the answer"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}

/** The answer with **bold** shown as bold and [n] shown as a chip that opens reference n. */
export function AnswerCard({ answer, sources, onPick, selected, streaming, scope }: {
  answer: string; sources: Brief[]; onPick: (c: ClauseRef, index: number) => void; selected?: number | null; streaming?: boolean; scope?: string[];
}) {
  return (
    <div className="paper rounded-2xl border border-line">
      {scope && scope.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 px-5 pt-4 text-xs text-fg-soft">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 font-medium text-accent-fg">
            <Network className="h-3.5 w-3.5" aria-hidden /> Narrowed by the graph
          </span>
          <span className="min-w-0 truncate" title={scope.join(", ")}>searched only {scope.map((s) => shortName(s, 30)).join(", ")}</span>
        </p>
      )}
      <p className="whitespace-pre-wrap px-5 py-4 font-display text-lg leading-[1.7] text-fg [overflow-wrap:anywhere]">
        {answer.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
          if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
          const n = /^\[(\d+)\]$/.exec(part) ? Number(part.slice(1, -1)) - 1 : -1;
          const s = n >= 0 ? sources[n] : undefined;
          return s ? (
            <button
              key={i}
              onClick={() => onPick(s, n)}
              title={`${s.filename}, clause ${s.clause_identifier}`}
              aria-label={`Reference ${n + 1}: clause ${s.clause_identifier}`}
              className={`mx-0.5 inline-grid h-6 min-w-6 -translate-y-px cursor-pointer place-items-center rounded-md px-1 align-middle font-mono text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${
                selected === n ? "bg-accent text-canvas" : "bg-accent/10 text-accent-fg hover:bg-accent/25"
              }`}
            >
              {n + 1}
            </button>
          ) : <Fragment key={i}>{part}</Fragment>;
        })}
        {streaming && <span aria-hidden className="ml-0.5 inline-block h-5 w-[3px] translate-y-1 bg-accent motion-safe:animate-[caret_1s_steps(2)_infinite]" />}
      </p>
      {sources.length > 0 && <ReferenceCards sources={sources} selected={selected} onPick={onPick} />}
    </div>
  );
}

/** "How I got this": the steps behind the answer, as a timeline. */
export function Trace({ attempts, sources = [], onPick }: { attempts: Attempt[]; sources?: Brief[]; onPick: (c: ClauseRef) => void }) {
  const widened = sources.filter((s) => s.via).length;
  return (
    <details className="group rounded-2xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="transition-transform duration-200 group-open:rotate-90" aria-hidden>›</span> How I got this answer
        <span className="font-normal text-muted">· {attempts.length} search{attempts.length > 1 ? "es" : ""}{widened ? `, ${widened} pulled in by the graph` : ""}</span>
      </summary>
      <ol className="ml-7 space-y-5 border-l border-line-strong px-5 pb-5 pt-1">
        {attempts.map((a, n) => (
          <li key={n} className="relative">
            <span className="absolute -left-[1.72rem] top-1 grid h-3 w-3 place-items-center rounded-full border-2 border-accent bg-surface" aria-hidden />
            <p className="text-sm">
              <span className="font-semibold">{n === 0 ? "Searched" : "Rewrote the question, then searched"}</span> “{a.query}”
              <span className="text-muted"> · {a.mode === "hybrid" ? "meaning + words" : "words only"}</span>
            </p>
            {a.contracts !== undefined && a.contracts > 1 && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-fg-soft">
                <Network className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="font-semibold text-fg">Which contract? </span>
                  {a.scope && a.scope.length > 0
                    ? <>Narrowed to {a.scope.map((s) => shortName(s, 30)).join(", ")} first, with the best of all {a.contracts} contracts added after.</>
                    : <>None was named, so all {a.contracts} contracts were searched.</>}
                  {a.scope_reason ? <span className="text-muted"> {a.scope_reason}</span> : null}
                </span>
              </p>
            )}
            {a.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
            <ul className="mt-2 space-y-0.5">
              {a.hits.map((h, i) => {
                const ok = a.relevant?.includes(i);
                const why = a.reasons?.[String(i)];
                return (
                  <li key={i}>
                    <button onClick={() => onPick(h)} className={`flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent ${ok ? "text-fg" : "text-muted"}`}>
                      {a.relevant === null ? <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden /> : ok ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="relevant" /> : <X className="h-3.5 w-3.5 shrink-0" aria-label="not relevant" />}
                      <span className="shrink-0 font-mono text-xs">{h.clause_identifier}</span>
                      <span className="min-w-0 truncate">{h.title}</span>
                      <span className="hidden shrink-0 text-xs text-subtle sm:inline">{shortName(h.filename, 26)}</span>
                    </button>
                    {why && (
                      <p className={`ml-[1.65rem] max-w-prose pb-1 pr-2 text-xs leading-snug ${ok ? "text-subtle" : "text-fg-soft"}`}>
                        <span className={`font-semibold ${ok ? "text-accent-fg" : "text-warn"}`}>{ok ? "Used because" : "Left out because"}</span> {why.charAt(0).toLowerCase() + why.slice(1)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {sources.length > 0 && (
          <li className="relative">
            <span className="absolute -left-[1.72rem] top-1 grid h-3 w-3 place-items-center rounded-full bg-accent" aria-hidden />
            <p className="text-sm"><span className="font-semibold">Wrote the answer</span> <span className="text-muted">from {sources.length} reference{sources.length > 1 ? "s" : ""} and nothing else</span></p>
          </li>
        )}
      </ol>
    </details>
  );
}
