import { stem } from "@/lib/text";
import type { AskExtra } from "./api";

type Send = (question: string, extra?: AskExtra) => void;
const label = "mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted";

/** "Which contract?": the contracts that could fit a question that names none, and a way to search them all. */
export function Clarify({ question, options, send }: { question: string; options: { id: string; filename: string; summary: string }[]; send: Send }) {
  return (
    <div className="mt-3" role="group" aria-label="Which contract do you mean?">
      <p className={label}>Which contract?</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <li key={o.id}>
            <button
              onClick={() => send(question, { only: [o.id] })}
              className="h-full w-full cursor-pointer rounded-md border border-line-strong bg-surface px-4 py-3 text-left text-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="block font-semibold wrap-anywhere">{stem(o.filename)}</span>
              {o.summary && <span className="mt-0.5 line-clamp-2 text-muted">{o.summary}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => send(question, { anywhere: true })}
        className="mt-2 h-10 cursor-pointer rounded-full border border-line-strong px-4 text-sm text-fg-soft hover:border-accent hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Search all contracts
      </button>
    </div>
  );
}

/** Questions the user could ask next. */
export function Followups({ questions, send }: { questions: string[]; send: Send }) {
  return (
    <div className="mt-3" role="group" aria-label="Suggested follow-up questions">
      <p className={label}>Ask next</p>
      <div className="flex flex-wrap gap-2">
        {questions.map((f) => (
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
  );
}
