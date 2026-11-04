import { Fragment } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { ClauseRef } from "@/features/clause/ClausePanel";
import type { Brief } from "./api";

export interface Attempt {
  query: string;
  mode: "hybrid" | "keyword";
  note: string | null;
  hits: Brief[];
  relevant: number[] | null; // null until graded
}

/** The answer with **bold** shown as bold and [n] shown as a chip that opens clause n. */
export function AnswerCard({ answer, sources, onPick }: { answer: string; sources: Brief[]; onPick: (c: ClauseRef) => void }) {
  return (
    <div className="space-y-4 rounded-md border border-line bg-surface p-5">
      <p className="whitespace-pre-wrap font-display text-lg leading-relaxed text-fg" aria-live="polite">
        {answer.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
          if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
          const s = /^\[(\d+)\]$/.exec(part) && sources[Number(part.slice(1, -1)) - 1];
          return s ? (
            <button key={i} onClick={() => onPick(s)} title={`${s.filename}, clause ${s.clause_identifier}`} className="mx-0.5 cursor-pointer rounded bg-accent/10 px-1 font-mono text-xs text-accent-fg hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent">
              {part.slice(1, -1)}
            </button>
          ) : <Fragment key={i}>{part}</Fragment>;
        })}
      </p>
      {sources.length > 0 && (
        <ol className="space-y-2 border-t border-line pt-4">
          {sources.map((s, i) => (
            <li key={i}>
              <button onClick={() => onPick(s)} className="flex w-full cursor-pointer gap-3 rounded-md p-1 text-left text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 font-mono text-xs text-accent-fg">{i + 1}</span>
                <span className="min-w-0">
                  <span className="font-semibold text-fg">{s.clause_identifier} {s.title}</span>
                  <span className="text-muted"> · {s.filename}{s.page_number ? ` · p.${s.page_number}` : ""}</span>
                  {s.snippet && <span className="line-clamp-2 block text-fg-soft">{s.snippet}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** "How I got this": what was retrieved, which clauses passed the relevance check, and whether the question was rewritten. */
export function Trace({ attempts, onPick }: { attempts: Attempt[]; onPick: (c: ClauseRef) => void }) {
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">How I got this answer</summary>
      <div className="space-y-5 border-t border-line p-5">
        {attempts.map((a, n) => (
          <div key={n}>
            <p className="text-sm">
              <span className="font-semibold">{n === 0 ? "Searched for" : "Rewrote the question and searched for"}</span> “{a.query}”
              <span className="text-muted"> · {a.mode === "hybrid" ? "vector + keyword" : "keyword only"} · {a.hits.length} clauses retrieved</span>
            </p>
            {a.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
            <ul className="mt-2 space-y-1">
              {a.hits.map((h, i) => {
                const ok = a.relevant?.includes(i);
                return (
                  <li key={i}>
                    <button onClick={() => onPick(h)} className={`flex w-full cursor-pointer items-center gap-2 rounded px-1 text-left text-sm hover:bg-raised ${ok ? "text-fg" : "text-muted"}`}>
                      {a.relevant === null ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : ok ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-label="relevant" /> : <X className="h-3.5 w-3.5 shrink-0" aria-label="not relevant" />}
                      <span className="shrink-0 font-mono text-xs">{h.clause_identifier}</span>
                      <span className="min-w-0 truncate">{h.title}</span>
                      <span className="shrink-0 text-xs text-subtle">{h.filename}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
