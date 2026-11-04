import type { ClauseRef } from "@/features/clause/ClausePanel";
import type { Hit } from "./api";

/** Search results; a click opens the clause itself (PDF page and full text) in the side panel. */
export default function HitList({ results, onPick }: { results: Hit[]; onPick: (c: ClauseRef) => void }) {
  return (
    <ul className="space-y-3">
      {results.map((h) => (
        <li key={`${h.document_id}-${h.position}`}>
          <button
            onClick={() => onPick(h)}
            className="block w-full cursor-pointer rounded-md border border-line bg-surface p-4 text-left transition-colors duration-200 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-xs font-medium text-accent-fg">{h.clause_identifier}</span>
              <span className="font-display text-lg font-semibold text-fg">{h.title}</span>
            </span>
            <span className="mt-1 block text-sm text-muted">{h.filename}{h.page_number ? ` · p.${h.page_number}` : ""}</span>
            <span className="mt-2 line-clamp-3 block text-sm text-fg-soft">{h.snippet}</span>
            <span className="mt-3 flex flex-wrap gap-2 font-mono text-xs tabular-nums text-muted">
              {[
                `vector ${h.vector_rank ? `#${h.vector_rank} · sim ${h.vector_similarity?.toFixed(3)}` : "—"}`,
                `keyword ${h.keyword_rank ? `#${h.keyword_rank}` : "—"}`,
                `fused ${(h.score * 1000).toFixed(1)}`,
              ].map((t) => <span key={t} className="rounded-sm border border-line px-1.5 py-0.5">{t}</span>)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
