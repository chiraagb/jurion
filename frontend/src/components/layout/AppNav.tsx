import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { ClipboardList, FileText, FlaskConical, Gauge, History, Lightbulb, MessageSquareText, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Link } from "@/lib/router";

interface Item { id: string; label: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
export const NAV: { group: string; items: Item[] }[] = [
  { group: "Work", items: [
    { id: "ask", label: "Ask", Icon: MessageSquareText },
    { id: "search", label: "Search", Icon: Search },
    { id: "contracts", label: "My contracts", Icon: FileText },
    { id: "parser", label: "Parser Lab", Icon: FlaskConical },
  ] },
  { group: "Review", items: [
    { id: "sessions", label: "History", Icon: History },
    { id: "evaluation", label: "Evaluation", Icon: Gauge },
    { id: "problems", label: "Problems & fixes", Icon: Lightbulb },
    { id: "report", label: "Parser report", Icon: ClipboardList },
  ] },
];
export const NAV_LABEL = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])));

const KEY = "jurion.nav.collapsed";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }; // storage can be blocked: never required

/** Large screens: a grouped sidebar (icon + label, collapsible). */
export function Sidebar({ current }: { current: string }) {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  return (
    <aside
      aria-label="Sections"
      className={`sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] shrink-0 flex-col border-r border-line bg-canvas/60 py-4 transition-[width] duration-200 motion-reduce:transition-none lg:flex ${collapsed ? "w-[4.25rem]" : "w-60"}`}
    >
      <nav className="flex-1 space-y-5 overflow-y-auto px-3">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className={`caption mb-2 px-3 ${collapsed ? "sr-only" : ""}`}>{g.group}</p>
            <ul className="space-y-1">
              {g.items.map(({ id, label, Icon }) => {
                const on = current === id;
                return (
                  <li key={id}>
                    <Link
                      to={`/${id}`}
                      aria-current={on ? "page" : undefined}
                      aria-label={collapsed ? label : undefined}
                      title={collapsed ? label : undefined}
                      className={`relative flex h-11 items-center gap-3 rounded-lg px-3 text-[0.95rem] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent ${collapsed ? "justify-center" : ""} ${
                        on ? "bg-accent/10 font-semibold text-fg before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent" : "text-muted hover:bg-raised hover:text-fg"
                      }`}
                    >
                      <Icon className={`h-[1.15rem] w-[1.15rem] shrink-0 ${on ? "text-accent" : ""}`} aria-hidden />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-3">
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className={`flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent ${collapsed ? "justify-center" : ""}`}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <><PanelLeftClose className="h-4 w-4" aria-hidden /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}

/** Small screens: every section as an icon + label pill in a scrolling bar under the header. */
export function MobileNav({ current }: { current: string }) {
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ inline: "center", block: "nearest" }); }, [current]);
  return (
    <nav aria-label="Sections" className="sticky top-[var(--header-h)] z-10 h-[var(--mnav-h)] border-b border-line bg-canvas/90 backdrop-blur lg:hidden">
      <ul className="no-scrollbar flex h-full items-center gap-1.5 overflow-x-auto px-3">
        {NAV.flatMap((g) => g.items).map(({ id, label, Icon }) => {
          const on = current === id;
          return (
            <li key={id} className="shrink-0">
              <Link
                to={`/${id}`}
                ref={on ? active : undefined}
                aria-current={on ? "page" : undefined}
                className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                  on ? "border-accent bg-accent/10 font-semibold text-fg" : "border-transparent text-muted hover:bg-raised hover:text-fg"
                }`}
              >
                <Icon className={`h-4 w-4 ${on ? "text-accent" : ""}`} aria-hidden /> {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
