import type { ReactNode } from "react";
import { Check, FileUp, KeyRound, MessageSquareText } from "lucide-react";
import { Link } from "@/lib/router";
import { openSettings, type Setup } from "./useSetup";

interface Step { title: string; text: string; done: boolean; action: ReactNode; icon: typeof KeyRound }

/** The first-run checklist on the Ask screen: what is missing, why, and one button that goes straight there. */
export default function GettingStarted({ setup }: { setup: Setup }) {
  const btn = "inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const steps: Step[] = [
    {
      title: "Add your OpenAI key", icon: KeyRound, done: setup.hasKey,
      text: "It reads your contracts into searchable form and writes the answers. It is stored encrypted and never shown again.",
      action: <button onClick={openSettings} className={`${btn} bg-accent text-canvas`}><KeyRound className="h-4 w-4" aria-hidden /> Add a key</button>,
    },
    {
      title: "Add a contract", icon: FileUp, done: setup.contracts > 0,
      text: "Upload a PDF in the Parser Lab, check how it was split into clauses, and press Save contract. Search data and the graph are built for you.",
      action: <Link to="/parser" className={`${btn} bg-accent text-canvas`}><FileUp className="h-4 w-4" aria-hidden /> Upload a contract</Link>,
    },
    {
      title: "Ask a question", icon: MessageSquareText, done: false,
      text: "Come back here. Every claim in the answer links to the exact clause and PDF page, shown beside it.",
      action: null,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="mx-auto max-w-2xl py-10 sm:py-14">
      <p className="caption mb-3">Welcome to Jurion</p>
      <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Three steps to your first answer</h2>
      <p className="mt-4 text-fg-soft">Your contracts and questions are private to your account. Parsing a PDF works without a key; the key is needed for search and answers, so add it first.</p>
      <ol className="mt-8 space-y-3">
        {steps.map((s, i) => {
          const on = i === current;
          return (
            <li key={s.title} className={`flex gap-4 rounded-2xl border p-5 transition-colors ${on ? "paper border-accent/50" : s.done ? "border-line bg-surface/60" : "border-line bg-surface/40"}`} aria-current={on ? "step" : undefined}>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-mono text-sm font-semibold ${s.done ? "bg-accent text-canvas" : on ? "bg-accent/15 text-accent-fg" : "bg-raised text-muted"}`}>
                {s.done ? <Check className="h-5 w-5" aria-label="done" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={`font-display text-xl font-semibold ${!on && !s.done ? "text-muted" : ""}`}>{s.title}{s.done && <span className="ml-2 font-sans text-sm font-normal text-accent-fg">Done</span>}</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-soft">{s.text}</p>
                {on && s.action && <div className="mt-4">{s.action}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
