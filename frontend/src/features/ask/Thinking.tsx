import { Scale } from "lucide-react";

export type Stage = "search" | "grade" | "rewrite" | "act" | "write";

const WORDS: Record<Stage, string> = {
  search: "Finding the right contract and clauses",
  grade: "Checking which clauses really answer it",
  rewrite: "Nothing fit yet, rewording the question",
  act: "Investigating your contracts",
  write: "Writing the answer",
};

/** The loading animation: a brass scale that rocks, with three dots rippling after it. With "reduce motion" on it fades instead of moving, so a wait is never a frozen screen.
 *  The words are for screen readers only. */
export default function Thinking({ stage }: { stage: Stage }) {
  return (
    <div role="status" className="flex h-12 items-center gap-3 text-accent">
      <span className="sr-only">{WORDS[stage]}…</span>
      <Scale aria-hidden className="h-7 w-7 origin-[50%_85%] motion-safe:animate-[rock_1.6s_ease-in-out_infinite] motion-reduce:animate-[blink_1.6s_ease-in-out_infinite]" />
      <span aria-hidden className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ animationDelay: `${i * 160}ms` }} className="h-1.5 w-1.5 rounded-full bg-current opacity-60 motion-safe:animate-[wave_1.3s_ease-in-out_infinite] motion-reduce:animate-[blink_1.3s_ease-in-out_infinite]" />
        ))}
      </span>
    </div>
  );
}
