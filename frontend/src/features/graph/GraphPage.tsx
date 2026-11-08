import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { ArrowLeft, ExternalLink, Network } from "lucide-react";
import { api } from "@/lib/api";
import { Link } from "@/lib/router";
import { useReference } from "@/features/clause/Reference";
import { getGraph, type GraphData } from "@/features/documents/api";

interface Lib {
  contracts: { id: string; filename: string; summary: string }[];
  parties: { key: string; name: string }[];
  links: { party: string; contract: string; role: string }[];
}
type Pick = { kind: "contract" | "party"; id: string } | null;

const short = (s: string, n = 30) => (s.length <= n ? s : `${s.slice(0, n - 12)}…${s.slice(-10)}`);
const nice = (f: string) => f.replace(/\.pdf$/i, "").replace(/^[A-Za-z]+_\d{8}_[\w-]+?_EX-?[\d.]+_\d+_EX-?[\d.]+_?/i, "").replace(/_/g, " ");

/** Contracts on a ring; each company sits next to its contract (outside the ring), and a company in several contracts sits between them. */
function layoutLibrary(lib: Lib, pick: Pick): { nodes: Node[]; edges: Edge[] } {
  const n = Math.max(lib.contracts.length, 1);
  const R = Math.max(260, n * 42);
  const at = new Map<string, { x: number; y: number; a: number }>();
  lib.contracts.forEach((c, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    at.set(c.id, { x: R * Math.cos(a), y: R * Math.sin(a), a });
  });
  const docsOf = new Map<string, string[]>();
  lib.links.forEach((l) => docsOf.set(l.party, [...(docsOf.get(l.party) ?? []), l.contract]));
  const singles = new Map<string, number>(); // how many single-contract companies a contract has placed so far
  const linked = (id: string) => (pick?.kind === "contract" ? pick.id === id : pick?.kind === "party" ? (docsOf.get(pick.id) ?? []).includes(id) : true);
  const partyOn = (key: string) => (pick?.kind === "party" ? pick.id === key : pick?.kind === "contract" ? (docsOf.get(key) ?? []).includes(pick.id) : true);

  const nodes: Node[] = lib.contracts.map((c) => ({
    id: `c:${c.id}`,
    position: { x: at.get(c.id)!.x - 105, y: at.get(c.id)!.y - 24 },
    data: { label: short(nice(c.filename), 34) },
    style: { width: 210, padding: "10px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, textAlign: "center" as const, background: "var(--surface)", color: "var(--fg)",
      border: `2px solid ${pick?.kind === "contract" && pick.id === c.id ? "var(--accent)" : "var(--line-strong)"}`, opacity: linked(c.id) ? 1 : 0.28, cursor: "pointer" },
  }));
  lib.parties.forEach((p) => {
    const ds = docsOf.get(p.key) ?? [];
    const shared = ds.length > 1;
    let x: number, y: number;
    if (shared) {
      const pts = ds.map((d) => at.get(d)!);
      x = (pts.reduce((s, q) => s + q.x, 0) / pts.length) * 0.55;
      y = (pts.reduce((s, q) => s + q.y, 0) / pts.length) * 0.55;
    } else {
      const d = at.get(ds[0]);
      if (!d) return;
      const k = singles.get(ds[0]) ?? 0;
      singles.set(ds[0], k + 1);
      const a = d.a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.16;
      x = 1.62 * R * Math.cos(a);
      y = 1.62 * R * Math.sin(a);
    }
    nodes.push({
      id: `p:${p.key}`, position: { x: x - 70, y: y - 14 }, data: { label: short(p.name, 26) },
      style: { width: 140, padding: "5px 8px", borderRadius: 999, fontSize: 11, textAlign: "center" as const, cursor: "pointer",
        background: shared ? "var(--accent)" : "var(--raised)", color: shared ? "var(--canvas)" : "var(--fg-soft)", fontWeight: shared ? 700 : 400,
        border: `1px solid ${pick?.kind === "party" && pick.id === p.key ? "var(--fg)" : shared ? "var(--accent)" : "var(--line-strong)"}`, opacity: partyOn(p.key) ? 1 : 0.28 },
    });
  });
  const edges: Edge[] = lib.links.map((l, i) => {
    const on = !pick || (pick.kind === "contract" ? pick.id === l.contract : pick.id === l.party);
    return { id: `e${i}`, source: `p:${l.party}`, target: `c:${l.contract}`, style: { stroke: on ? "var(--accent)" : "var(--line)", strokeWidth: on && pick ? 2.2 : 1.2, opacity: on ? 1 : 0.35 } };
  });
  return { nodes, edges };
}

/** One contract's clauses that refer to each other, on a ring, with arrows. */
function layoutRefs(g: GraphData, sel: number | null, keep: Set<number> | null, hit: Set<number>): { nodes: Node[]; edges: Edge[] } {
  const refs = keep ? g.references.filter((r) => keep.has(r.from_position) && keep.has(r.to_position)) : g.references; // the filter hides clauses; a link needs both ends
  const near = new Set<number>(sel === null ? [] : [sel]);
  refs.forEach((r) => { if (r.from_position === sel) near.add(r.to_position); if (r.to_position === sel) near.add(r.from_position); });
  const clauses = new Map<number, string>();
  refs.forEach((r) => { clauses.set(r.from_position, `${r.from_id} ${r.from_title}`); clauses.set(r.to_position, `${r.to_id} ${r.to_title}`); });
  const ids = [...clauses.keys()].sort((a, b) => a - b);
  const R = Math.max(180, ids.length * 34);
  const nodes: Node[] = ids.map((pos, i) => {
    const a = (2 * Math.PI * i) / ids.length - Math.PI / 2;
    return { id: `k:${pos}`, position: { x: R * Math.cos(a) - 85, y: R * Math.sin(a) - 16 }, data: { label: short(clauses.get(pos)!, 28) },
      style: { width: 170, padding: "6px 8px", borderRadius: 8, fontSize: 11, textAlign: "center" as const, cursor: "pointer", background: hit.has(pos) ? "color-mix(in srgb, var(--accent) 16%, var(--surface))" : "var(--surface)", color: "var(--fg)",
        border: `${sel === pos || hit.has(pos) ? 2 : 1}px solid ${sel === pos || hit.has(pos) ? "var(--accent)" : "var(--line-strong)"}`, opacity: sel === null || near.has(pos) ? 1 : 0.3 } };
  });
  const edges: Edge[] = refs.map((r, i) => ({ id: `r${i}`, source: `k:${r.from_position}`, target: `k:${r.to_position}`, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" },
    style: { stroke: sel === null || r.from_position === sel || r.to_position === sel ? "var(--accent)" : "var(--line)", strokeWidth: sel !== null && (r.from_position === sel || r.to_position === sel) ? 2.4 : 1.3, opacity: sel === null || r.from_position === sel || r.to_position === sel ? 1 : 0.35 } }));
  return { nodes, edges };
}

export default function GraphPage() {
  const [lib, setLib] = useState<Lib | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [focus, setFocus] = useState<{ id: string; data: GraphData; filename: string; clauses: { clause_identifier: string; title: string; content: string; page_number?: number }[] } | null>(null);
  const [filter, setFilter] = useState(""); // clause view: show only clauses that mention this word (and what they link to)
  const [clause, setClause] = useState<number | null>(null); // the clause selected in the clause view (its position in the contract)
  const { open: openReference } = useReference();

  useEffect(() => {
    api.get<Lib>("/graph").then((r) => setLib(r.data)).catch((e) => setError(e.response?.data?.detail ?? e.message));
  }, []);

  const needle = filter.trim().toLowerCase();
  const { keep, hit } = useMemo(() => {
    if (!focus || !needle) return { keep: null, hit: new Set<number>() };
    const linked = new Set<number>();
    focus.data.references.forEach((r) => { linked.add(r.from_position); linked.add(r.to_position); });
    const hit = new Set([...linked].filter((p) => { const c = focus.clauses[p]; return !!c && `${c.clause_identifier} ${c.title} ${c.content}`.toLowerCase().includes(needle); }));
    const keep = new Set(hit);
    focus.data.references.forEach((r) => { if (hit.has(r.from_position)) keep.add(r.to_position); if (hit.has(r.to_position)) keep.add(r.from_position); });
    return { keep, hit };
  }, [focus, needle]);
  const flow = useMemo(() => (focus ? layoutRefs(focus.data, clause, keep, hit) : lib ? layoutLibrary(lib, pick) : { nodes: [], edges: [] }), [lib, pick, focus, clause, keep, hit]);
  const sel = focus && clause !== null ? focus.clauses[clause] : undefined;
  const label = (pos: number) => { const c = focus?.clauses[pos]; return c ? `${c.clause_identifier} ${c.title}` : String(pos); };
  const outgoing = focus && clause !== null ? [...new Set(focus.data.references.filter((r) => r.from_position === clause).map((r) => r.to_position))] : [];
  const incoming = focus && clause !== null ? [...new Set(focus.data.references.filter((r) => r.to_position === clause).map((r) => r.from_position))] : [];
  const contract = lib && pick?.kind === "contract" ? lib.contracts.find((c) => c.id === pick.id) : undefined;
  const party = lib && pick?.kind === "party" ? lib.parties.find((p) => p.key === pick.id) : undefined;
  const nameOf = (id: string) => nice(lib?.contracts.find((c) => c.id === id)?.filename ?? id);

  return (
    <section aria-labelledby="graph-title" className="space-y-5">
      <div>
        <p className="caption mb-3">Who is in which contract, and how clauses link</p>
        <h1 id="graph-title" className="font-display text-4xl font-semibold tracking-tight">Graph</h1>
        <p className="mt-3 max-w-3xl text-fg-soft">
          Each <b>box</b> is a contract and each <b>pill</b> is a company in it. A company that appears in <b className="text-accent-fg">more than one contract</b> is the red pill between them: that shared dot is what connects your contracts. Click anything to highlight what it connects to.
        </p>
      </div>

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {lib && lib.contracts.length === 0 && (
        <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">No graph yet. Save a contract (<Link to="/parser" className="underline">Parser Lab</Link>) and its graph is built automatically.</p>
      )}

      {lib && lib.contracts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="relative h-[68dvh] min-h-[28rem] overflow-hidden rounded-md border border-line bg-surface">
            {focus && (
              <button onClick={() => { setFocus(null); setClause(null); setFilter(""); }} className="absolute left-3 top-3 z-10 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to all contracts
              </button>
            )}
            {focus && flow.nodes.length === 0 && (
              <p className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-muted">
                {needle ? <>No linked clause mentions “{filter.trim()}”. Clauses with no cross-references are not drawn.</> : "No numbered cross-references (“Section 5.3”) were found in this contract."}
              </p>
            )}
            <ReactFlow
              key={focus ? `${focus.id}:${hit.size}:${keep?.size ?? "all"}` : "lib"}  /* refit when the visible clauses change */
              nodes={flow.nodes}
              edges={flow.edges}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.15}
              nodesConnectable={false}
              onNodeClick={(_, nd) => {
                if (focus) { const pos = Number(nd.id.slice(2)); setClause((cur) => (cur === pos ? null : pos)); return; }
                const [kind, id] = [nd.id.startsWith("c:") ? "contract" : "party", nd.id.slice(2)] as const;
                setPick((cur) => (cur?.id === id ? null : { kind, id }));
              }}
              onPaneClick={() => { setPick(null); setClause(null); }}
            >
              <Background color="var(--line)" gap={22} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <aside className="space-y-3" aria-label="Details">
            {!contract && !party && !focus && (
              <div className="rounded-md border border-line bg-surface p-4 text-sm text-fg-soft">
                <p className="font-semibold text-fg">{lib.contracts.length} contracts · {lib.parties.length} companies</p>
                <p className="mt-1">{lib.parties.filter((p) => lib.links.filter((l) => l.party === p.key).length > 1).length} companies appear in more than one contract. Click a box or a pill for details.</p>
                {lib.links.length === 0 && <p className="mt-2 text-warn">No companies are stored yet. Build the graphs on My contracts (the network icon).</p>}
              </div>
            )}
            {contract && !focus && (
              <div className="space-y-3 rounded-md border border-line bg-surface p-4 text-sm">
                <p className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{nice(contract.filename)}</p>
                {contract.summary && <p className="text-fg-soft">{contract.summary}</p>}
                <ul className="space-y-1">
                  {lib.links.filter((l) => l.contract === contract.id).map((l) => (
                    <li key={l.party}><b>{lib.parties.find((p) => p.key === l.party)?.name}</b> <span className="text-muted">· {l.role}</span></li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button onClick={async () => { const [data, doc] = await Promise.all([getGraph(contract.id), api.get(`/documents/${contract.id}`)]); setClause(null); setFilter(""); setFocus({ id: contract.id, data, filename: contract.filename, clauses: doc.data.clauses }); }} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <Network className="h-4 w-4" aria-hidden /> Show clause links
                  </button>
                  <Link to={`/contracts/${contract.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"><ExternalLink className="h-4 w-4" aria-hidden /> Open contract</Link>
                </div>
              </div>
            )}
            {party && !focus && (
              <div className="space-y-2 rounded-md border border-line bg-surface p-4 text-sm">
                <p className="font-display text-lg font-semibold leading-snug">{party.name}</p>
                <p className="text-muted">{lib.links.filter((l) => l.party === party.key).length > 1 ? "Appears in several contracts, which is what links them:" : "Appears in one contract:"}</p>
                <ul className="space-y-1">{lib.links.filter((l) => l.party === party.key).map((l) => <li key={l.contract}><b>{short(nameOf(l.contract), 40)}</b> <span className="text-muted">· {l.role}</span></li>)}</ul>
              </div>
            )}
            {focus && (
              <div className="space-y-2 rounded-md border border-line bg-surface p-4 text-sm">
                <label htmlFor="clause-filter" className="font-semibold">Filter clauses</label>
                <input id="clause-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="a word, e.g. termination" className="h-10 w-full rounded-md border border-line-strong bg-canvas px-3 focus-visible:outline-2 focus-visible:outline-accent" />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
                  {["termination", "payment", "confidential", "liability", "governing law", "indemn"].map((w) => (
                    <button key={w} onClick={() => setFilter(filter === w ? "" : w)} aria-pressed={filter === w}
                      className={`h-8 cursor-pointer rounded-full border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${filter === w ? "border-accent bg-accent/10 font-semibold text-fg" : "border-line-strong text-muted hover:text-fg"}`}>{w}</button>
                  ))}
                </div>
                <p className="text-xs text-muted" aria-live="polite">
                  {needle ? `${hit.size} clause${hit.size === 1 ? "" : "s"} mention it, shown with ${flow.edges.length} link${flow.edges.length === 1 ? "" : "s"} to and from them.` : `Showing all ${flow.nodes.length} linked clauses.`}
                  {needle && <button onClick={() => setFilter("")} className="ml-2 cursor-pointer underline focus-visible:outline-2 focus-visible:outline-accent">Clear</button>}
                </p>
              </div>
            )}
            {focus && !sel && (
              <div className="rounded-md border border-line bg-surface p-4 text-sm text-fg-soft">
                <p className="font-semibold text-fg">{short(nameOf(focus.id), 44)}</p>
                <p className="mt-1">{focus.data.references.length} clause link{focus.data.references.length === 1 ? "" : "s"}. An arrow means “this clause refers to that clause”.</p>
                <p className="mt-2">Click a clause to see what it says and what it connects to.</p>
              </div>
            )}
            {focus && sel && clause !== null && (
              <div className="space-y-3 rounded-md border border-line bg-surface p-4 text-sm">
                <p className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
                  <span className="mr-2 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-xs font-medium text-accent-fg">{sel.clause_identifier}</span>{sel.title}
                </p>
                {sel.page_number && <p className="text-muted">Page {sel.page_number}</p>}
                <p className="whitespace-pre-wrap font-display leading-relaxed text-fg-soft">{sel.content.length > 460 ? `${sel.content.slice(0, 460).trim()}…` : sel.content}</p>
                {[["Refers to", outgoing, "this clause points at"], ["Referred to by", incoming, "these clauses point at it"]].map(([title, list, hint]) => (
                  <div key={title as string}>
                    <p className="font-semibold">{title as string} <span className="font-normal text-muted">({(list as number[]).length}) · {hint as string}</span></p>
                    {(list as number[]).length === 0 ? <p className="text-muted">None</p> : (
                      <ul className="mt-1 space-y-1">
                        {(list as number[]).map((pos) => (
                          <li key={pos}><button onClick={() => setClause(pos)} className="cursor-pointer text-left text-accent-fg underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">{short(label(pos), 44)}</button></li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => openReference({ document_id: focus.id, filename: focus.filename, position: clause, clause_identifier: sel.clause_identifier, title: sel.title, page_number: sel.page_number ?? null, content: sel.content })}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open it beside the graph
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {focus && sel && clause !== null && (
        <section aria-labelledby="compare-title" className="space-y-3">
          <h2 id="compare-title" className="font-display text-2xl font-semibold">
            Compare {sel.clause_identifier} with the clauses it is linked to
          </h2>
          <p className="max-w-3xl text-sm text-muted">The selected clause first, then each clause it refers to, then each clause that refers to it, with their full text, so you can read them together.</p>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,21rem),1fr))]">
            {([[clause, "Selected"], ...outgoing.map((p) => [p, "It refers to this"]), ...incoming.map((p) => [p, "Refers to it"])] as [number, string][]).map(([pos, rel]) => {
              const c = focus.clauses[pos];
              if (!c) return null;
              return (
                <article key={`${rel}-${pos}`} className={`flex flex-col rounded-md border bg-surface ${rel === "Selected" ? "border-accent" : "border-line"}`}>
                  <header className="flex items-start justify-between gap-3 border-b border-line p-3">
                    <p className="min-w-0 font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
                      <span className="mr-2 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-xs font-medium text-accent-fg">{c.clause_identifier}</span>{c.title}
                    </p>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs ${rel === "Selected" ? "bg-accent text-canvas" : "bg-raised text-fg-soft"}`}>{rel}</span>
                  </header>
                  <p className="max-h-80 overflow-y-auto whitespace-pre-wrap p-4 font-display text-base leading-relaxed text-fg-soft">{c.content}</p>
                  <footer className="mt-auto flex items-center justify-between gap-2 border-t border-line p-2 text-xs text-muted">
                    <span>{c.page_number ? `Page ${c.page_number}` : ""}</span>
                    <span className="flex gap-1">
                      {rel !== "Selected" && <button onClick={() => setClause(pos)} className="h-9 cursor-pointer rounded-md px-3 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">Select it</button>}
                      <button onClick={() => openReference({ document_id: focus.id, filename: focus.filename, position: pos, clause_identifier: c.clause_identifier, title: c.title, page_number: c.page_number ?? null, content: c.content })} className="h-9 cursor-pointer rounded-md px-3 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">Open PDF page</button>
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {lib && lib.contracts.length > 0 && (
        <details className="rounded-md border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">The same information as a list</summary>
          <ul className="space-y-2 border-t border-line p-4 text-sm">
            {lib.contracts.map((c) => (
              <li key={c.id}><b>{nice(c.filename)}</b>: {lib.links.filter((l) => l.contract === c.id).map((l) => `${lib.parties.find((p) => p.key === l.party)?.name} (${l.role})`).join("; ") || "no companies stored"}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
