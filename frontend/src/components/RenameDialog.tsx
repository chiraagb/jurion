import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  value: string; // the current name
  busy?: boolean;
  error?: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** A small popup to rename something, on a native <dialog> (focus trap, Esc and backdrop come from the browser). Enter saves. */
export default function RenameDialog({ open, title, value, busy, error, onSave, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [name, setName] = useState(value);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setName(value); d.showModal(); input.current?.select(); }
    if (!open && d.open) d.close();
  }, [open, value]);

  const ok = name.trim().length > 0 && name.trim() !== value && !busy;
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      onClick={(e) => e.target === ref.current && !busy && onCancel()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-md border border-line-strong bg-surface p-0 text-fg shadow-[0_24px_60px_-24px_rgb(0_0_0/0.55)] backdrop:bg-black/50"
    >
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(name.trim()); }}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accent"><Pencil className="h-5 w-5" aria-hidden /></span>
          <h2 id={id} className="font-display text-2xl font-semibold leading-tight">{title}</h2>
        </div>
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          aria-label="Name"
          className="h-11 w-full rounded-lg border border-line-strong bg-canvas px-3 text-base text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        />
        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
        <div className="flex gap-2 pt-1 sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="h-10 flex-1 cursor-pointer rounded-lg border border-line-strong px-5 text-sm text-fg-soft transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 sm:min-w-28 sm:flex-none">Cancel</button>
          <button type="submit" disabled={!ok} className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-5 text-sm font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-28 sm:flex-none">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
