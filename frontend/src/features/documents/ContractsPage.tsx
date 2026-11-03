import { useEffect, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
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
  const [pending, setPending] = useState<DocSummary | null>(null); // the contract waiting for delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const askDelete = (d: DocSummary) => {
    setDeleteError(null);
    setPending(d);
  };

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteDocument(pending.id);
      setDocs((all) => all?.filter((x) => x.id !== pending.id) ?? null);
      setPending(null);
    } catch (e) {
      setDeleteError(errorText(e)); // stays open so the failure is seen next to the button
    } finally {
      setDeleting(false);
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
                onClick={() => askDelete(d)}
                aria-label={`Delete ${d.filename}`}
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-danger"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pending}
        title="Delete this contract?"
        confirmLabel="Delete contract"
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
        subject={
          pending && (
            <>
              <p className="font-display text-lg font-semibold leading-snug text-fg [overflow-wrap:anywhere]">{pending.filename}</p>
              <p className="mt-0.5 text-xs text-muted">
                {pending.pages} pages · {pending.clause_count} clauses · {formatBytes(pending.size_bytes)}
              </p>
            </>
          )
        }
      >
        This permanently removes the contract, its clauses and the stored PDF from your account. This can't be undone.
      </ConfirmDialog>
    </section>
  );
}
