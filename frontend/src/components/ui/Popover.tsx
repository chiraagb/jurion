import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A small panel that opens under a button; closes on a click outside, Esc, or a second click. */
export default function Popover({ label, trigger, children, className = "" }: { label: string; trigger: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", away); removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}>
        {trigger}
      </button>
      {open && (
        <div id={id} className="absolute right-0 top-full z-30 mt-2 min-w-56 rounded-xl border border-line-strong bg-surface p-2 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.5)] motion-safe:animate-[rise_0.15s_ease-out]">
          {children}
        </div>
      )}
    </div>
  );
}
