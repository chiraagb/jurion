import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as KbEvent,
  PointerEvent as PtrEvent,
} from "react";
import { SquarePen } from "lucide-react";
import { ClauseViewer, type ClauseRef } from "@/features/clause/ClausePanel";
import { navigate } from "@/lib/router";
import { sessionsChanged } from "@/features/sessions/SessionList";
import { AnswerCard, Trace, type Attempt } from "./AnswerCard";
import AgentTrace from "./agent/AgentTrace";
import CompareCard, {
  StatsBadge,
  emptySide,
  type Cmp,
  type Side,
} from "./agent/CompareCard";
import Composer from "./Composer";
import Thinking, { type Stage } from "./Thinking";
import GettingStarted from "@/features/onboarding/GettingStarted";
import { useSetup } from "@/features/onboarding/useSetup";
import {
  ask,
  askCompare,
  getModels,
  type AgentStep,
  type AskEvent,
  type AskExtra,
  type AskMode,
  type Brief,
  type CompareEvent,
  type Models,
  type Stats,
} from "./api";
import { getSession, type StoredTurn } from "@/features/sessions/api";

interface Turn {
  id: number;
  question: string;
  attempts: Attempt[];
  sources: Brief[];
  answer: string;
  facts?: string;
  followups?: string[];
  clarify?: { id: string; filename: string; summary: string }[];
  stage: Stage | null;
  error: string | null;
  saved: string | null;
  stopped?: boolean;
  mode?: AskMode;
  steps?: AgentStep[];
  stats?: Stats;
  fallback?: string;
  budget?: { hit: string } | null;
  cmp?: Cmp;
}

const EXAMPLES = [
  "Who can terminate, and with how much notice?",
  "What are the payment terms?",
  "Which law governs the agreement?",
  "What does the bank owe if it ends the contract early?",
];
const FRAC_KEY = "jurion.pane.frac"; // how much of the screen the reference pane takes
const MIN_FRAC = 0.3,
  MAX_FRAC = 0.82;
const MODE_KEY = "jurion.ask.mode",
  MODEL_KEY = "jurion.ask.model";
const readPref = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}; // storage can be blocked: never required
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

/** Folds one event into one side of a comparison (the same events as a normal answer). */
function sideOf(s: Side, e: AskEvent): Side {
  switch (e.event) {
    case "step":
      return { ...s, stage: "act", steps: [...s.steps, e] };
    case "retrieved":
      return { ...s, stage: "grade" };
    case "sources":
      return { ...s, sources: e.sources };
    case "token":
      return { ...s, stage: "write", answer: s.answer + e.text };
    case "stats":
      return { ...s, stats: e, stage: null }; // a comparison side sends no `done`: its stats are the last thing it sends
    case "fallback":
      return { ...s, fallback: e.reason };
    case "budget":
      return { ...s, budget: { hit: e.hit } };
    case "done":
      return { ...s, stage: null };
    case "error":
      return { ...s, stage: null, error: e.detail };
    default:
      return s;
  }
}
const readFrac = () => {
  try {
    const f = Number(localStorage.getItem(FRAC_KEY));
    return f >= MIN_FRAC && f <= MAX_FRAC ? f : 0.6;
  } catch {
    return 0.6;
  }
}; // storage can be blocked: never required
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A chat with your contracts. The newest question sits at the top of the view with its answer growing beneath it;
 *  a reference opens beside the answer (docked on wide screens, a sheet on narrow ones). Stays mounted while you visit other tabs. */
export default function AskPage({
  q: urlQuestion,
  session: urlSession,
  active,
}: {
  q: string;
  session: string;
  active: boolean;
}) {
  const setup = useSetup(active); // re-checked whenever the Ask tab is shown again
  const notReady =
    !setup.loading && !setup.failed && (setup.contracts === 0 || !setup.hasKey);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState<{
    turn: number;
    index: number;
    side?: AskMode;
  } | null>(null); // the reference shown beside the answer (side: which answer of a comparison)
  const [models, setModels] = useState<Models | null>(null);
  const [mode, setMode] = useState<AskMode>(() =>
    readPref(MODE_KEY) === "workflow" ? "workflow" : "agent",
  );
  const [compare, setCompare] = useState(false);
  const [model, setModel] = useState(() => readPref(MODEL_KEY) ?? "");
  useEffect(() => {
    getModels()
      .then((m) => {
        setModels(m);
        setModel((cur) =>
          m.models.some((x) => x.id === cur && x.available)
            ? cur
            : (m.models.find((x) => x.id === m.default && x.available)?.id ??
              m.default),
        );
        if (!readPref(MODE_KEY)) setMode(m.default_mode);
      })
      .catch(() => {});
  }, []);
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

  const patch = useCallback(
    (id: number, f: (t: Turn) => Turn) =>
      setTurns((all) => all.map((t) => (t.id === id ? f(t) : t))),
    [],
  );

  const [fresher, setFresher] = useState(0); // counts new sessions: each one puts the cursor in the message box
  const session = useRef<string | null>(null); // this chat's id once its first answer is saved: the server remembers the chat under it
  const [usage, setUsage] = useState<{
    used: number;
    limit: number;
    full: boolean;
  } | null>(null); // how much of the session's context budget is used
  const recent = useRef<string[]>([]); // the last questions, sent along so "these two contracts" can be resolved
  const send = useCallback(
    (question: string, extra: AskExtra = {}) => {
      const id = next.current++;
      const before = recent.current.slice(-2);
      recent.current.push(question);
      const c = new AbortController();
      ctl.current = c;
      setOpen(null);
      setTurns((all) => [
        ...all,
        {
          id,
          question,
          attempts: [],
          sources: [],
          answer: "",
          stage: "search",
          error: null,
          saved: null,
          mode: compare ? undefined : mode,
          ...(compare
            ? { cmp: { workflow: emptySide(), agent: emptySide() } }
            : {}),
        },
      ]);
      if (compare) {
        // both at once; shown side by side, not saved to the chat
        const onCmp = (e: CompareEvent) =>
          patch(id, (t) => {
            if (!t.cmp) return t;
            if (e.event === "compared") {
              if (e.session_id) queueMicrotask(sessionsChanged);
              return {
                ...t,
                stage: null,
                cmp: {
                  workflow: { ...t.cmp.workflow, stage: null },
                  agent: { ...t.cmp.agent, stage: null },
                  compared: e,
                },
              };
            } // saved as a Compare session: refresh the list
            return e.system
              ? {
                  ...t,
                  cmp: {
                    ...t.cmp,
                    [e.system]: sideOf(t.cmp[e.system], e as AskEvent),
                  },
                }
              : t;
          });
        askCompare(question, { model }, onCmp, c.signal).catch((err) =>
          patch(id, (t) =>
            c.signal.aborted
              ? { ...t, stage: null, stopped: true }
              : { ...t, stage: null, error: err.message },
          ),
        );
        return;
      }
      const on = (e: AskEvent) => {
        if (e.event === "context")
          setUsage((u) => ({
            used: e.used,
            limit: e.limit,
            full: u?.full ?? false,
          }));
        // while it answers: what is being sent
        else if (e.event === "full")
          setUsage({ used: e.used, limit: e.limit, full: true });
        else if (e.event === "done") {
          setUsage({ used: e.used, limit: e.limit, full: e.full });
          if (e.session_id) {
            session.current = e.session_id;
            if (location.pathname === "/ask")
              navigate(`/ask?s=${e.session_id}`, true); // the chat has an address: reload and the sidebar both find it
            sessionsChanged();
          }
        }
        patch(id, (t) => turn(t, e));
      };
      const turn = (t: Turn, e: AskEvent): Turn => {
        switch (e.event) {
          case "retrieved":
            return {
              ...t,
              stage: "grade",
              attempts: [
                ...t.attempts,
                {
                  query: e.query,
                  mode: e.mode,
                  note: e.note,
                  scope: e.scope,
                  contracts: e.contracts,
                  scope_reason: e.scope_reason,
                  hits: e.hits,
                  relevant: null,
                },
              ],
            };
          case "graded":
            return {
              ...t,
              attempts: t.attempts.map((a, i) =>
                i === t.attempts.length - 1
                  ? { ...a, relevant: e.relevant, reasons: e.reasons }
                  : a,
              ),
            };
          case "rewritten":
            return { ...t, stage: "rewrite" };
          case "step":
            return { ...t, stage: "act", steps: [...(t.steps ?? []), e] };
          case "fallback":
            return { ...t, fallback: e.reason, mode: "workflow" };
          case "budget":
            return { ...t, budget: { hit: e.hit } };
          case "stats":
            return { ...t, stats: e };
          case "clarify":
            return { ...t, clarify: e.options };
          case "context":
            return t;
          case "full":
            return { ...t, stage: null };
          case "followups":
            return { ...t, followups: e.questions };
          case "facts":
            return { ...t, facts: e.text };
          case "sources":
            return { ...t, sources: e.sources };
          case "token":
            return { ...t, stage: "write", answer: t.answer + e.text };
          case "done":
            return { ...t, stage: null, saved: e.session_id };
          case "error":
            return { ...t, stage: null, error: e.detail };
        }
      };
      ask(
        question,
        before,
        {
          sessionId: session.current,
          mode,
          model: mode === "agent" ? model || undefined : undefined,
          ...extra,
        },
        on,
        c.signal,
      ).catch((err) => {
        patch(id, (t) =>
          c.signal.aborted
            ? { ...t, stage: null, stopped: true }
            : { ...t, stage: null, error: err.message },
        );
      });
    },
    [patch, mode, model, compare],
  );

  // A new question scrolls to the TOP of the thread, so attention is on it and the answer fills in below.
  useEffect(() => {
    const t = turns.at(-1);
    const el = t && questions.current.get(t.id);
    const box = scroller.current;
    if (!el || !box) return;
    box.scrollTo({
      top:
        el.getBoundingClientRect().top -
        box.getBoundingClientRect().top +
        box.scrollTop -
        16,
      behavior: reduced() ? "auto" : "smooth",
    });
  }, [turns.length]);

  // /ask?q=... (from a link): ask it once, then clear the address so a reload does not ask again.
  const asked = useRef(""); // dev mode runs effects twice: remember what this address already asked
  useEffect(() => {
    if (!urlQuestion) asked.current = "";
    else if (
      active &&
      asked.current !== urlQuestion &&
      urlQuestion.trim().length >= 3
    ) {
      asked.current = urlQuestion;
      send(urlQuestion.trim());
      navigate(session.current ? `/ask?s=${session.current}` : "/ask", true);
    }
  }, [active, urlQuestion, send]);

  // /ask?s=<id> (from Sessions): load that chat and carry on in it.
  useEffect(() => {
    if (!active || !urlSession || session.current === urlSession) return;
    session.current = urlSession;
    getSession(urlSession)
      .then((s) => {
        const stored = (s.data as { turns: StoredTurn[] }).turns;
        setTurns(
          stored.map((t, i) => ({
            id: next.current++,
            question: t.question,
            attempts: t.attempts,
            sources: t.sources,
            answer: t.answer,
            facts: t.facts,
            mode: t.mode ?? "workflow",
            steps: t.steps,
            stats: t.stats,
            fallback: t.fallback,
            budget: t.budget,
            followups: i === stored.length - 1 ? t.followups : undefined,
            clarify:
              t.clarify && i === stored.length - 1
                ? (t.clarify_options ?? undefined)
                : undefined,
            stage: null,
            error: null,
            saved: s.id,
          })),
        );
        recent.current = stored.map((t) => t.question);
        setUsage({
          used: s.used ?? 0,
          limit: s.limit ?? 0,
          full: !!(s as { full?: boolean }).full,
        });
        setOpen(null);
      })
      .catch(() => {
        session.current = null;
        navigate("/ask", true);
      });
  }, [active, urlSession]);

  const stop = () => ctl.current?.abort();
  const fresh = () => {
    setFresher((n) => n + 1);
    ctl.current?.abort();
    session.current = null;
    recent.current = [];
    setUsage(null);
    setTurns([]);
    setOpen(null);
    if (location.pathname === "/ask") navigate("/ask", true);
  };
  useEffect(() => {
    // "New session" in the sidebar
    addEventListener("jurion:new-session", fresh);
    return () => removeEventListener("jurion:new-session", fresh);
  });
  // The Ask tab was reopened without ?s: the chat in progress keeps its address.
  useEffect(() => {
    if (active && !urlSession && !urlQuestion && session.current)
      navigate(`/ask?s=${session.current}`, true);
  }, [active, urlSession, urlQuestion]);

  const sourcesOf = (t?: Turn, side?: AskMode) =>
    (side && t?.cmp ? t.cmp[side].sources : t?.sources) ?? [];
  const sources = open
    ? sourcesOf(
        turns.find((t) => t.id === open.turn),
        open.side,
      )
    : [];
  const current = open ? sources[open.index] : undefined;
  const step = (d: number) =>
    open &&
    setOpen({
      ...open,
      index: (open.index + d + sources.length) % sources.length,
    });
  const share = wide ? 1 : frac; // wide: the reference fills the whole area and the chat steps aside (a reading mode)
  const save = (f: number) => {
    try {
      localStorage.setItem(FRAC_KEY, String(f));
    } catch {
      /* ignore */
    }
  };
  const drag = (e: PtrEvent<HTMLDivElement>) => {
    if (!dragging.current || !row.current) return;
    const box = row.current.getBoundingClientRect();
    setWide(false);
    setFrac(
      Math.min(
        MAX_FRAC,
        Math.max(MIN_FRAC, (box.right - e.clientX) / box.width),
      ),
    );
  };
  const nudge = (e: KbEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? 0.03 : e.key === "ArrowRight" ? -0.03 : 0;
    if (!d) return;
    e.preventDefault();
    const f = Math.min(MAX_FRAC, Math.max(MIN_FRAC, share + d));
    setWide(false);
    setFrac(f);
    save(f);
  };
  const pick = (turn: number) => (_: ClauseRef, index: number) =>
    setOpen({ turn, index });
  const pickSide =
    (turn: number) => (side: AskMode, _: ClauseRef, index: number) =>
      setOpen({ turn, index, side });

  return (
    <section
      ref={row}
      aria-label="Ask your contracts"
      className="flex h-[calc(100dvh-var(--header-h)-var(--mnav-h))] min-h-0"
    >
      <div
        className={`min-w-0 flex-1 flex-col lg:min-w-[20rem] ${wide ? "hidden" : "flex"}`}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
          <h1 className="font-display text-lg font-semibold">
            Ask your contracts
          </h1>
          <div className="flex items-center gap-3">
            {turns.length > 0 && (
              <button
                onClick={fresh}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                <SquarePen className="h-4 w-4" aria-hidden /> New session
              </button>
            )}
          </div>
        </div>

        <div
          ref={scroller}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
          role="region"
          aria-label="Conversation"
          tabIndex={-1}
        >
          <div className="mx-auto max-w-3xl px-4 pb-8">
            {turns.length === 0 && setup.loading ? (
              <p
                className="grid min-h-[min(34rem,70vh)] place-items-center text-muted"
                aria-busy
              >
                Checking your library…
              </p>
            ) : turns.length === 0 && notReady ? (
              <GettingStarted setup={setup} />
            ) : turns.length === 0 ? (
              <div className="grid min-h-[min(34rem,70vh)] place-items-center py-10 text-center">
                <div className="animate-rise">
                  <p className="caption mb-3">Answers you can check</p>
                  <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                    What do you want to know?
                  </h2>
                  <p className="mx-auto mt-4 max-w-xl text-fg-soft">
                    Ask in your own words. Every claim in the answer links to
                    the exact clause and PDF page it came from, shown beside the
                    answer.
                  </p>
                  <div className="mx-auto mt-7 flex max-w-2xl flex-wrap justify-center gap-2">
                    {EXAMPLES.map((x) => (
                      <button
                        key={x}
                        onClick={() => send(x)}
                        className="min-h-11 cursor-pointer rounded-full border border-line-strong bg-surface px-4 py-2 text-sm text-fg-soft transition-colors hover:border-accent hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {x}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              turns.map((t, i) => (
                <article
                  key={t.id}
                  aria-label={`Question ${i + 1}`}
                  style={
                    i === turns.length - 1 && vh
                      ? { minHeight: vh - 8 }
                      : undefined
                  }
                  className={`pt-8 ${i > 0 ? "mt-8 border-t border-line" : ""}`}
                >
                  <header
                    ref={(el) => {
                      if (el) questions.current.set(t.id, el);
                      else questions.current.delete(t.id);
                    }}
                    className="scroll-mt-4"
                  >
                    <p className="caption mb-2">You asked</p>
                    <h2 className="font-display text-2xl font-semibold leading-snug sm:text-[1.75rem] wrap-anywhere">
                      {t.question}
                    </h2>
                  </header>

                  <div className="mt-6 space-y-4">
                    {t.cmp && (
                      <CompareCard cmp={t.cmp} onPick={pickSide(t.id)} />
                    )}
                    {!t.cmp && t.stage && !t.answer && (
                      <Thinking stage={t.stage} />
                    )}
                    {t.error && (
                      <p
                        role="alert"
                        className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
                      >
                        {t.error}
                      </p>
                    )}
                    {t.stopped && (
                      <p className="text-sm text-muted">Stopped.</p>
                    )}
                    {!t.cmp &&
                      (t.answer || (!t.stage && t.sources.length > 0)) && (
                        <AnswerCard
                          answer={t.answer}
                          sources={t.sources}
                          streaming={t.stage === "write"}
                          scope={t.attempts[0]?.scope}
                          selected={open?.turn === t.id ? open.index : null}
                          onPick={pick(t.id)}
                        />
                      )}
                    {!t.cmp && t.stats && !t.stage && (
                      <StatsBadge stats={t.stats} fallback={t.fallback} />
                    )}
                    {t.facts && (
                      <details className="mt-3 rounded-md border border-line bg-surface text-sm">
                        <summary className="cursor-pointer px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-accent">
                          Used the contract graph{" "}
                          <span className="font-normal text-muted">
                            · what it knew about the companies named
                          </span>
                        </summary>
                        <p className="whitespace-pre-wrap border-t border-line px-4 py-3 text-fg-soft">
                          {t.facts}
                        </p>
                      </details>
                    )}
                    {t.clarify && t.id === last?.id && !busy && (
                      <div
                        className="mt-3"
                        role="group"
                        aria-label="Which contract do you mean?"
                      >
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                          Which contract?
                        </p>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {t.clarify.map((o) => (
                            <li key={o.id}>
                              <button
                                onClick={() =>
                                  send(t.question, { only: [o.id] })
                                }
                                className="h-full w-full cursor-pointer rounded-md border border-line-strong bg-surface px-4 py-3 text-left text-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                              >
                                <span className="block font-semibold wrap-anywhere">
                                  {o.filename.replace(/\.pdf$/i, "")}
                                </span>
                                {o.summary && (
                                  <span className="mt-0.5 line-clamp-2 text-muted">
                                    {o.summary}
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => send(t.question, { anywhere: true })}
                          className="mt-2 h-10 cursor-pointer rounded-full border border-line-strong px-4 text-sm text-fg-soft hover:border-accent hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          Search all contracts
                        </button>
                      </div>
                    )}
                    {t.followups && t.id === last?.id && !busy && (
                      <div
                        className="mt-3"
                        role="group"
                        aria-label="Suggested follow-up questions"
                      >
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                          Ask next
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {t.followups.map((f) => (
                            <button
                              key={f}
                              onClick={() => send(f)}
                              className="min-h-10 cursor-pointer rounded-full border border-line-strong bg-surface px-4 py-2 text-left text-sm text-fg-soft transition-colors hover:border-accent hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {t.steps && t.steps.length > 0 && (
                      <AgentTrace
                        steps={t.steps}
                        budget={t.budget}
                        live={!!t.stage}
                        onPick={(c) => {
                          const x = t.sources.findIndex(
                            (s) =>
                              s.document_id === c.document_id &&
                              s.position === c.position,
                          );
                          x >= 0 && setOpen({ turn: t.id, index: x });
                        }}
                      />
                    )}
                    {t.attempts.length > 0 && (
                      <Trace
                        attempts={t.attempts}
                        sources={t.sources}
                        onPick={(c) => {
                          const x = t.sources.findIndex(
                            (s) =>
                              s.document_id === c.document_id &&
                              s.position === c.position,
                          );
                          x >= 0 && setOpen({ turn: t.id, index: x });
                        }}
                      />
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        {usage?.full && !busy && (
          <p
            role="status"
            className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-2 text-sm text-fg-soft"
          >
            <span>
              This session is full. Long sessions make answers less accurate, so
              start a new one.
            </span>
            <button
              onClick={fresh}
              className="h-10 cursor-pointer rounded-lg bg-accent px-4 font-medium text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              New session
            </button>
          </p>
        )}
        <Composer
          usage={turns.length > 0 ? usage : null}
          busy={busy}
          onSend={send}
          onStop={stop}
          focusKey={`${active}-${fresher}`}
          controls={{
            mode,
            onMode: (m) => {
              setMode(m);
              writePref(MODE_KEY, m);
            },
            compare,
            onCompare: setCompare,
            models,
            model,
            onModel: (m) => {
              setModel(m);
              writePref(MODEL_KEY, m);
            },
          }}
          disabledReason={
            notReady
              ? "Finish the steps above to start asking"
              : usage?.full
                ? "This session is full. Start a new session to keep asking."
                : undefined
          }
        />
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
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={drag}
          onPointerUp={() => {
            dragging.current = false;
            save(frac);
          }}
          onKeyDown={nudge}
          className="group relative hidden w-2 shrink-0 cursor-col-resize touch-none select-none lg:block focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent" />
        </div>
      )}
      {current && open && (
        <aside
          aria-label={`Reference ${open.index + 1}: clause ${current.clause_identifier}`}
          className="fixed inset-x-0 bottom-0 top-(--heasder-h) z-30 bg-surface shadow-2xl motion-safe:animate-[pane-in_0.22s_ease-out] lg:static lg:inset-auto lg:z-auto lg:w-(--pane) lg:max-w-(--pane-max) lg:shrink-0 lg:shadow-none"
          style={
            {
              "--pane": `${share * 100}%`,
              "--pane-max": wide ? "100%" : "calc(100% - 20.5rem)",
            } as CSSProperties
          }
        >
          <ClauseViewer
            clause={current}
            expanded={wide}
            onExpand={() => setWide((w) => !w)}
            onClose={() => setOpen(null)}
            nav={{
              index: open.index,
              total: sources.length,
              onPrev: () => step(-1),
              onNext: () => step(1),
            }}
          />
        </aside>
      )}
    </section>
  );
}
