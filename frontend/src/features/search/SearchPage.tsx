import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { navigate } from "@/lib/router";
import EmbeddingExplainer from "./EmbeddingExplainer";
import EmbeddingMap from "./EmbeddingMap";
import { search, type Hit, type SearchResponse } from "./api";

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";

export default function SearchPage({ q: urlQuery }: { q: string }) { // the query lives in the URL: /search?q=...
  const [query, setQuery] = useState(urlQuery);
  const [data, setData] = useState<(SearchResponse & { q: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (q: string) => {
    setBusy(true);
    setError(null);
    try {
      setData({ ...(await search(q)), q });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // The URL is the source of truth: a shared or reloaded /search?q=... runs its search.
  useEffect(() => {
    setQuery(urlQuery);
    if (urlQuery.trim().length >= 2) run(urlQuery.trim());
  }, [urlQuery]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    if (q === urlQuery) run(q); // same address: navigating would do nothing
    else navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const view = (h: { document_id: string; page_number: number | null }) =>
    navigate(`/contracts/${h.document_id}${h.page_number ? `?page=${h.page_number}` : ""}`);

  return (
    <section aria-labelledby="search-title" className="space-y-6">
      <div>
        <p className="caption mb-3">Find a clause by meaning</p>
        <h1 id="search-title" className="font-display text-4xl font-semibold tracking-tight">
          Search
        </h1>
      </div>

      <form onSubmit={submit} className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search your contracts</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={500}
          placeholder="e.g. who pays if the project is cancelled early?"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          disabled={busy || query.trim().length < 2}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-5 py-3 font-semibold text-canvas transition-opacity duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          Search
        </button>
      </form>

      <EmbeddingExplainer open={!data} />

      <EmbeddingMap query={data?.q ?? null} onOpen={view} />

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {data?.note && <p className="rounded-md border border-line-strong bg-raised p-3 text-sm text-fg-soft">{data.note}</p>}

      {data && (
        data.results.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">
            No clauses matched “{data.q}”. Save a contract and use <strong>Embed</strong> on My contracts, then try again.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {data.results.length} results · {data.mode === "hybrid" ? `vector + keyword (${data.model})` : "keyword only"}
            </p>
            <ul className="space-y-3">
              {data.results.map((h) => (
                <li key={`${h.document_id}-${h.position}`}>
                  <button
                    onClick={() => view(h)}
                    className="block w-full cursor-pointer rounded-md border border-line bg-surface p-4 text-left transition-colors duration-200 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-xs font-medium text-accent-fg">{h.clause_identifier}</span>
                      <span className="font-display text-lg font-semibold text-fg">{h.title}</span>
                    </span>
                    <span className="mt-1 block text-sm text-muted">
                      {h.filename}{h.page_number ? ` · p.${h.page_number}` : ""}
                    </span>
                    <span className="mt-2 line-clamp-3 block text-sm text-fg-soft">{h.snippet}</span>
                    <Scores h={h} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </section>
  );
}

/** Why this clause matched: its rank in the vector list, its rank in the keyword list, and the merged score. */
function Scores({ h }: { h: Hit }) {
  const chip = "rounded-sm border border-line px-1.5 py-0.5";
  return (
    <span className="mt-3 flex flex-wrap gap-2 font-mono text-xs tabular-nums text-muted">
      <span className={chip}>vector {h.vector_rank ? `#${h.vector_rank} · sim ${h.vector_similarity?.toFixed(3)}` : "—"}</span>
      <span className={chip}>keyword {h.keyword_rank ? `#${h.keyword_rank}` : "—"}</span>
      <span className={chip}>fused {(h.score * 1000).toFixed(1)}</span>
    </span>
  );
}
