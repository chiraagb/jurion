import { Fragment, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  History,
  Lightbulb,
  MessageSquareText,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { Link } from "@/lib/router";
import SessionList from "@/features/sessions/SessionList";

interface Item {
  id: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}
export const NAV: { group: string; items: Item[] }[] = [
  {
    group: "Work",
    items: [
      { id: "ask", label: "Ask", Icon: MessageSquareText },
      { id: "search", label: "Search", Icon: Search },
      { id: "contracts", label: "My contracts", Icon: FileText },
      { id: "graph", label: "Graph", Icon: Network },
      { id: "parser", label: "Parser Lab", Icon: FlaskConical },
    ],
  },
  {
    group: "Review",
    items: [
      { id: "evaluation", label: "Evaluation", Icon: Gauge },
      { id: "problems", label: "Problems & fixes", Icon: Lightbulb },
      { id: "report", label: "Parser report", Icon: ClipboardList },
    ],
  },
];
export const NAV_LABEL: Record<string, string> = {
  ...Object.fromEntries(
    NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])),
  ),
  sessions: "Sessions",
}; // sessions have no row of their own: they are listed in the sidebar

const KEY = "jurion.nav.collapsed";
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}; // storage can be blocked: never required

/** Large screens: a grouped sidebar (icon + label, collapsible). */
export function Sidebar({ current }: { current: string }) {
  const [collapsed, setCollapsed] = useState(read);
  const [tip, setTip] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null); // fixed, because the nav clips anything that sticks out of it
  const point = (e: { target: EventTarget }) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    const r = el?.getBoundingClientRect();
    setTip(
      el && r
        ? {
            text: el.dataset.tip!,
            top: r.top + r.height / 2,
            left: r.right + 10,
          }
        : null,
    );
  };
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  return (
    <aside
      aria-label="Sections"
      onMouseOver={point}
      onFocus={point}
      onMouseLeave={() => setTip(null)}
      onBlur={() => setTip(null)}
      className={`sticky top-(--header-h) z-20 hidden h-[calc(100dvh-var(--header-h))] shrink-0 flex-col border-r border-line bg-canvas/60 py-4 overflow-x-hidden transition-[width] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex ${collapsed ? "w-17" : "w-60"}`}
    >
      <nav className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3">
        {NAV.map((g) => (
          <Fragment key={g.group}>
            <div>
              <p
                aria-hidden={collapsed}
                className={`caption overflow-hidden whitespace-nowrap px-3 transition-[max-height,margin,opacity] duration-300 ease-out ${collapsed ? "mb-0 max-h-0 opacity-0" : "mb-2 max-h-6 opacity-100"}`}
              >
                {g.group}
              </p>
              <ul className="space-y-1">
                {g.items.map(({ id, label, Icon }) => {
                  const on = current === id;
                  return (
                    <li key={id}>
                      <Link
                        to={`/${id}`}
                        aria-current={on ? "page" : undefined}
                        aria-label={collapsed ? label : undefined}
                        data-tip={collapsed ? label : undefined}
                        className={`relative flex h-11 items-center rounded-lg px-3 text-[0.95rem] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${
                          on
                            ? "bg-accent/10 font-semibold text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-full before:bg-accent"
                            : "text-muted hover:bg-raised hover:text-fg"
                        }`}
                      >
                        <Icon
                          className={`h-[1.15rem] w-[1.15rem] shrink-0 ${on ? "text-accent" : ""}`}
                          aria-hidden
                        />
                        <span
                          aria-hidden={collapsed}
                          className={`overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-300 ease-out ${collapsed ? "ml-0 max-w-0 opacity-0" : "ml-3 max-w-44 opacity-100 delay-100"}`}
                        >
                          {label}
                        </span>
                      </Link>
                      {id === "ask" && <SessionList collapsed={collapsed} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Fragment>
        ))}
      </nav>
      <div className="px-3">
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          data-tip={collapsed ? "Expand navigation" : undefined}
          className={`flex h-10 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent`}
        >
          {collapsed ? (
            <PanelLeftOpen
              className="h-[1.15rem] w-[1.15rem] shrink-0"
              aria-hidden
            />
          ) : (
            <PanelLeftClose
              className="h-[1.15rem] w-[1.15rem] shrink-0"
              aria-hidden
            />
          )}
          <span
            aria-hidden
            className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out ${collapsed ? "max-w-0 opacity-0" : "max-w-32 opacity-100 delay-100"}`}
          >
            Collapse
          </span>
        </button>
      </div>
      {tip && collapsed && (
        <div
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-40 -translate-y-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg shadow-lg motion-safe:animate-[rise_0.12s_ease-out]"
        >
          {tip.text}
        </div>
      )}
    </aside>
  );
}

/** Small screens: every section as an icon + label pill in a scrolling bar under the header. */
export function MobileNav({ current }: { current: string }) {
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current]);
  return (
    <nav
      aria-label="Sections"
      className="sticky top-(--header-h) z-10 h-(--mnav-h) border-b border-line bg-canvas/90 backdrop-blur lg:hidden"
    >
      <ul className="no-scrollbar flex h-full items-center gap-1.5 overflow-x-auto px-3">
        {[
          ...NAV.flatMap((g) => g.items),
          { id: "sessions", label: "Sessions", Icon: History },
        ].map(({ id, label, Icon }) => {
          const on = current === id;
          return (
            <li key={id} className="shrink-0">
              <Link
                to={`/${id}`}
                ref={on ? active : undefined}
                aria-current={on ? "page" : undefined}
                className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                  on
                    ? "border-accent bg-accent/10 font-semibold text-fg"
                    : "border-transparent text-muted hover:bg-raised hover:text-fg"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${on ? "text-accent" : ""}`}
                  aria-hidden
                />{" "}
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
