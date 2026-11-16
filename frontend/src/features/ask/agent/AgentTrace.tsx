import {
  Check,
  Compass,
  FileText,
  Loader2,
  Search,
  Users,
  Library,
  MessageCircleQuestion,
  Link2,
  OctagonAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ClauseRef } from "@/features/clause/ClausePanel";
import type { AgentStep, Brief } from "../api";

const TOOL: Record<
  string,
  {
    label: string;
    icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  }
> = {
  list_contracts: { label: "Listed your contracts", icon: Library },
  search_clauses: { label: "Searched", icon: Search },
  read_clause: { label: "Read a clause in full", icon: FileText },
  follow_references: { label: "Followed references", icon: Link2 },
  company_info: { label: "Looked up a company", icon: Users },
  library_stats: { label: "Checked your library", icon: Library },
  ask_user: { label: "Asked you which contract", icon: MessageCircleQuestion },
  finish: { label: "Decided it had enough", icon: Check },
};

const detail = (s: AgentStep) => {
  const a = s.args as {
    query?: string;
    number?: number;
    name?: string;
    kind?: string;
  };
  return a.query
    ? `“${a.query}”`
    : a.name
      ? `“${a.name}”`
      : a.number
        ? `clause [${a.number}]`
        : (a.kind ?? "");
};

/** The agent's steps, in order: what it did, why (its own one sentence), and what came back. Each search can be opened to its clauses. */
export default function AgentTrace({
  steps,
  budget,
  onPick,
  live,
}: {
  steps: AgentStep[];
  budget?: { hit: string } | null;
  onPick: (c: ClauseRef) => void;
  live?: boolean;
}) {
  return (
    <details
      className="group rounded-2xl border border-line bg-surface"
      open={live}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span
          className="transition-transform duration-200 group-open:rotate-90"
          aria-hidden
        >
          ›
        </span>{" "}
        What the agent did
        <span className="font-normal text-muted">
          · {steps.length} step{steps.length === 1 ? "" : "s"}
          {budget ? ", stopped at its limit" : ""}
        </span>
      </summary>
      <ol className="ml-7 space-y-4 border-l border-line-strong px-5 pb-5 pt-1">
        {steps.map((s) => {
          const t = TOOL[s.tool] ?? { label: s.tool, icon: Compass };
          const Icon = t.icon;
          return (
            <li key={s.n} className="relative">
              <span
                className="absolute left-[-1.72rem] top-0.5 grid h-3 w-3 place-items-center rounded-full border-2 border-accent bg-surface"
                aria-hidden
              />
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
                <span className="font-semibold">{t.label}</span>
                {detail(s) && (
                  <span className="wrap-anywhere">{detail(s)}</span>
                )}
                <span className="text-muted">
                  · {s.observation} · {(s.ms / 1000).toFixed(1)} s
                </span>
              </p>
              {s.reason && (
                <p className="mt-0.5 text-xs leading-snug text-fg-soft">
                  Why: {s.reason}
                </p>
              )}
              {s.hits && s.hits.length > 0 && (
                <details className="mt-1.5 text-sm">
                  <summary className="cursor-pointer text-xs text-muted focus-visible:outline-2 focus-visible:outline-accent">
                    Show the {s.hits.length} clauses it saw
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {s.hits.map((h: Brief, i) => (
                      <li key={i}>
                        <button
                          onClick={() => onPick(h)}
                          className="flex min-h-9 w-full cursor-pointer items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-fg-soft hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <span className="max-w-28 shrink-0 truncate font-mono text-xs">
                            {h.clause_identifier}
                          </span>
                          <span className="min-w-0 truncate">{h.title}</span>
                          <span className="ml-auto hidden shrink-0 text-xs text-muted sm:inline">
                            {h.filename.replace(/\.pdf$/i, "").slice(0, 28)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
        {live && (
          <li className="flex items-center gap-2 text-sm text-muted">
            <Loader2
              className="h-3.5 w-3.5 motion-safe:animate-spin"
              aria-hidden
            />{" "}
            Working…
          </li>
        )}
        {budget && (
          <li className="flex items-center gap-2 text-sm text-fg-soft">
            <OctagonAlert className="h-3.5 w-3.5 text-accent" aria-hidden />{" "}
            Stopped at its {budget.hit.replace("_", " ")} limit and answered
            with what it had.
          </li>
        )}
      </ol>
    </details>
  );
}
