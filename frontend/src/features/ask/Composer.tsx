import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

/** The message box, pinned under the thread like a chat app: Enter sends, Shift+Enter adds a line, and it grows up to six lines. */
export default function Composer({ busy, onSend, onStop, focusKey }: { busy: boolean; onSend: (q: string) => void; onStop: () => void; focusKey: unknown }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const q = text.trim();
  const canSend = q.length >= 3 && !busy;

  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  };
  useEffect(grow, [text]);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, [focusKey]); // when the Ask tab is shown again

  const send = () => {
    if (!canSend) return;
    onSend(q);
    setText("");
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); send(); }}
      className="shrink-0 border-t border-line bg-canvas/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"
    >
      <div className="mx-auto max-w-3xl">
        <div className="paper flex items-end gap-2 rounded-2xl border border-line-strong p-2 transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <label htmlFor="ask-box" className="sr-only">Ask a question about your contracts</label>
          <textarea
            id="ask-box"
            ref={box}
            value={text}
            rows={1}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
            }}
            placeholder="Ask about your contracts…"
            className="max-h-[10.5rem] min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-base leading-snug text-fg outline-none placeholder:text-subtle"
          />
          {busy ? (
            <button type="button" onClick={onStop} aria-label="Stop answering" className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-fg text-canvas transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <Square className="h-4 w-4 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="submit" disabled={!canSend} aria-label="Send question" className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-accent text-canvas transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:active:scale-100">
              <ArrowUp className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-2 truncate text-center text-xs text-subtle">
          <kbd className="rounded border border-line px-1 font-mono">Enter</kbd> to send · <kbd className="rounded border border-line px-1 font-mono">Shift</kbd>+<kbd className="rounded border border-line px-1 font-mono">Enter</kbd> for a new line · every claim cites your contracts
        </p>
      </div>
    </form>
  );
}
