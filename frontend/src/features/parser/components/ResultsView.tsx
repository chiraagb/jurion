import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, FileText, Loader2, Save, X } from "lucide-react";
import { formatMs } from "@/lib/format";
import type { ParseResult } from "../types";
import ClauseList from "./ClauseList";

interface Props {
  result: ParseResult;
  file: File;
  onClear: () => void;
  onSave?: () => Promise<unknown>; // omitted for already-saved contracts
  clearLabel?: string;
}

/** PDF on the left, parsed clauses on the right. Mounts fresh for each result. */
export default function ResultsView({ result, file, onClear, onSave, clearLabel = "Clear" }: Props) {
  const [page, setPage] = useState(1);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | string>("idle"); // string = error message

  const doSave = async () => {
    setSave("saving");
    try {
      await onSave?.();
      setSave("saved");
    } catch (e: any) {
      setSave(e.response?.data?.detail ?? e.message ?? "Could not save.");
    }
  };

  // Local blob URL so the browser's built-in viewer can show the uploaded PDF.
  // Created inside the effect so StrictMode's mount → unmount → mount gets a fresh URL
  // instead of reusing one the first cleanup already revoked.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <section aria-labelledby="results-title" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="results-title" className="font-display text-2xl font-semibold">
            <span className="text-accent">§ 2</span> Parsed clauses
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <FileText className="h-4 w-4" aria-hidden /> {result.filename}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onSave && (
            <button
              onClick={doSave}
              disabled={save === "saving" || save === "saved"}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-canvas transition-opacity duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-70"
            >
              {save === "saving" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : save === "saved" ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {save === "saved" ? "Saved" : save === "saving" ? "Saving…" : "Save contract"}
            </button>
          )}
          <button
            onClick={onClear}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm text-fg-soft transition-colors duration-200 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X className="h-4 w-4" aria-hidden /> {clearLabel}
          </button>
        </div>
        {save !== "idle" && save !== "saving" && save !== "saved" && (
          <p role="alert" className="w-full text-sm text-danger">{save}</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[70dvh] overflow-hidden rounded-md border border-line bg-surface lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)]">
          {pdfUrl && (
            <iframe
              key={page}
              src={`${pdfUrl}#page=${page}`}
              title={`${result.filename}, page ${page}`}
              className="h-full w-full"
            />
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Pages" value={result.pages} />
            <Stat label="Clauses" value={result.clauses.length} />
            <Stat label="Parsed by" value={{ local: "Local", gemini: "Gemini", openai: "OpenAI" }[result.method]} />
            <Stat label="Total time" value={formatMs(result.total_ms)} />
            {result.confidence && (
              <Stat
                wide
                label="Parse confidence"
                value={`${Math.round(result.confidence.score * 100)}%`}
                note={`Text kept ${pct(result.confidence.coverage)} · numbering complete ${pct(result.confidence.numbering)} · headings titled ${pct(result.confidence.titled)}${result.confidence.unique !== undefined ? ` · numbers unique ${pct(result.confidence.unique)}` : ""}`}
              />
            )}
          </dl>
          {result.confidence?.issues?.map((issue) => (
            <p key={issue} role="status" className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-fg-soft">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
              {issue}
            </p>
          ))}
          <ClauseList clauses={result.clauses} onOpen={setPage} />
        </div>
      </div>
    </section>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function Stat({ label, value, note, wide }: { label: string; value: ReactNode; note?: string; wide?: boolean }) {
  return (
    <div className={`rounded-md border border-line paper p-4 ${wide ? "col-span-2" : ""}`}>
      <dt className="caption">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg">{value}</dd>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  );
}
