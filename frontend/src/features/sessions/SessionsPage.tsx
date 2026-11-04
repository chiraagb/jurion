import { useEffect, useMemo, useState } from "react";
import { Columns2, MessageSquareText, Search, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { AnswerCard, Trace } from "@/features/ask/AnswerCard";
import ClausePanel, { type ClauseRef } from "@/features/clause/ClausePanel";
import HitList from "@/features/search/HitList";
import { Link, navigate } from "@/lib/router";
import { deleteSession, getSession, listSessions, type AskData, type SessionFull, type SessionItem } from "./api";
import type { SearchResponse } from "@/features/search/api";

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const clausesOf = (s: SessionFull): ClauseRef[] => (s.kind === "ask" ? (s.data as AskData).sources : (s.data as SearchResponse).results);
const key = (c: ClauseRef) => `${c.document_id}:${c.position}`;

interface Props { id?: string; a?: string; b?: string } // /sessions, /sessions/<id>, /sessions/compare?a=..&b=..

export default function SessionsPage({ id, a, b }: Props) {
  if (id === "compare") return <Compare a={a} b={b} />;
  if (id) return <One id={id} />;
  return <List />;
}

function Kind({ kind }: { kind: "ask" | "search" }) {
  const Icon = kind === "ask" ? MessageSquareText : Search;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/10 px-2 py-1 font-mono text-xs text-accent-fg">
      <Icon className="h-3 w-3" aria-hidden /> {kind === "ask" ? "Ask" : "Search"}
    </span>
  );
}

function List() {
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]); // up to two, in the order ticked
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listSessions().then(setItems).catch((e) => setError(errorText(e)));
  }, []);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : p));
  const remove = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await deleteSession(pending.id);
      setItems((all) => all?.filter((x) => x.id !== pending.id) ?? null);
      setPicked((p) => p.filter((x) => x !== pending.id));
      setPending(null);
    } catch (e) {
      setError(errorText(e));
      setPending(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section aria-labelledby="hist-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="caption mb-3">Every question and search, kept</p>
          <h1 id="hist-title" className="font-display text-4xl font-semibold tracking-tight">History</h1>
        </div>
        <button
          disabled={picked.length !== 2}
          onClick={() => navigate(`/sessions/compare?a=${picked[0]}&b=${picked[1]}`)}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2.5 font-semibold text-canvas transition-opacity duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Columns2 className="h-4 w-4" aria-hidden /> Compare side by side ({picked.length}/2)
        </button>
      </div>

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {items === null ? <p className="text-muted" aria-busy>Loading…</p> : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">
          Nothing yet. Questions on the <Link to="/ask" className="underline">Ask</Link> tab and searches on the <Link to="/search" className="underline">Search</Link> tab are saved here automatically.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md border border-line bg-surface p-4">
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                disabled={!picked.includes(s.id) && picked.length === 2}
                onChange={() => toggle(s.id)}
                aria-label={`Select “${s.query}” to compare`}
                className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
              />
              <Link to={`/sessions/${s.id}`} className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-accent">
                <span className="flex items-center gap-2"><Kind kind={s.kind} /><span className="truncate font-display text-lg font-semibold">{s.query}</span></span>
                <span className="mt-1 block text-sm text-muted">
                  {when(s.created_at)} · {s.kind === "ask" ? `${s.sources} cited clauses` : `${s.results} clauses`}
                </span>
                {s.answer && <span className="line-clamp-2 mt-1 block text-sm text-fg-soft">{s.answer}</span>}
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
        This removes it from your history. The contracts are not affected.
      </ConfirmDialog>
    </section>
  );
}

/** Loads one session; null while loading, a string if it failed. */
function useSession(id?: string) {
  const [s, setS] = useState<SessionFull | null | string>(null);
  useEffect(() => {
    if (!id) return setS("No session chosen.");
    let stale = false;
    setS(null);
    getSession(id).then((x) => !stale && setS(x)).catch((e) => !stale && setS(errorText(e)));
    return () => { stale = true; };
  }, [id]);
  return s;
}

function Body({ s, onPick }: { s: SessionFull; onPick: (c: ClauseRef) => void }) {
  if (s.kind === "ask") {
    const d = s.data as AskData;
    return (
      <div className="space-y-4">
        <AnswerCard answer={d.answer} sources={d.sources} onPick={onPick} />
        {d.attempts.length > 0 && <Trace attempts={d.attempts} onPick={onPick} />}
      </div>
    );
  }
  const d = s.data as SearchResponse;
  return (
    <div className="space-y-3">
      {d.note && <p className="rounded-md border border-line-strong bg-raised p-3 text-sm text-fg-soft">{d.note}</p>}
      <p className="text-sm text-muted">{d.results.length} results · {d.mode === "hybrid" ? `vector + keyword (${d.model})` : "keyword only"}</p>
      <HitList results={d.results} onPick={onPick} />
    </div>
  );
}

const Head = ({ s }: { s: SessionFull }) => (
  <div className="mb-4">
    <p className="flex items-center gap-2"><Kind kind={s.kind} /><span className="font-display text-xl font-semibold [overflow-wrap:anywhere]">{s.query}</span></p>
    <p className="mt-1 text-sm text-muted">{when(s.created_at)}</p>
  </div>
);

function One({ id }: { id: string }) {
  const s = useSession(id);
  const [picked, setPicked] = useState<ClauseRef | null>(null);
  return (
    <section className="space-y-6">
      <Link to="/sessions" className="text-sm text-muted underline">← History</Link>
      {s === null ? <p className="text-muted" aria-busy>Loading…</p> : typeof s === "string" ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{s}</p>
      ) : (
        <><Head s={s} /><Body s={s} onPick={setPicked} /></>
      )}
      <ClausePanel clause={picked} onClose={() => setPicked(null)} />
    </section>
  );
}

function Compare({ a, b }: { a?: string; b?: string }) {
  const [sa, sb] = [useSession(a), useSession(b)];
  const [picked, setPicked] = useState<ClauseRef | null>(null);
  const both = useMemo(() => {
    if (!sa || !sb || typeof sa === "string" || typeof sb === "string") return [];
    const other = new Set(clausesOf(sb).map(key));
    return clausesOf(sa).filter((c) => other.has(key(c)));
  }, [sa, sb]);

  return (
    <section className="space-y-6">
      <Link to="/sessions" className="text-sm text-muted underline">← History</Link>
      {[sa, sb].map((s) => typeof s === "string" && <p key={s} role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{s}</p>)}
      {sa && sb && typeof sa !== "string" && typeof sb !== "string" && (
        <>
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="mb-2 text-sm font-semibold">
              {both.length ? `${both.length} clause${both.length > 1 ? "s" : ""} appear in both` : "No clause appears in both"}
            </p>
            {both.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {both.map((c) => (
                  <button key={key(c)} onClick={() => setPicked(c)} className="cursor-pointer rounded-md border border-line-strong px-2 py-1 text-left text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
                    <span className="font-mono text-xs text-accent-fg">{c.clause_identifier}</span> {c.title} <span className="text-muted">· {c.filename}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-8 lg:grid-cols-2">
            {[sa, sb].map((s) => (
              <div key={s.id} className="min-w-0">
                <Head s={s} />
                <Body s={s} onPick={setPicked} />
              </div>
            ))}
          </div>
        </>
      )}
      {(sa === null || sb === null) && <p className="text-muted" aria-busy>Loading…</p>}
      <ClausePanel clause={picked} onClose={() => setPicked(null)} />
    </section>
  );
}
