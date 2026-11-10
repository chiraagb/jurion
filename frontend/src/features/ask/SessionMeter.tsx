/** How much of a chat session's context budget is used. The model only sees this session's questions and answers plus the clauses it fetched for the current question. */
export default function SessionMeter({ used, limit, compact }: { used: number; limit: number; compact?: boolean }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const left = 100 - pct;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const tone = pct >= 85 ? "bg-danger" : pct >= 60 ? "bg-warn" : "bg-accent";
  return (
    <div className="flex items-center gap-2 text-xs text-muted" title={`About ${k(used)} of ${k(limit)} tokens used (estimated from text length). Long sessions make answers less accurate: start a new session for a new topic.`}>
      <span role="meter" aria-label="Session context used" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </span>
      <span className="tabular-nums">{compact ? `${pct}%` : `${left}% context left · ~${k(used)} of ${k(limit)}`}</span>
    </div>
  );
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** A small ring by the send button: how full the session's context is. Hover or focus it for the details. */
export function ContextRing({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const R = 11, C = 2 * Math.PI * R;
  const tone = pct >= 85 ? "text-danger" : pct >= 60 ? "text-warn" : "text-accent";
  return (
    <span className="group relative grid shrink-0 place-items-center">
      <button type="button" aria-label={`Session context: ${100 - pct}% left`} className="grid h-9 w-9 cursor-default place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
        <svg viewBox="0 0 28 28" className="h-7 w-7 -rotate-90" aria-hidden>
          <circle cx="14" cy="14" r={R} fill="none" strokeWidth="3" className="stroke-raised" />
          <circle cx="14" cy="14" r={R} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(pct, 3) / 100)} className={`stroke-current transition-[stroke-dashoffset] duration-300 ${tone}`} />
        </svg>
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 rounded-lg border border-line-strong bg-surface p-3 text-left text-xs leading-relaxed text-fg-soft opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <span className="block font-semibold text-fg">Session context</span>
        <span className="mt-1 block tabular-nums">{100 - pct}% left · ~{k(used)} of {k(limit)} tokens used</span>
        <span className="mt-1.5 block text-muted">Each answer sees this session's earlier questions and answers, plus the clauses found for the new question. Long sessions make answers less accurate, so start a new session for a new topic.</span>
        <span className="mt-1.5 block text-subtle">Estimated from text length.</span>
      </span>
    </span>
  );
}
