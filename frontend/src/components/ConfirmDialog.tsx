import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  subject?: ReactNode; // what is affected, shown in its own box (e.g. a file name)
  children: ReactNode; // the consequence, in a sentence or two
  confirmLabel: string;
  busy?: boolean;
  error?: string | null; // shown inside the dialog when the action fails
  onConfirm: () => void;
  onCancel: () => void;
}

/** A confirmation for a destructive action, on a native <dialog> (focus trap, Esc and backdrop come from the browser).
 *  "Cancel" has the focus when it opens, so Enter never deletes by accident. */
export default function ConfirmDialog({ open, title, subject, children, confirmLabel, busy, error, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Esc: let our state close it, and never while the action is running
        if (!busy) onCancel();
      }}
      onClick={(e) => e.target === ref.current && !busy && onCancel()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-md border border-line-strong bg-surface p-0 text-fg shadow-[0_24px_60px_-24px_rgb(0_0_0/0.55)] backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <h2 id={titleId} className="font-display text-2xl font-semibold leading-tight">{title}</h2>
        </div>

        {subject && <div className="rounded-md border border-line bg-raised px-3.5 py-3">{subject}</div>}

        <div className="text-sm leading-relaxed text-muted">{children}</div>

        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

        <div className="flex gap-2 pt-1 sm:justify-end">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={busy}
            className="h-10 flex-1 cursor-pointer rounded-lg border border-line-strong px-5 text-sm text-fg-soft transition-colors duration-200 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 sm:min-w-32 sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-danger px-5 text-sm font-medium text-canvas transition-opacity duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-default disabled:opacity-70 sm:min-w-32 sm:flex-none"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
