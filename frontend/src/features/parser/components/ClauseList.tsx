import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { Clause } from "../types";

interface Props {
  clauses: Clause[];
  onOpen: (page: number) => void;
}

export default function ClauseList({ clauses, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // Tree by index: a clause's parent is the first clause with its parent_identifier.
  const { roots, children } = useMemo(() => {
    const firstIndex = new Map<string, number>();
    clauses.forEach((c, i) => firstIndex.has(c.clause_identifier) || firstIndex.set(c.clause_identifier, i));
    const children = new Map<number, number[]>();
    const roots: number[] = [];
    clauses.forEach((c, i) => {
      const parent = c.parent_identifier ? firstIndex.get(c.parent_identifier) : undefined;
      if (parent === undefined || parent === i) roots.push(i);
      else children.set(parent, [...(children.get(parent) ?? []), i]);
    });
    return { roots, children };
  }, [clauses]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? clauses.flatMap((c, i) =>
            `${c.clause_identifier} ${c.title} ${c.content}`.toLowerCase().includes(q) ? [i] : [],
          )
        : [],
    [clauses, q],
  );

  const toggle = (i: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const renderNode = (i: number) => {
    const kids = children.get(i) ?? [];
    const isCollapsed = collapsed.has(i);
    return (
      <li key={i}>
        <div className="flex items-start gap-1.5">
          {kids.length > 0 ? (
            <button
              onClick={() => toggle(i)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${kids.length} sub-clause${kids.length > 1 ? "s" : ""} of ${clauses[i].clause_identifier}`}
              className="mt-3 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} />
            </button>
          ) : (
            <span className="w-8 shrink-0" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <ClauseCard clause={clauses[i]} onOpen={onOpen} />
          </div>
        </div>
        {kids.length > 0 && !isCollapsed && (
          <ul className="ml-4 mt-2 space-y-2 border-l border-line-strong pl-2.5">{kids.map(renderNode)}</ul>
        )}
      </li>
    );
  };

  const parents = [...children.keys()];

  return (
    <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <label htmlFor="clause-search" className="sr-only">Search clauses</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            id="clause-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by section, title or text…"
            className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-base text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>
        {!q && parents.length > 0 && (
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-line-strong text-sm">
            <button
              onClick={() => setCollapsed(new Set(parents))}
              className="cursor-pointer px-3 text-fg-soft transition-colors duration-200 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
            >
              Collapse all
            </button>
            <button
              onClick={() => setCollapsed(new Set())}
              className="cursor-pointer border-l border-line-strong px-3 text-fg-soft transition-colors duration-200 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
            >
              Expand all
            </button>
          </div>
        )}
      </div>

      {q ? (
        matches.length === 0 ? (
          <p className="rounded-md border border-line p-6 text-center text-sm text-muted">No clauses match “{query}”.</p>
        ) : (
          <ul className="space-y-2">
            {matches.map((i) => (
              <li key={i}>
                <ClauseCard clause={clauses[i]} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="space-y-2">{roots.map(renderNode)}</ul>
      )}
    </>
  );
}

function ClauseCard({ clause: c, onOpen }: { clause: Clause; onOpen: (page: number) => void }) {
  return (
    <details
      onToggle={(e) => e.currentTarget.open && c.page_number && onOpen(c.page_number)}
      className="group rounded-md border border-line paper transition-colors duration-200 open:border-line-strong hover:border-line-strong"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 rounded-md bg-accent/10 px-2 py-1 font-mono text-xs font-medium text-accent-fg">
          {c.clause_identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-base text-fg">{c.title}</span>
        <span className="hidden shrink-0 font-mono text-xs tabular-nums text-subtle sm:inline">
          {c.page_number ? `p.${c.page_number} · ` : ""}
          {c.content.length.toLocaleString()} chars
        </span>
      </summary>
      <p
        className={`border-t border-line px-5 py-4 text-fg-soft ${
          c.clause_identifier === "SIGNATURES"
            ? "overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed"
            : "whitespace-pre-wrap font-display text-lg leading-relaxed"
        }`}
      >
        {c.content}
      </p>
    </details>
  );
}
