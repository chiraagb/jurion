import { AlertTriangle, Check, CircleDashed, Copy, Loader2, X } from "lucide-react";
import { Link } from "@/lib/router";
import type { BatchItem } from "../useBatch";

const label = { queued: "Waiting", parsing: "Parsing…", saving: "Saving…", saved: "Saved", duplicate: "Already saved", error: "Failed" };

function Icon({ s }: { s: BatchItem["status"] }) {
  const c = "h-4 w-4 shrink-0";
  if (s === "parsing" || s === "saving") return <Loader2 className={`${c} motion-safe:animate-spin text-accent`} aria-hidden />;
  if (s === "saved") return <Check className={`${c} text-accent`} aria-hidden />;
  if (s === "duplicate") return <Copy className={`${c} text-warn`} aria-hidden />;
  if (s === "error") return <AlertTriangle className={`${c} text-danger`} aria-hidden />;
  return <CircleDashed className={`${c} text-subtle`} aria-hidden />;
}

export default function BatchList({ items, running, onClear }: { items: BatchItem[]; running: boolean; onClear: () => void }) {
  const done = items.filter((x) => x.status === "saved" || x.status === "duplicate" || x.status === "error").length;
  return (
    <section aria-label="Batch upload" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">
          {running ? `Saving ${done + 1} of ${items.length}` : `Done: ${items.filter((x) => x.status === "saved").length} of ${items.length} saved`}
        </h2>
        <span className="flex gap-2">
          {!running && <Link to="/ask" className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-sm font-medium text-fg hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent">Ask about them</Link>}
          {!running && <button onClick={onClear} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm text-fg-soft hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"><X className="h-4 w-4" aria-hidden /> Clear</button>}
        </span>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line paper" aria-live="polite">
        {items.map((x, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
            <span className="mt-0.5"><Icon s={x.status} /></span>
            <span className="min-w-0 flex-1">
              {x.id
                ? <Link to={`/contracts/${x.id}`} className="block break-words font-medium text-fg underline decoration-line-strong underline-offset-2 hover:text-accent-fg focus-visible:outline-2 focus-visible:outline-accent">{x.name}</Link>
                : <span className="block break-words font-medium text-fg">{x.name}</span>}
              {x.note && <span className={`block ${x.status === "error" ? "text-danger" : "text-muted"}`}>{x.note}</span>}
            </span>
            <span className="shrink-0 text-subtle">{label[x.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
