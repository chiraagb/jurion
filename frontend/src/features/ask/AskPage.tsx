import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as KbEvent, PointerEvent as PtrEvent } from "react";
import { Network, SquarePen } from "lucide-react";
import { ClauseViewer, type ClauseRef } from "@/features/clause/ClausePanel";
import { Link, navigate } from "@/lib/router";
import { AnswerCard, Trace, type Attempt } from "./AnswerCard";
import Composer from "./Composer";
import { ask, type AskEvent, type Brief } from "./api";

type Stage = "search" | "grade" | "rewrite" | "write";
interface Turn { id: number; question: string; attempts: Attempt[]; sources: Brief[]; answer: string; stage: Stage | null; error: string | null; saved: string | null; stopped?: boolean }

const STAGE: Record<Stage, string> = {
  search: "Finding the right contract and clauses…",
  grade: "Checking which clauses really answer it…",
  rewrite: "Nothing fit yet, rewording the question…",
  write: "Writing the answer from the references…",
};
const EXAMPLES = ["Who can terminate, and with how much notice?", "What are the payment terms?", "Which law governs the agreement?", "What does the bank owe if it ends the contract early?"];
const FRAC_KEY = "jurion.pane.frac"; // how much of the screen the reference pane takes
const MIN_FRAC = 0.3, MAX_FRAC = 0.82;
const readFrac = () => { try { const f = Number(localStorage.getItem(FRAC_KEY)); return f >= MIN_FRAC && f <= MAX_FRAC ? f : 0.6; } catch { return 0.6; } }; // storage can be blocked: never required
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A chat with your contracts. The newest question sits at the top of the view with its answer growing beneath it;
 *  a reference opens beside the answer (docked on wide screens, a sheet on narrow ones). Stays mounted while you visit other tabs. */
export default function AskPage({ q: urlQuestion, active }: { q: string; active: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState<{ turn: number; index: number } | null>(null); // the reference shown beside the answer
  const [vh, setVh] = useState(0);
  const [frac, setFrac] = useState(readFrac);
  const [wide, setWide] = useState(false);
  const row = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const questions = useRef(new Map<number, HTMLElement>());
  const ctl = useRef<AbortController | null>(null);
  const next = useRef(1);
  const last = turns.at(-1);
  const busy = !!last?.stage;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVh(el.clientHeight)); // the newest turn is this tall, so its question can always reach the top
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const patch = useCallback((id: number, f: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? f(t) : t))), []);

  const send = useCallback((question: string) => {
    const id = next.current++;
    const c = new AbortController();
    ctl.current = c;
    setOpen(null);
    setTurns((all) => [...all, { id, question, attempts: [], sources: [], answer: "", stage: "search", error: null, saved: null }]);
    const on = (e: AskEvent) => patch(id, (t) => {
      switch (e.event) {
        case "retrieved": return { ...t, stage: "grade", attempts: [...t.attempts, { query: e.query, mode: e.mode, note: e.note, scope: e.scope, hits: e.hits, relevant: null }] };
        case "graded": return { ...t, attempts: t.attempts.map((a, i) => (i === t.attempts.length - 1 ? { ...a, relevant: e.relevant } : a)) };
        case "rewritten": return { ...t, stage: "rewrite" };
        case "sources": return { ...t, sources: e.sources };
        case "token": return { ...t, stage: "write", answer: t.answer + e.text };
        case "done": return { ...t, stage: null, saved: e.session_id };
        case "error": return { ...t, stage: null, error: e.detail };
      }
    });
    ask(question, on, c.signal).catch((err) => {
      patch(id, (t) => (c.signal.aborted ? { ...t, stage: null, stopped: true } : { ...t, stage: null, error: err.message }));
    });
  }, [patch]);

  // A new question scrolls to the TOP of the thread, so attention is on it and the answer fills in below.
  useEffect(() => {
    const t = turns.at(-1);
    const el = t && questions.current.get(t.id);
    const box = scroller.current;
    if (!el || !box) return;
    box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16, behavior: reduced() ? "auto" : "smooth" });
  }, [turns.length]);

  // /ask?q=... (from a link): ask it once, then clear the address so a reload does not ask again.
  const asked = useRef(""); // dev mode runs effects twice: remember what this address already asked
  useEffect(() => {
    if (!urlQuestion) asked.current = "";
    else if (active && asked.current !== urlQuestion && urlQuestion.trim().length >= 3) {
      asked.current = urlQuestion;
      send(urlQuestion.trim());
      navigate("/ask", true);
    }
  }, [active, urlQuestion, send]);

  const stop = () => ctl.current?.abort();
  const fresh = () => { ctl.current?.abort(); setTurns([]); setOpen(null); };

  const current = open ? turns.find((t) => t.id === open.turn)?.sources[open.index] : undefined;
  const sources = open ? turns.find((t) => t.id === open.turn)?.sources ?? [] : [];
  const step = (d: number) => open && setOpen({ ...open, index: (open.index + d + sources.length) % sources.length });
  const share = wide ? 1 : frac; // wide: the reference fills the whole area and the chat steps aside (a reading mode)
  const save = (f: number) => { try { localStorage.setItem(FRAC_KEY, String(f)); } catch { /* ignore */ } };
  const drag = (e: PtrEvent<HTMLDivElement>) => {
    if (!dragging.current || !row.current) return;
    const box = row.current.getBoundingClientRect();
    setWide(false);
    setFrac(Math.min(MAX_FRAC, Math.max(MIN_FRAC, (box.right - e.clientX) / box.width)));
  };
  const nudge = (e: KbEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? 0.03 : e.key === "ArrowRight" ? -0.03 : 0;
    if (!d) return;
    e.preventDefault();
    const f = Math.min(MAX_FRAC, Math.max(MIN_FRAC, share + d));
    setWide(false); setFrac(f); save(f);
  };
  const pick = (turn: number) => (_: ClauseRef, index: number) => setOpen({ turn, index });

  return (
    <section ref={row} aria-label="Ask your contracts" className="flex h-[calc(100dvh-var(--header-h)-var(--mnav-h))] min-h-0">
      <div className={`min-w-0 flex-1 flex-col lg:min-w-[20rem] ${wide ? "hidden" : "flex"}`}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <h1 className="font-display text-lg font-semibold">Ask your contracts</h1>
          {turns.length > 0 && (
            <button onClick={fresh} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
              <SquarePen className="h-4 w-4" aria-hidden /> New chat
            </button>
          )}
        </div>

        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" role="region" aria-label="Conversation" tabIndex={-1}>
          <div className="mx-auto max-w-3xl px-4 pb-8">
            {turns.length === 0 ? (
              <div className="grid min-h-[min(34rem,70vh)] place-items-center py-10 text-center">
                <div className="animate-rise">
                  <p className="caption mb-3">Answers you can check</p>
                  <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">What do you want to know?</h2>
                  <p className="mx-auto mt-4 max-w-xl text-fg-soft">Ask in your own words. Every claim in the answer links to the exact clause and PDF page it came from, shown beside the answer.</p>
                  <div className="mx-auto mt-7 flex max-w-2xl flex-wrap justify-center gap-2">
                    {EXAMPLES.map((x) => (
                      <button key={x} onClick={() => send(x)} className="min-h-11 cursor-pointer rounded-full border border-line-strong bg-surface px-4 py-2 text-sm text-fg-soft transition-colors hover:border-accent hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
                        {x}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              turns.map((t, i) => (
                <article key={t.id} aria-label={`Question ${i + 1}`} style={i === turns.length - 1 && vh ? { minHeight: vh - 8 } : undefined} className={`pt-8 ${i > 0 ? "mt-8 border-t border-line" : ""}`}>
                  <header ref={(el) => { if (el) questions.current.set(t.id, el); else questions.current.delete(t.id); }} className="scroll-mt-4">
                    <p className="caption mb-2">You asked</p>
                    <h2 className="font-display text-2xl font-semibold leading-snug sm:text-[1.75rem] [overflow-wrap:anywhere]">{t.question}</h2>
                  </header>

                  <div className="mt-6 space-y-4">
                    {t.stage && (
                      <p role="status" className="flex items-center gap-3 text-sm text-muted">
                        <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((d) => <span key={d} style={{ animationDelay: `${d * 160}ms` }} className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-[dot_1.2s_ease-in-out_infinite]" />)}</span>
                        {STAGE[t.stage]}
                      </p>
                    )}
                    {t.error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{t.error}</p>}
                    {t.stopped && <p className="text-sm text-muted">Stopped.</p>}
                    {(t.answer || t.sources.length > 0) && (
                      <AnswerCard
                        answer={t.answer}
                        sources={t.sources}
                        streaming={t.stage === "write"}
                        scope={t.attempts[0]?.scope}
                        selected={open?.turn === t.id ? open.index : null}
                        onPick={pick(t.id)}
                      />
                    )}
                    {t.attempts.length > 0 && <Trace attempts={t.attempts} sources={t.sources} onPick={(c) => { const x = t.sources.findIndex((s) => s.document_id === c.document_id && s.position === c.position); x >= 0 && setOpen({ turn: t.id, index: x }); }} />}
                    {t.saved && !t.stage && (
                      <p className="flex items-center gap-1.5 text-xs text-subtle">
                        <Network className="h-3.5 w-3.5" aria-hidden /> Saved to <Link to={`/sessions/${t.saved}`} className="underline hover:text-fg">History</Link> where you can compare it with other questions.
                      </p>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        <Composer busy={busy} onSend={send} onStop={stop} focusKey={active} />
      </div>

      {current && open && !wide && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the reference pane"
          aria-valuemin={Math.round(MIN_FRAC * 100)}
          aria-valuemax={Math.round(MAX_FRAC * 100)}
          aria-valuenow={Math.round(share * 100)}
          tabIndex={0}
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={drag}
          onPointerUp={() => { dragging.current = false; save(frac); }}
          onKeyDown={nudge}
          className="group relative hidden w-2 shrink-0 cursor-col-resize touch-none select-none lg:block focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" />
        </div>
      )}
      {current && open && (
        <aside
          aria-label={`Reference ${open.index + 1}: clause ${current.clause_identifier}`}
          className="fixed inset-x-0 bottom-0 top-[var(--header-h)] z-30 bg-surface shadow-2xl motion-safe:animate-[pane-in_0.22s_ease-out] lg:static lg:inset-auto lg:z-auto lg:w-[var(--pane)] lg:max-w-[var(--pane-max)] lg:shrink-0 lg:shadow-none"
          style={{ "--pane": `${share * 100}%`, "--pane-max": wide ? "100%" : "calc(100% - 20.5rem)" } as CSSProperties}
        >
          <ClauseViewer clause={current} expanded={wide} onExpand={() => setWide((w) => !w)} onClose={() => setOpen(null)} nav={{ index: open.index, total: sources.length, onPrev: () => step(-1), onNext: () => step(1) }} />
        </aside>
      )}
    </section>
  );
}
