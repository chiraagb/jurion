import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, FileText, Loader2, Save, Sparkles, X } from "lucide-react";
import { clauseBoxes, fetchPdf } from "@/features/documents/api";
import LazyPdfViewer from "@/features/pdf/LazyPdfViewer";
import type { Box } from "@/features/pdf/PdfViewer";
import { loadProvider } from "@/features/settings/llmConfig";
import { formatMs } from "@/lib/format";
import type { ParseResult } from "../types";
import ClauseList from "./ClauseList";

interface Props {
  result: ParseResult;
  file: File;
  onClear: () => void;
  onSave?: (replace?: boolean) => Promise<unknown>; // omitted for already-saved contracts
  clearLabel?: string;
  onRerunAi?: () => void; // Parser Lab only: re-run with the AI picking the headings
  hasAi?: boolean; // an AI result already exists: the button re-runs it
  aiBusy?: boolean;
  aiError?: string | null;
  initialPage?: number; // e.g. when opened from a citation
  focusClause?: number; // index of a clause to jump to
  documentId?: string; // a saved contract: the PDF is drawn by pdf.js and the open clause is highlighted
}

/** PDF on the left, parsed clauses on the right. Mounts fresh for each result. */
export default function ResultsView({ result, file, onClear, onSave, clearLabel = "Clear", onRerunAi, hasAi, aiBusy, aiError, initialPage = 1, focusClause, documentId }: Props) {
  const aiName = loadProvider() === "openai" ? "OpenAI" : "Gemini";
  const [page, setPage] = useState(initialPage);
  const [active, setActive] = useState<number | null>(focusClause ?? null); // the clause shaded on the PDF
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    if (!documentId || active === null) return setBoxes([]);
    let stale = false;
    clauseBoxes(documentId, active).then((b) => !stale && setBoxes(b)).catch(() => !stale && setBoxes([]));
    return () => { stale = true; };
  }, [documentId, active]);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | string>("idle"); // string = error message

  // Set when the server says this exact file is already saved (409): offers to replace that copy.
  const [dupe, setDupe] = useState<{ filename: string; created_at: string } | null>(null);

  const doSave = async (replace = false) => {
    setSave("saving");
    setDupe(null);
    try {
      await onSave?.(replace);
      setSave("saved");
    } catch (e: any) {
      if (e.response?.status === 409 && e.response.data?.existing) {
        setDupe(e.response.data.existing);
        setSave("idle");
      } else {
        setSave(e.response?.data?.detail ?? e.message ?? "Could not save.");
      }
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
          {onRerunAi && (
            <button
              onClick={onRerunAi}
              disabled={aiBusy}
              title={`Ask ${aiName} to find the clause headings. Use it when the local parse missed sections or merged them.`}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors duration-200 hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-70"
            >
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {aiBusy ? `Asking ${aiName}…` : hasAi ? `Re-run with ${aiName}` : `Parse with ${aiName}`}
            </button>
          )}
          {onSave && (
            <button
              onClick={() => doSave()}
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
        {dupe && (
          <div role="alert" className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-fg-soft">
            <p className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
              <span>
                You already saved this file as <strong className="break-words text-fg">{dupe.filename}</strong> on{" "}
                {new Date(dupe.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}. It is in My contracts.
              </span>
            </p>
            <span className="flex shrink-0 gap-2">
              <button
                onClick={() => doSave(true)}
                className="cursor-pointer rounded-lg border border-warn px-3 py-1.5 font-medium text-fg transition-colors duration-200 hover:bg-warn/15 focus-visible:outline-2 focus-visible:outline-warn"
              >
                Replace it with this result
              </button>
              <button
                onClick={() => setDupe(null)}
                className="cursor-pointer rounded-lg px-3 py-1.5 text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                Dismiss
              </button>
            </span>
          </div>
        )}
        {aiError && <p role="alert" className="w-full text-sm text-danger">{aiError}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[70dvh] overflow-hidden rounded-md border border-line bg-surface lg:sticky lg:top-20 lg:h-[calc(100dvh-7rem)]">
          {documentId ? (
            <LazyPdfViewer docKey={documentId} getData={() => fetchPdf(documentId)} page={page} onPage={setPage} boxes={boxes} />
          ) : pdfUrl && (
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
                note={`Text kept ${pct(result.confidence.coverage)} · numbering complete ${pct(result.confidence.numbering)} · headings titled ${pct(result.confidence.titled)}${result.confidence.unique !== undefined ? ` · numbers unique ${pct(result.confidence.unique)}` : ""}${result.confidence.balanced !== undefined ? ` · evenly split ${pct(result.confidence.balanced)}` : ""}`}
              />
            )}
          </dl>
          {result.confidence?.issues?.map((issue) => (
            <p key={issue} role="status" className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-fg-soft">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
              {issue}
            </p>
          ))}
          <ClauseList clauses={result.clauses} onOpen={(p, i) => { setPage(p); setActive(i); }} focus={focusClause} />
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
