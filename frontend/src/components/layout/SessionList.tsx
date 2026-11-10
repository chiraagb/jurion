import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MessagesSquare, Pencil, Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import RenameDialog from "@/components/RenameDialog";
import { deleteSession, listSessions, renameSession, type SessionItem } from "@/features/sessions/api";
import { Link, navigate, useRoute } from "@/lib/router";

/** Tell the sidebar the list of sessions changed (a chat was saved or deleted), and tell the Ask page to start a fresh chat. */
export const sessionsChanged = () => dispatchEvent(new Event("jurion:sessions"));
export const newSession = () => dispatchEvent(new Event("jurion:new-session"));

const KEY = "jurion.sessions.open";
const readOpen = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } }; // storage can be blocked: never required
const ring = "focus-visible:outline-2 focus-visible:outline-accent";
interface Tip { text: string; meta: string; top: number; left: number }

/** The chat sessions in the sidebar. Expanded: a section that folds smoothly, with the full name on hover.
 *  Collapsed sidebar: two icons, one starts a session and one opens the list in a flyout. */
export default function SessionList({ collapsed }: { collapsed: boolean }) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const { segments, params } = useRoute();
  const active = segments[0] === "ask" ? params.get("s") : null;
  const load = useCallback(() => { listSessions().then(setItems).catch(() => {}); }, []);
  useEffect(() => {
    load();
    addEventListener("jurion:sessions", load);
    return () => removeEventListener("jurion:sessions", load);
  }, [load]);

  const [open, setOpen] = useState(readOpen); // the section is unfolded
  const toggle = () => setOpen((o) => { try { localStorage.setItem(KEY, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null); // the list beside a collapsed sidebar
  const [tip, setTip] = useState<Tip | null>(null);
  const flyBtn = useRef<HTMLButtonElement>(null);
  const flyBox = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!collapsed) setFlyout(null); }, [collapsed]);
  useEffect(() => {
    if (!flyout) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!flyBox.current?.contains(t) && !flyBtn.current?.contains(t)) setFlyout(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFlyout(null);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", esc); };
  }, [flyout]);
  useEffect(() => { setFlyout(null); }, [active]); // picking a session closes the flyout

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

  const showTip = (s: SessionItem, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ text: s.query, meta: `${s.turns} ${s.turns === 1 ? "question" : "questions"}`, top: r.top + r.height / 2, left: r.right + 12 });
  };

  const rows = (inFlyout: boolean) => items.length === 0 ? (
    <p className="px-3 py-2 text-sm text-subtle">Your chats appear here.</p>
  ) : (
    <ul className={`space-y-0.5 overflow-y-auto pr-0.5 ${inFlyout ? "max-h-[min(24rem,60dvh)]" : "max-h-[40vh]"}`} onScroll={() => setTip(null)}>
      {items.map((s) => {
        const on = s.id === active;
        return (
          <li key={s.id} className="group relative motion-safe:animate-[rise_0.25s_ease-out]">
            <Link
              to={`/ask?s=${s.id}`}
              aria-current={on ? "page" : undefined}
              onMouseEnter={inFlyout ? undefined : (e) => showTip(s, e.currentTarget)}
              onMouseLeave={() => setTip(null)}
              onFocus={inFlyout ? undefined : (e) => showTip(s, e.currentTarget)}
              onBlur={() => setTip(null)}
              className={`block rounded-lg py-2 pl-3 pr-16 text-sm transition-colors duration-150 ${ring} ${inFlyout ? "line-clamp-2" : "truncate"} ${on ? "bg-accent/10 font-semibold text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
            >
              {s.query}
            </Link>
            <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
              <button onClick={() => { setError(null); setTip(null); setRenaming(s); }} aria-label={`Rename session “${s.query}”`} className={`grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised hover:text-fg ${ring}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button onClick={() => { setError(null); setTip(null); setDeleting(s); }} aria-label={`Delete session “${s.query}”`} className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {/* both views stay mounted and fold into each other, so collapsing the sidebar animates instead of swapping */}
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${collapsed ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden" inert={!collapsed}>
          <div className="space-y-1">
            <Link to="/ask" onClick={newSession} aria-label="New session" data-tip="New session" className={`flex h-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg ${ring}`}>
              <Plus className="h-[1.15rem] w-[1.15rem] text-accent" aria-hidden />
            </Link>
            <button
              ref={flyBtn}
              type="button"
              aria-label="Sessions"
              aria-expanded={!!flyout}
              data-tip={flyout ? undefined : "Sessions"}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setFlyout((f) => (f ? null : { top: r.top, left: r.right + 10 })); }}
              className={`flex h-11 w-full cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised hover:text-fg ${ring} ${flyout || active ? "bg-accent/10 text-accent" : "text-muted"}`}
            >
              <MessagesSquare className="h-[1.15rem] w-[1.15rem]" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
        <div className="min-h-0 overflow-hidden" inert={collapsed}>
          <div className="mb-1 flex items-center justify-between pr-1">
            <button type="button" onClick={toggle} aria-expanded={open} className={`caption flex flex-1 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-left transition-colors hover:text-fg ${ring}`}>
              Sessions
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? "" : "-rotate-90"}`} aria-hidden />
            </button>
            <Link to="/ask" onClick={newSession} aria-label="New session" title="New session" className={`grid h-8 w-8 place-items-center rounded-lg text-accent transition-colors hover:bg-raised ${ring}`}>
              <Plus className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
            <div className="min-h-0 overflow-hidden" inert={!open}>{rows(false)}</div>
          </div>
        </div>
      </div>

      {flyout && (
        <div ref={flyBox} role="dialog" aria-label="Sessions" style={{ top: flyout.top, left: flyout.left }} className="fixed z-50 w-72 rounded-xl border border-line-strong bg-surface p-2 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.5)] motion-safe:animate-[rise_0.18s_ease-out]">
          <div className="mb-1 flex items-center justify-between px-3 py-1">
            <p className="caption">Sessions</p>
            <Link to="/ask" onClick={() => { newSession(); setFlyout(null); }} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent-fg hover:bg-raised ${ring}`}><Plus className="h-3.5 w-3.5" aria-hidden /> New</Link>
          </div>
          {rows(true)}
        </div>
      )}

      {tip && (
        <div role="tooltip" style={{ top: tip.top, left: tip.left }} className="pointer-events-none fixed z-40 max-w-xs -translate-y-1/2 rounded-lg border border-line-strong bg-surface px-3 py-2 shadow-lg motion-safe:animate-[rise_0.12s_ease-out]">
          <p className="text-sm font-medium leading-snug text-fg [overflow-wrap:anywhere]">{tip.text}</p>
          <p className="mt-0.5 text-xs text-muted">{tip.meta}</p>
        </div>
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
