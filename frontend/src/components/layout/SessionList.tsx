import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import RenameDialog from "@/components/RenameDialog";
import { deleteSession, listSessions, renameSession, type SessionItem } from "@/features/sessions/api";
import { Link, navigate, useRoute } from "@/lib/router";

/** Tell the sidebar the list of sessions changed (a chat was saved or deleted), and tell the Ask page to start a fresh chat. */
export const sessionsChanged = () => dispatchEvent(new Event("jurion:sessions"));
export const newSession = () => dispatchEvent(new Event("jurion:new-session"));

/** The chat sessions, in the sidebar: a "New session" button, then your chats (newest first). The open one is highlighted. */
export default function SessionList() {
  const [items, setItems] = useState<SessionItem[]>([]);
  const { segments, params } = useRoute();
  const active = segments[0] === "ask" ? params.get("s") : null;
  const load = useCallback(() => { listSessions().then(setItems).catch(() => {}); }, []);
  useEffect(() => {
    load();
    addEventListener("jurion:sessions", load);
    return () => removeEventListener("jurion:sessions", load);
  }, [load]);

  const [deleting, setDeleting] = useState<SessionItem | null>(null); // the session a popup is asking about
  const [renaming, setRenaming] = useState<SessionItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteSession(deleting.id);
      if (deleting.id === active) { newSession(); navigate("/ask"); }
      setDeleting(null);
      load();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const rename = async (name: string) => {
    if (!renaming) return;
    setBusy(true);
    try {
      await renameSession(renaming.id, name);
      setRenaming(null);
      load();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="caption mb-2 px-3">Sessions</p>
      <Link to="/ask" onClick={newSession} className="mb-1 flex h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-fg-soft transition-colors hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
        <Plus className="h-[1.15rem] w-[1.15rem] shrink-0 text-accent" aria-hidden /> New session
      </Link>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-subtle">Your chats appear here.</p>
      ) : (
        <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto pr-0.5">
          {items.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id} className="group relative">
                <Link
                  to={`/ask?s=${s.id}`}
                  aria-current={on ? "page" : undefined}
                  title={`${s.query} · ${s.turns} ${s.turns === 1 ? "question" : "questions"}`}
                  className={`block truncate rounded-lg py-2 pl-3 pr-16 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${on ? "bg-accent/10 font-semibold text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
                >
                  {s.query}
                </Link>
                <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button onClick={() => { setError(null); setRenaming(s); }} aria-label={`Rename session “${s.query}”`} className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button onClick={() => { setError(null); setDeleting(s); }} aria-label={`Delete session “${s.query}”`} className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete this session?"
        confirmLabel="Delete session"
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
        subject={deleting && <p className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{deleting.query}</p>}
      >
        The chat and its memory are removed. The contracts are not affected.
      </ConfirmDialog>
      <RenameDialog open={!!renaming} title="Rename session" value={renaming?.query ?? ""} busy={busy} error={error} onSave={rename} onCancel={() => setRenaming(null)} />
    </div>
  );
}
