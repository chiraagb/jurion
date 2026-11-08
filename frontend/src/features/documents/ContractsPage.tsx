import { useEffect, useState } from "react";
import { FileText, Loader2, Network, Sparkles, Trash2 } from "lucide-react";
import GraphPanel from "./GraphPanel";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatBytes } from "@/lib/format";
import { Link, navigate } from "@/lib/router";
import ResultsView from "@/features/parser/components/ResultsView";
import type { ParseResult } from "@/features/parser/types";
import { buildGraph, deleteDocument, embedDocument, listDocuments, openDocument, type DocSummary } from "./api";

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";
const METHOD = { local: "Local", gemini: "Gemini", openai: "OpenAI" };

export default function ContractsPage({ id, page, clause }: { id?: string; page?: number; clause?: number }) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [open, setOpen] = useState<{ id: string; result: ParseResult; file: File } | null>(null); // the contract at /contracts/:id
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<DocSummary | null>(null); // the contract waiting for delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [embedding, setEmbedding] = useState<Set<string>>(new Set()); // ids being embedded right now
  const [graphing, setGraphing] = useState<Set<string>>(new Set()); // ids whose graph is being built

  const load = () => listDocuments().then(setDocs).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!id) return setOpen(null);
    let stale = false;
    setError(null);
    openDocument(id)
      .then((r) => !stale && setOpen({ id, ...r }))
      .catch((e) => !stale && setError(errorText(e)));
    return () => {
      stale = true;
    };
  }, [id]);

  // Embeds the given contracts one after another (a parallel burst would hit OpenAI and our rate limit together).
  const embed = async (targets: DocSummary[]) => {
    setError(null);
    for (const d of targets) {
      setEmbedding((s) => new Set(s).add(d.id));
      try {
        const { embedded_count } = await embedDocument(d.id);
        setDocs((all) => all?.map((x) => (x.id === d.id ? { ...x, embedded_count } : x)) ?? null);
      } catch (e) {
        setError(`${d.filename}: ${errorText(e)}`);
        break;
      } finally {
        setEmbedding((s) => {
          const n = new Set(s);
          n.delete(d.id);
          return n;
        });
      }
    }
  };

  const graphs = async (targets: DocSummary[]) => {
    setError(null);
    for (const d of targets) {
      setGraphing((s) => new Set(s).add(d.id));
      try {
        const r = await buildGraph(d.id);
        setDocs((all) => all?.map((x) => (x.id === d.id ? { ...x, graph_parties: r.parties, graph_refs: r.references } : x)) ?? null);
      } catch (e) {
        setError(`${d.filename}: ${errorText(e)}`);
        break;
      } finally {
        setGraphing((s) => {
          const n = new Set(s);
          n.delete(d.id);
          return n;
        });
      }
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

  if (id) {
    if (open?.id === id)
      return <ResultsView key={id} result={open.result} file={open.file} initialPage={page} focusClause={clause} documentId={id} extra={<GraphPanel id={id} />} onClear={() => navigate("/contracts")} clearLabel="Back to list" />;
    return error ? (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        {error} <Link to="/contracts" className="underline">Back to My contracts</Link>
      </p>
    ) : (
      <p className="text-muted" aria-busy>Loading…</p>
    );
  }

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

      {docs && docs.some((d) => d.graph_parties === null) && (
        <button
          onClick={() => graphs(docs.filter((d) => d.graph_parties === null))}
          disabled={graphing.size > 0}
          className="mr-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Network className="h-4 w-4" aria-hidden /> Build graphs for all contracts that need it
        </button>
      )}
      {docs && docs.some((d) => d.embedded_count < d.clause_count) && (
        <button
          onClick={() => embed(docs.filter((d) => d.embedded_count < d.clause_count))}
          disabled={embedding.size > 0}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Embed all contracts that need it
        </button>
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
              <Link to={`/contracts/${d.id}`} className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-accent">
                <span className="block truncate font-display text-xl font-semibold text-fg">{d.filename}</span>
                <span className="block text-sm text-muted">
                  {new Date(d.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })} · {d.pages} pages ·{" "}
                  {d.clause_count} clauses · {formatBytes(d.size_bytes)} · {METHOD[d.method]}
                  {d.confidence ? ` · ${Math.round(d.confidence.score * 100)}% confidence` : ""}
                </span>
              </Link>
              <EmbedBadge d={d} busy={embedding.has(d.id)} onEmbed={() => embed([d])} />
              <GraphBadge d={d} busy={graphing.has(d.id)} onBuild={() => graphs([d])} />
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

function EmbedBadge({ d, busy, onEmbed }: { d: DocSummary; busy: boolean; onEmbed: () => void }) {
  const done = d.clause_count > 0 && d.embedded_count === d.clause_count;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={`hidden rounded-md px-2 py-1 font-mono text-xs sm:inline ${done ? "bg-accent/10 text-accent-fg" : "bg-raised text-muted"}`}>
        {done ? "Embedded" : d.embedded_count ? `Embedded ${d.embedded_count}/${d.clause_count}` : "Not embedded"}
      </span>
      <button
        onClick={onEmbed}
        disabled={busy}
        aria-label={`${done ? "Re-embed" : "Embed"} ${d.filename}`}
        title={done ? "Re-embed (after the clauses changed)" : "Create embeddings with your OpenAI key"}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

function GraphBadge({ d, busy, onBuild }: { d: DocSummary; busy: boolean; onBuild: () => void }) {
  const built = d.graph_parties !== null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={`hidden rounded-md px-2 py-1 font-mono text-xs lg:inline ${built ? "bg-accent/10 text-accent-fg" : "bg-raised text-muted"}`}>
        {built ? `Graph ${d.graph_parties}p · ${d.graph_refs}r` : "No graph"}
      </span>
      <button
        onClick={onBuild}
        disabled={busy}
        aria-label={`${built ? "Rebuild" : "Build"} graph for ${d.filename}`}
        title={built ? "Rebuild the graph" : "Build the graph: parties (OpenAI key) and cross-references"}
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted transition-colors duration-200 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Network className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
