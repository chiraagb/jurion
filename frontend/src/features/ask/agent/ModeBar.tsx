import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Columns2,
  KeyRound,
  Workflow,
} from "lucide-react";
import type { AskMode, ModelInfo, Models } from "../api";

export interface Controls {
  mode: AskMode;
  onMode: (m: AskMode) => void;
  compare: boolean;
  onCompare: (c: boolean) => void;
  models: Models | null;
  model: string;
  onModel: (m: string) => void;
}

type Choice = "agent" | "workflow" | "compare";
const CHOICES = [
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
    hint: "The AI decides what to search and read, step by step.",
  },
  {
    id: "workflow",
    label: "Workflow",
    icon: Workflow,
    hint: "A fixed pipeline: search, check, answer. Fast and predictable.",
  },
  {
    id: "compare",
    label: "Compare",
    icon: Columns2,
    hint: "Answers with both and shows them side by side. Uses 2 to 3 times as many model calls.",
  },
] as const satisfies readonly {
  id: Choice;
  label: string;
  icon: unknown;
  hint: string;
}[];

const PROVIDERS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google_genai: "Google",
};
const NOTES: Record<string, string> = {
  // a line of guidance per model; models not listed just show their name
  "gpt-4o-mini": "Fast and low cost",
  "gpt-4o": "Stronger, slower",
  "claude-haiku-5-5": "Fast and low cost",
  "claude-sonnet-5-5": "Balanced",
  "gemini-3.5-flash-lite": "Fast and low cost",
};
const short = (id: string) => id.split(":")[1] ?? id;
const ring =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** One small chip above the message box shows how the next question will be answered ("Agent · gpt-4o-mini"). It opens a panel to change it,
 *  so the full controls are not on screen for every question. */
export default function ModeBar({
  mode,
  onMode,
  compare,
  onCompare,
  models,
  model,
  onModel,
  busy,
}: Controls & { busy: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    chip = useRef<HTMLButtonElement>(null),
    group = useRef<HTMLDivElement>(null);
  const choice: Choice = compare ? "compare" : mode;
  const idx = CHOICES.findIndex((c) => c.id === choice);
  const Icon = CHOICES[idx].icon;
  const list = models?.models ?? [];
  const uses = choice !== "workflow" && list.length > 0;
  const pick = (c: Choice) => {
    onCompare(c === "compare");
    if (c !== "compare") onMode(c);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) chip.current?.focus();
  };

  useEffect(() => {
    if (open)
      group.current
        ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
        ?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);

  const arrows = (e: KeyboardEvent) => {
    // a radio group: the arrow keys move the choice
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const n = (idx + d + CHOICES.length) % CHOICES.length;
    pick(CHOICES[n].id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };

  return (
    <div ref={root} className="relative mb-2">
      <button
        ref={chip}
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Change how this is answered"
        className={`inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-full border bg-surface pl-3 pr-2.5 text-sm text-fg-soft transition-colors duration-150 hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-60 ${ring} ${open ? "border-accent text-fg" : "border-line-strong"}`}
      >
        <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span className="truncate">
          <span className="font-semibold text-fg">{CHOICES[idx].label}</span>
          {uses && (
            <span className="text-muted">
              {" "}
              · {short(models?.models.find((m) => m.id === model)?.id ?? model)}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open &&
        !busy && ( // the panel closes itself while an answer is streaming
          <div
            role="dialog"
            aria-label="How to answer"
            className="absolute bottom-full left-0 z-30 mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-surface p-3 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.45)] motion-safe:animate-[rise_0.16s_ease-out]"
          >
            <div
              ref={group}
              role="radiogroup"
              aria-label="How to answer"
              onKeyDown={arrows}
              className="relative grid grid-cols-3 rounded-xl border border-line-strong bg-raised p-1"
            >
              <span
                aria-hidden
                style={{ transform: `translateX(${idx * 100}%)` }}
                className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-accent shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
              />
              {CHOICES.map((c) => {
                const on = choice === c.id,
                  I = c.icon;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    onClick={() => pick(c.id)}
                    className={`relative z-10 flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-sm transition-colors duration-200 ${ring} ${on ? "font-semibold text-canvas" : "text-fg-soft hover:text-fg"}`}
                  >
                    <I className="h-4 w-4 shrink-0" aria-hidden />
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p
              className="mt-2 px-0.5 text-xs leading-snug text-muted"
              aria-live="polite"
            >
              {CHOICES[idx].hint}
            </p>

            {uses && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1 px-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                  {choice === "compare" ? "Agent model" : "Model"}
                </p>
                <ModelList
                  models={list}
                  value={model}
                  onChange={(id) => {
                    onModel(id);
                    close();
                  }}
                />
                {list.some((m) => !m.available) && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      dispatchEvent(new Event("jurion:open-settings"));
                    }}
                    className={`mt-1 min-h-9 cursor-pointer px-0.5 text-xs font-medium text-accent-fg hover:underline ${ring}`}
                  >
                    Add an API key…
                  </button>
                )}
              </div>
            )}
          </div>
        )}
    </div>
  );
}

/** The models as one listbox grouped by provider. Models without a saved key are shown but cannot be chosen. */
function ModelList({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const uid = useId();
  const grouped = models.reduce<Record<string, ModelInfo[]>>(
    (g, m) => ({ ...g, [m.provider]: [...(g[m.provider] ?? []), m] }),
    {},
  );
  const flat = Object.values(grouped).flat();
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      flat.findIndex((m) => m.id === value),
    ),
  );
  useEffect(() => {
    document
      .getElementById(`${uid}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, uid]);
  const step = (d: number) => {
    for (let n = 1; n <= flat.length; n++) {
      const i = (active + d * n + flat.length * n) % flat.length;
      if (flat[i].available) return setActive(i);
    }
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(
        Math.max(
          0,
          flat.findIndex((m) => m.available),
        ),
      );
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(
        flat.length - 1 - [...flat].reverse().findIndex((m) => m.available),
      );
    } else if (
      (e.key === "Enter" || e.key === " ") &&
      flat[active]?.available
    ) {
      e.preventDefault();
      onChange(flat[active].id);
    }
  };
  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label="Model"
      aria-activedescendant={`${uid}-${active}`}
      onKeyDown={keys}
      className={`max-h-[min(14rem,40dvh)] overflow-y-auto rounded-xl ${ring}`}
    >
      {Object.entries(grouped).map(([p, items]) => (
        <div
          key={p}
          role="group"
          aria-labelledby={`${uid}-g-${p}`}
          className="not-first:mt-1"
        >
          <p
            id={`${uid}-g-${p}`}
            className="px-2 pb-0.5 pt-1.5 text-[0.6875rem] font-medium text-subtle"
          >
            {PROVIDERS[p] ?? p}
          </p>
          {items.map((m) => {
            const i = flat.indexOf(m),
              sel = m.id === value;
            return (
              <div
                key={m.id}
                id={`${uid}-${i}`}
                role="option"
                aria-selected={sel}
                aria-disabled={!m.available}
                onClick={() => m.available && onChange(m.id)}
                onPointerMove={() => m.available && setActive(i)}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${m.available ? "cursor-pointer text-fg" : "cursor-not-allowed text-muted"} ${i === active && m.available ? "bg-accent/10" : ""}`}
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  {sel && <Check className="h-4 w-4 text-accent" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate ${sel ? "font-semibold" : "font-medium"}`}
                  >
                    {short(m.id)}
                  </span>
                  <span className="block text-xs text-muted">
                    {m.available
                      ? (NOTES[short(m.id)] ?? "")
                      : `Needs a ${PROVIDERS[m.provider] ?? m.provider} key`}
                  </span>
                </span>
                {!m.available && (
                  <KeyRound
                    className="h-3.5 w-3.5 shrink-0 text-subtle"
                    aria-hidden
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
