import type { ReactNode } from "react";
import {
  FileUp,
  Cpu,
  Sparkles,
  ListTree,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { ParseResult, Phase } from "../types";

type StepState = "pending" | "active" | "done" | "skipped" | "warn" | "failed";

interface Props {
  phase: Phase;
  file: File | null;
  uploadPct: number;
  result: ParseResult | null;
}

export default function Pipeline({ phase, file, uploadPct, result }: Props) {
  // Work out each step's visual state from the phase + the server's trace.
  const local = result?.steps.find((s) => s.name === "local");
  const gemini = result?.steps.find((s) => s.name === "llm");
  const failedAtParse = phase === "error" && uploadPct >= 100;

  const steps: { key: string; icon: ReactNode; title: string; explain: string; state: StepState; meta?: string }[] = [
    {
      key: "upload",
      icon: <FileUp className="h-5 w-5" />,
      title: "Upload",
      explain: "The PDF is sent to the backend, which checks it's really a PDF, under 25 MB and not password-protected.",
      state: phase === "idle" ? "pending" : phase === "uploading" ? "active" : phase === "error" && !failedAtParse ? "failed" : "done",
      meta: phase === "uploading" ? `${uploadPct}%` : file ? formatBytes(file.size) : undefined,
    },
    {
      key: "local",
      icon: <Cpu className="h-5 w-5" />,
      title: "Local fast parse",
      explain: "PyMuPDF reads every line with its font size and weight. Lines that look like headings (\"Section 14.2\", larger or bold text) start a new clause.",
      state: phase === "parsing" ? "active" : local ? (local.status === "done" ? "done" : "warn") : failedAtParse ? "failed" : "pending",
      meta: local ? (local.status === "done" ? `${local.ms} ms` : `found < 3 clauses · ${local.ms} ms`) : undefined,
    },
    {
      key: "gemini",
      icon: <Sparkles className="h-5 w-5" />,
      title: "LLM fallback",
      explain: "Only used when the layout is too messy for the local parser. The whole PDF goes to Gemini or OpenAI (your choice, set with the key icon), which returns clauses as structured JSON.",
      state: gemini ? (gemini.status === "skipped" ? "skipped" : gemini.status === "failed" ? "warn" : "done") : failedAtParse ? "failed" : "pending",
      meta: gemini ? (gemini.status === "skipped" ? "not needed" : `${(gemini.ms / 1000).toFixed(1)} s`) : undefined,
    },
    {
      key: "clauses",
      icon: <ListTree className="h-5 w-5" />,
      title: "Clauses",
      explain: "Each clause comes out with its identifier, title and full text, ready to be embedded and linked in the graph in the next phase.",
      state: result ? "done" : "pending",
      meta: result ? `${result.clauses.length} found` : undefined,
    },
  ];

  return (
    <section aria-labelledby="pipeline-title">
      <h2 id="pipeline-title" className="mb-4 font-display text-2xl font-semibold">
        <span className="text-accent">§ 1</span> Pipeline
      </h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={`relative rounded-md border p-4 transition-colors duration-300 ${STEP_STYLES[s.state].card}`}
          >
            <div className="flex items-center justify-between">
              <span className={`grid h-10 w-10 place-items-center rounded-lg ${STEP_STYLES[s.state].icon}`}>
                {s.icon}
              </span>
              <StepBadge state={s.state} />
            </div>
            <p className="caption mt-3">Article {["I", "II", "III", "IV"][i]}</p>
            <h3 className="font-display text-xl font-semibold text-fg">{s.title}</h3>
            {s.meta && <p className="mt-0.5 font-mono text-xs tabular-nums text-fg-soft">{s.meta}</p>}
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.explain}</p>
            {s.key === "upload" && phase === "uploading" && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full origin-left bg-accent transition-transform duration-200" style={{ transform: `scaleX(${uploadPct / 100})` }} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const STEP_STYLES: Record<StepState, { card: string; icon: string }> = {
  pending: { card: "border-line bg-surface/40", icon: "bg-raised text-subtle" },
  active: { card: "border-accent/60 bg-accent/5", icon: "bg-accent/15 text-accent-fg" },
  done: { card: "border-line-strong paper", icon: "bg-success/15 text-success" },
  skipped: { card: "border-line border-dashed bg-surface/40", icon: "bg-raised text-subtle" },
  warn: { card: "border-warn/50 bg-warn/5", icon: "bg-warn/15 text-warn" },
  failed: { card: "border-danger/40 bg-danger/5", icon: "bg-danger/15 text-danger" },
};

const BADGES: Record<StepState, { icon: ReactNode; label: string; cls: string }> = {
  pending: { icon: <CircleDashed className="h-3.5 w-3.5" />, label: "Waiting", cls: "text-subtle" },
  active: { icon: <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />, label: "Running", cls: "text-accent-fg" },
  done: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Done", cls: "text-success" },
  skipped: { icon: <CircleSlash className="h-3.5 w-3.5" />, label: "Skipped", cls: "text-muted" },
  warn: { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "Fell back", cls: "text-warn" },
  failed: { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "Failed", cls: "text-danger" },
};

function StepBadge({ state }: { state: StepState }) {
  const b = BADGES[state];
  return (
    <span className={`flex items-center gap-1 text-xs font-bold ${b.cls}`}>
      {b.icon}
      {b.label}
    </span>
  );
}
