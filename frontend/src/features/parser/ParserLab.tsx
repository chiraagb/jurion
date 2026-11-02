import { AlertTriangle } from "lucide-react";
import Dropzone from "./components/Dropzone";
import Pipeline from "./components/Pipeline";
import ResultsView from "./components/ResultsView";
import { useParseContract } from "./useParseContract";

export default function ParserLab({ apiDown }: { apiDown: boolean }) {
  const { phase, file, uploadPct, result, error, busy, start, reset } = useParseContract();

  return (
    <div className="space-y-10">
      <section aria-labelledby="lab-title" className="max-w-2xl">
        <p className="caption mb-3">Exhibit A · In the matter of contract parsing</p>
        <h1 id="lab-title" className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          See how a contract gets parsed
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Drop in a contract PDF. Jurion splits it along its real structure (articles, sections,
          clauses) instead of cutting text at random lengths, and shows you each step as it happens.
        </p>
        <div className="mt-6 h-1.5 w-24 border-y border-accent" aria-hidden />
      </section>

      <Dropzone phase={phase} file={file} disabled={busy || apiDown} apiDown={apiDown} onFile={start} />

      <Pipeline phase={phase} file={file} uploadPct={uploadPct} result={result} />

      {phase === "error" && error && (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div className="flex-1">
            <p className="font-bold text-danger">Couldn't parse {file?.name ?? "that file"}</p>
            <p className="mt-1 text-sm text-danger">{error}</p>
          </div>
          <button
            onClick={reset}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-danger transition-colors duration-200 hover:bg-danger/15 focus-visible:outline-2 focus-visible:outline-danger"
          >
            Try another file
          </button>
        </div>
      )}

      {result && file && <ResultsView result={result} file={file} onClear={reset} />}
    </div>
  );
}
