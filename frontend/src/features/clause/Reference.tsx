import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ClauseViewer, type ClauseRef } from "./ClausePanel";

interface Ctx { clause: ClauseRef | null; open: (c: ClauseRef) => void; close: () => void }
const Reference = createContext<Ctx>({ clause: null, open: () => {}, close: () => {} });
export const useReference = () => useContext(Reference);

function useMedia(query: string) {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const f = () => setOn(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [query]);
  return on;
}

/** One reference open at a time, anywhere in the app (Search, History). Pages call open(clause); <ReferenceDock /> shows it. */
export function ReferenceProvider({ children }: { children: ReactNode }) {
  const [clause, setClause] = useState<ClauseRef | null>(null);
  const close = useCallback(() => setClause(null), []);
  const value = useMemo(() => ({ clause, open: setClause, close }), [clause, close]);
  return <Reference.Provider value={value}>{children}</Reference.Provider>;
}

/** The open reference, docked beside the page on large screens (the page narrows; nothing is covered, so you can compare it with the
 *  answers on the left). On small screens there is no room beside the page, so it becomes a sheet over it. */
export function ReferenceDock() {
  const { clause: c, close } = useReference();
  const desktop = useMedia("(min-width: 1024px)");
  useEffect(() => {
    if (!c) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [c, close]);
  if (!c) return null;
  const label = `Reference: clause ${c.clause_identifier} ${c.title}`;
  const viewer = <ClauseViewer clause={c} onClose={close} />;
  return desktop ? (
    <aside aria-label={label} className="sticky top-[var(--header-h)] h-[calc(100dvh-var(--header-h))] w-[min(46%,44rem)] shrink-0 self-start border-l border-line bg-surface motion-safe:animate-[pane-in_0.22s_ease-out]">
      {viewer}
    </aside>
  ) : (
    <>
      <div onClick={close} aria-hidden className="fixed inset-0 z-40 bg-black/40" />
      <aside role="dialog" aria-modal="true" aria-label={label} className="fixed inset-x-0 bottom-0 top-[var(--header-h)] z-[41] bg-surface shadow-2xl motion-safe:animate-[pane-in_0.22s_ease-out]">
        {viewer}
      </aside>
    </>
  );
}
