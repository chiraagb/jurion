import { useEffect, useState } from "react";
import { Loader2, Network } from "lucide-react";
import { buildGraph, getGraph, type GraphData } from "./api";

const errorText = (e: any) => e.response?.data?.detail ?? e.message ?? "Something went wrong.";

/** What the Neo4j graph holds for this contract: its parties (and other contracts they appear in) and its clause cross-references. */
export default function GraphPanel({ id }: { id: string }) {
  const [g, setG] = useState<GraphData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const load = () => getGraph(id).then(setG).catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, [id]);
  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      await buildGraph(id);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const refs = g?.references ?? [];
  return (
    <details className="rounded-md border border-line bg-surface" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <Network className="h-4 w-4 text-accent" aria-hidden /> Graph
        {g?.built && <span className="font-mono text-xs font-normal text-muted">{g.parties.length} parties · {refs.length} cross-references</span>}
      </summary>
      <div className="space-y-4 border-t border-line p-5">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {g === null ? <p className="text-sm text-muted" aria-busy>Loading…</p> : (
          <>
            {!g.built && <p className="text-sm text-muted">The graph has not been built for this contract.</p>}
            <button onClick={build} disabled={busy} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} {g.built ? "Rebuild graph" : "Build graph"}
            </button>
            {g.built && (
              <>
                {g.summary && <p className="text-sm text-fg-soft"><span className="font-semibold text-fg">About: </span>{g.summary}</p>}
                <div>
                  <p className="mb-2 text-sm font-semibold">Parties</p>
                  {g.parties.length === 0 ? <p className="text-sm text-muted">None stored. Parties are read by AI and need an OpenAI key; rebuild after saving one.</p> : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {g.parties.map((p) => (
                        <li key={p.name} className="rounded-md border border-line p-3 text-sm">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-muted">{p.role}{p.aliases.length > 0 && ` · also “${p.aliases.join("”, “")}”`}</p>
                          {p.also_in.length > 0 && <p className="mt-1 text-xs text-accent-fg">Also in {p.also_in.length} other contract{p.also_in.length > 1 ? "s" : ""}: {p.also_in.join(", ")}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold">Clause cross-references</p>
                  {refs.length === 0 ? <p className="text-sm text-muted">No numbered references like “Section 5.3” were found in this contract.</p> : (
                    <>
                      <ul className="space-y-1 text-sm">
                        {(all ? refs : refs.slice(0, 8)).map((r, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-mono text-xs text-accent-fg">{r.from_id}</span><span className="truncate text-fg-soft">{r.from_title.slice(0, 40)}</span>
                            <span className="text-subtle" aria-label="refers to">→</span>
                            <span className="font-mono text-xs text-accent-fg">{r.to_id}</span><span className="truncate text-fg-soft">{r.to_title.slice(0, 40)}</span>
                          </li>
                        ))}
                      </ul>
                      {refs.length > 8 && <button onClick={() => setAll(!all)} className="mt-2 cursor-pointer text-sm underline focus-visible:outline-2 focus-visible:outline-accent">{all ? "Show fewer" : `Show all ${refs.length}`}</button>}
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
