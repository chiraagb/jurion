import { useEffect, useState } from "react";
import { Columns2, MessageSquareText, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useReference } from "@/features/clause/Reference";
import SessionMeter from "@/features/sessions/SessionMeter";
import CompareCard, { type Cmp, type Side } from "@/features/ask/agent/CompareCard";
import HitList from "@/features/search/HitList";
import type { SearchResponse } from "@/features/search/api";
import { Link, navigate } from "@/lib/router";
import { deleteSession, getSession, listSessions, sessionHref, type SessionFull, type SessionItem, type StoredCompare, type StoredSide } from "./api";

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** /sessions: your chat sessions. /sessions/<id>: a chat opens in Ask; a saved search is shown here. */
export default function SessionsPage({ id }: { id?: string }) {
  return id ? <One id={id} /> : <List />;
}

function List() {
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listSessions().then(setItems).catch((e) => setError(errorText(e)));
  }, []);

  const remove = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await deleteSession(pending.id);
      setItems((all) => all?.filter((x) => x.id !== pending.id) ?? null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
      setDeleting(false);
    }
  };

  return (
    <section aria-labelledby="sess-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="caption mb-3">Each chat remembers itself, up to a context limit</p>
          <h1 id="sess-title" className="font-display text-4xl font-semibold tracking-tight">Sessions</h1>
        </div>
        <Link to="/ask" className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 font-semibold text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <Plus className="h-4 w-4" aria-hidden /> New session
        </Link>
      </div>

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {items === null ? <p className="text-muted" aria-busy>Loading…</p> : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">
          No sessions yet. Ask a question on the <Link to="/ask" className="underline">Ask</Link> tab and the chat is kept here.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md border border-line bg-surface p-4">
              <Link to={sessionHref(s)} className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-accent">
                <span className="flex items-center gap-2">
                  {s.kind === "compare" ? <Columns2 className="h-4 w-4 shrink-0 text-accent" aria-hidden /> : <MessageSquareText className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
                  <span className="truncate font-display text-lg font-semibold">{s.query}</span>
                  {s.kind === "compare" && <span className="shrink-0 rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent-fg">Compare</span>}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span>{when(s.created_at)}</span>
                  {s.kind === "compare" ? <span>Workflow vs agent, side by side</span> : <span>{s.turns} {s.turns === 1 ? "question" : "questions"}</span>}
                  {s.limit ? <SessionMeter used={s.used ?? 0} limit={s.limit} /> : null}
                </span>
              </Link>
              <button onClick={() => setPending(s)} aria-label={`Delete “${s.query}”`} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pending}
        title="Delete this session?"
        confirmLabel="Delete session"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setPending(null)}
        subject={pending && <p className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{pending.query}</p>}
      >
        This removes the session. The contracts are not affected.
      </ConfirmDialog>
    </section>
  );
}

function One({ id }: { id: string }) {
  const [s, setS] = useState<SessionFull | null | string>(null);
  const { open } = useReference();
  useEffect(() => {
    let stale = false;
    getSession(id).then((x) => { if (stale) return; if (x.kind === "chat") navigate(`/ask?s=${id}`, true); else setS(x); }).catch((e) => !stale && setS(errorText(e)));
    return () => { stale = true; };
  }, [id]);
  const compare = s && typeof s !== "string" && s.kind === "compare" ? (s.data as StoredCompare) : null;
  const d = s && typeof s !== "string" && s.kind === "search" ? (s.data as SearchResponse) : null;
  return (
    <section className="space-y-6">
      <Link to="/sessions" className="text-sm text-muted underline">← Sessions</Link>
      {s === null ? <p className="text-muted" aria-busy>Loading…</p> : typeof s === "string" ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{s}</p>
      ) : compare ? (
        <>
          <div>
            <p className="font-display text-xl font-semibold [overflow-wrap:anywhere]">{compare.question}</p>
            <p className="mt-1 text-sm text-muted"><span className="mr-2 rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent-fg">Compare</span>Workflow vs agent · {when((s as SessionFull).created_at)} · kept as a record; it is not chat memory</p>
          </div>
          <CompareCard cmp={toCmp(compare)} onPick={(_side, c) => open(c)} />
        </>
      ) : d && (
        <>
          <div>
            <p className="font-display text-xl font-semibold [overflow-wrap:anywhere]">{s.query}</p>
            <p className="mt-1 text-sm text-muted">Saved search · {when(s.created_at)}</p>
          </div>
          {d.note && <p className="rounded-md border border-line-strong bg-raised p-3 text-sm text-fg-soft">{d.note}</p>}
          <p className="text-sm text-muted">{d.results.length} results · {d.mode === "hybrid" ? `vector + keyword (${d.model})` : "keyword only"}</p>
          <HitList results={d.results} onPick={open} />
        </>
      )}
    </section>
  );
}

const side = (x: StoredSide): Side => ({ answer: x.answer, sources: x.sources, steps: x.steps ?? [], stats: x.stats, stage: null, error: x.error ?? null, fallback: x.fallback, budget: x.budget ?? null });
/** A saved comparison, shaped like a live one so the same card shows it. */
const toCmp = (c: StoredCompare): Cmp => ({ workflow: side(c.workflow), agent: side(c.agent), compared: c.compared });
