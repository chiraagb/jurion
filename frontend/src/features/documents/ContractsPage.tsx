import { useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/format";
import ResultsView from "@/features/parser/components/ResultsView";
import type { ParseResult } from "@/features/parser/types";
import { deleteDocument, listDocuments, openDocument, type DocSummary } from "./api";

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";
const METHOD = { local: "Local", gemini: "Gemini", openai: "OpenAI" };

export default function ContractsPage() {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [open, setOpen] = useState<{ result: ParseResult; file: File } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => listDocuments().then(setDocs).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  const view = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      setOpen(await openDocument(id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: DocSummary) => {
    if (!window.confirm(`Delete “${d.filename}” and its ${d.clause_count} clauses? This can't be undone.`)) return;
    try {
      await deleteDocument(d.id);
      setDocs((all) => all?.filter((x) => x.id !== d.id) ?? null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (open) return <ResultsView result={open.result} file={open.file} onClear={() => setOpen(null)} clearLabel="Back to list" />;

  return (
    <section aria-labelledby="contracts-title" className="space-y-6">
      <div>
        <p className="caption mb-3">The file room</p>
        <h1 id="contracts-title" className="font-display text-4xl font-semibold tracking-tight">
          My contracts
        </h1>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {docs === null ? (
        <p className="text-muted" aria-busy>
          Loading…
        </p>
      ) : docs.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">
          Nothing saved yet. Parse a contract in the Parser Lab and press <strong>Save contract</strong>.
        </p>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-md border border-line bg-surface p-4">
              <FileText className="h-5 w-5 shrink-0 text-accent" aria-hidden />
              <button
                onClick={() => view(d.id)}
                disabled={busyId === d.id}
                className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="block truncate font-display text-xl font-semibold text-fg">{d.filename}</span>
                <span className="block text-sm text-muted">
                  {new Date(d.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })} · {d.pages} pages ·{" "}
                  {d.clause_count} clauses · {formatBytes(d.size_bytes)} · {METHOD[d.method]}
                  {d.confidence ? ` · ${Math.round(d.confidence.score * 100)}% confidence` : ""}
                </span>
              </button>
              <button
                onClick={() => remove(d)}
                aria-label={`Delete ${d.filename}`}
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
