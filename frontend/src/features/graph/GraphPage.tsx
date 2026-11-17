import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import { ArrowLeft, ExternalLink, MessageSquareText, Network, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Link, navigate } from "@/lib/router";
import { useReference } from "@/features/clause/Reference";
import { getGraph, similarClauses, type GraphData, type Similar } from "@/features/documents/api";
import { hubs, reach, sharedCompanies } from "./logic";
import { middle, stem } from "@/lib/text";

interface Lib {
  contracts: { id: string; filename: string; summary: string; links: number }[];
  parties: { key: string; name: string }[];
  links: { party: string; contract: string; role: string }[];
}
type Pick = { kind: "contract" | "party"; id: string } | null;

const short = (s: string, n = 30) => middle(s, n, 10);
const nice = (f: string) => stem(f).replace(/^[A-Za-z]+_\d{8}_[\w-]+?_EX-?[\d.]+_\d+_EX-?[\d.]+_?/i, "").replace(/_/g, " ");

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

/** One contract's clauses that refer to each other, on a ring, with arrows. A selected clause lights up everything it relies on and everything that depends on it (solid = one hop, dashed = further). */
function layoutRefs(g: GraphData, sel: number | null, keep: Set<number> | null, hit: Set<number>): { nodes: Node[]; edges: Edge[] } {
  const refs = keep ? g.references.filter((r) => keep.has(r.from_position) && keep.has(r.to_position)) : g.references; // the filter hides clauses; a link needs both ends
  const out = sel === null ? null : reach(refs, sel, "out");
  const inn = sel === null ? null : reach(refs, sel, "in");
  const directs = new Set([...(out?.direct ?? []), ...(inn?.direct ?? [])]);
  const lit = new Set<number>(sel === null ? [] : [sel, ...directs, ...(out?.indirect ?? []), ...(inn?.indirect ?? [])]);
  const clauses = new Map<number, string>();
  refs.forEach((r) => { clauses.set(r.from_position, `${r.from_id} ${r.from_title}`); clauses.set(r.to_position, `${r.to_id} ${r.to_title}`); });
  const ids = [...clauses.keys()].sort((a, b) => a - b);
  const R = Math.max(180, ids.length * 34);
  const nodes: Node[] = ids.map((pos, i) => {
    const a = (2 * Math.PI * i) / ids.length - Math.PI / 2;
    const on = sel === pos || hit.has(pos) || lit.has(pos);
    return { id: `k:${pos}`, position: { x: R * Math.cos(a) - 85, y: R * Math.sin(a) - 16 }, data: { label: short(clauses.get(pos)!, 28) },
      style: { width: 170, padding: "6px 8px", borderRadius: 8, fontSize: 11, textAlign: "center" as const, cursor: "pointer", background: sel === pos || hit.has(pos) ? "color-mix(in srgb, var(--accent) 16%, var(--surface))" : "var(--surface)", color: "var(--fg)",
        border: `${sel === pos || directs.has(pos) || hit.has(pos) ? 2 : 1}px ${sel !== null && sel !== pos && !directs.has(pos) && lit.has(pos) ? "dashed" : "solid"} ${on ? "var(--accent)" : "var(--line-strong)"}`, opacity: sel === null || lit.has(pos) ? 1 : 0.28 } };
  });
  const edges: Edge[] = refs.map((r, i) => {
    const on = sel === null || (lit.has(r.from_position) && lit.has(r.to_position));
    return { id: `r${i}`, source: `k:${r.from_position}`, target: `k:${r.to_position}`, markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" },
      style: { stroke: on ? "var(--accent)" : "var(--line)", strokeWidth: sel !== null && on ? 2.2 : 1.3, opacity: on ? 1 : 0.3 } };
  });
  return { nodes, edges };
}

type Focus = { id: string; data: GraphData; filename: string; clauses: { clause_identifier: string; title: string; content: string; page_number?: number }[] };
const btn = "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const primary = `${btn} bg-accent font-semibold text-canvas hover:opacity-90`;
const quiet = `${btn} border border-line-strong hover:bg-raised`;
const card = "rounded-md border border-line bg-surface p-4 text-sm";

function Stat({ n, label, hint }: { n: number; label: string; hint: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <p className="font-display text-3xl font-semibold tabular-nums">{n}</p>
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

export default function GraphPage() {
  const [lib, setLib] = useState<Lib | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [loadingFocus, setLoadingFocus] = useState(false);
  const [filter, setFilter] = useState(""); // clause view: show only clauses that mention this word (and what they link to)
  const [clause, setClause] = useState<number | null>(null); // the clause selected in the clause view (its position in the contract)
  const [tab, setTab] = useState<"contracts" | "companies">("contracts");
  const [find, setFind] = useState(""); // left list search
  const [simRes, setSimRes] = useState<{ key: string; data: { embedded: boolean; similar: Similar[] } } | null>(null);
  const { open: openReference } = useReference();

  useEffect(() => {
    api.get<Lib>("/graph").then((r) => setLib(r.data)).catch((e) => setError(e.response?.data?.detail ?? e.message));
  }, []);
  const focusId = focus?.id;
  useEffect(() => {
    if (!focusId || clause === null) return;
    const key = `${focusId}:${clause}`;
    let live = true;
    similarClauses(focusId, clause).then((data) => live && setSimRes({ key, data })).catch(() => live && setSimRes({ key, data: { embedded: false, similar: [] } }));
    return () => { live = false; };
  }, [focusId, clause]);
  const sim = focusId && clause !== null ? (simRes?.key === `${focusId}:${clause}` ? simRes.data : "loading") : null;

  const nameOf = (id: string) => nice(lib?.contracts.find((c) => c.id === id)?.filename ?? id);
  const open = async (id: string) => {
    const c = lib?.contracts.find((x) => x.id === id);
    if (!c) return;
    setLoadingFocus(true);
    try {
      const [data, doc] = await Promise.all([getGraph(id), api.get(`/documents/${id}`)]);
      setClause(null); setFilter(""); setPick({ kind: "contract", id }); setFocus({ id, data, filename: c.filename, clauses: doc.data.clauses });
    } finally { setLoadingFocus(false); }
  };
  const back = () => { setFocus(null); setClause(null); setFilter(""); };

  const needle = filter.trim().toLowerCase();
  const refs = useMemo(() => focus?.data.references ?? [], [focus]);
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
  const relies = focus && clause !== null ? reach(refs, clause, "out") : { direct: [], indirect: [] };
  const dependents = focus && clause !== null ? reach(refs, clause, "in") : { direct: [], indirect: [] };
  const outgoing = relies.direct, incoming = dependents.direct;
  const top = useMemo(() => hubs(refs, 3), [refs]);
  const contract = lib && pick?.kind === "contract" ? lib.contracts.find((c) => c.id === pick.id) : undefined;
  const party = lib && pick?.kind === "party" ? lib.parties.find((p) => p.key === pick.id) : undefined;
  const shared = useMemo(() => (lib ? sharedCompanies(lib.links) : []), [lib]);
  const totalLinks = lib?.contracts.reduce((n, c) => n + c.links, 0) ?? 0;
  const noLinks = lib?.contracts.filter((c) => c.links === 0).length ?? 0;
  const q = find.trim().toLowerCase();
  const contractsShown = lib?.contracts.filter((c) => nice(c.filename).toLowerCase().includes(q)) ?? [];
  const partiesShown = lib?.parties.filter((p) => p.name.toLowerCase().includes(q)) ?? [];
  const ask = (text: string) => navigate(`/ask?q=${encodeURIComponent(text)}`);
  const openClause = (docId: string, filename: string, pos: number, c: { clause_identifier: string; title: string; page_number?: number | null; content: string }) =>
    openReference({ document_id: docId, filename, position: pos, clause_identifier: c.clause_identifier, title: c.title, page_number: c.page_number ?? null, content: c.content });
  const showOutline = !!focus && refs.length === 0; // nothing to draw: browse the clauses as a list instead of an empty canvas

  const impact = (title: string, list: { direct: number[]; indirect: number[] }, hint: string, tone: string) => (
    <div>
      <p className="font-semibold">{title} <span className="font-normal text-muted">· {list.direct.length} direct{list.indirect.length ? `, ${list.indirect.length} further away` : ""}</span></p>
      <p className="text-xs text-muted">{hint}</p>
      {list.direct.length + list.indirect.length === 0 ? <p className="mt-1 text-muted">None</p> : (
        <ul className="mt-1 space-y-1">
          {[...list.direct.map((p) => [p, true] as const), ...list.indirect.map((p) => [p, false] as const)].map(([pos, d]) => (
            <li key={pos}>
              <button onClick={() => setClause(pos)} className={`cursor-pointer text-left underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent ${tone}`}>{short(label(pos), 40)}</button>
              {!d && <span className="ml-1 text-xs text-muted">(through another clause)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section aria-labelledby="graph-title" className="space-y-5">
      <div>
        <p className="caption mb-3">Who is in which contract, and how clauses link</p>
        <h1 id="graph-title" className="font-display text-4xl font-semibold tracking-tight">Graph</h1>
        <p className="mt-3 max-w-3xl text-fg-soft">
          A map of your contracts. See which companies connect them, which clauses depend on each other (so you know what a change would touch), and how other contracts word the same clause.
        </p>
      </div>

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {!lib && !error && <p className="text-sm text-muted" role="status">Loading the graph…</p>}
      {lib && lib.contracts.length === 0 && (
        <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">No graph yet. Save a contract (<Link to="/parser" className="underline">Parser Lab</Link>) and its graph is built automatically.</p>
      )}

      {lib && lib.contracts.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat n={lib.contracts.length} label="Contracts" hint="saved and in the graph" />
            <Stat n={lib.parties.length} label="Companies" hint="found in them" />
            <Stat n={shared.length} label="Shared companies" hint={shared.length ? "connect your contracts" : "none yet: upload another contract with the same company"} />
            <Stat n={totalLinks} label="Clause links" hint={noLinks ? `${noLinks} contract${noLinks === 1 ? " has" : "s have"} none` : "“Section 5.3” style references"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_21rem]">
            {/* left: pick something */}
            <nav aria-label="Contracts and companies" className="flex max-h-[68dvh] min-h-[16rem] flex-col rounded-md border border-line bg-surface">
              <div className="space-y-2 border-b border-line p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
                  <input aria-label="Search contracts and companies" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search…" className="h-9 w-full rounded-md border border-line-strong bg-canvas pl-8 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-accent" />
                </div>
                <div role="tablist" className="grid grid-cols-2 gap-1 text-xs">
                  {(["contracts", "companies"] as const).map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`h-8 cursor-pointer rounded-md capitalize focus-visible:outline-2 focus-visible:outline-accent ${tab === t ? "bg-raised font-semibold" : "text-muted hover:text-fg"}`}>{t} ({t === "contracts" ? lib.contracts.length : lib.parties.length})</button>
                  ))}
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto p-1.5 text-sm">
                {tab === "contracts" && contractsShown.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => { back(); setPick({ kind: "contract", id: c.id }); }} aria-current={pick?.kind === "contract" && pick.id === c.id} className={`w-full cursor-pointer rounded-md px-2.5 py-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent ${pick?.kind === "contract" && pick.id === c.id ? "bg-raised font-semibold" : ""}`}>
                      <span className="block [overflow-wrap:anywhere]">{short(nice(c.filename), 40)}</span>
                      <span className="text-xs font-normal text-muted">{c.links ? `${c.links} clause links` : "no clause links"}</span>
                    </button>
                  </li>
                ))}
                {tab === "companies" && partiesShown.map((p) => {
                  const n = lib.links.filter((l) => l.party === p.key).length;
                  return (
                    <li key={p.key}>
                      <button onClick={() => { back(); setPick({ kind: "party", id: p.key }); }} aria-current={pick?.kind === "party" && pick.id === p.key} className={`w-full cursor-pointer rounded-md px-2.5 py-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent ${pick?.kind === "party" && pick.id === p.key ? "bg-raised font-semibold" : ""}`}>
                        <span className="block [overflow-wrap:anywhere]">{short(p.name, 40)}</span>
                        <span className={`text-xs font-normal ${n > 1 ? "text-accent-fg" : "text-muted"}`}>{n > 1 ? `in ${n} contracts` : "in 1 contract"}</span>
                      </button>
                    </li>
                  );
                })}
                {(tab === "contracts" ? contractsShown : partiesShown).length === 0 && <li className="p-3 text-muted">Nothing matches “{find}”.</li>}
              </ul>
            </nav>

            {/* centre: the picture (or a list when there is nothing to draw) */}
            <div className="relative h-[68dvh] min-h-[28rem] overflow-hidden rounded-md border border-line bg-surface">
              {focus && (
                <button onClick={back} className={`absolute left-3 top-3 z-10 border border-line-strong bg-surface hover:bg-raised ${btn}`}>
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Back to all contracts
                </button>
              )}
              {showOutline ? (
                <div className="flex h-full flex-col pt-16">
                  <div className="px-5 pb-3">
                    <p className="font-semibold">No clause in this contract refers to another by number.</p>
                    <p className="text-sm text-muted">That is normal for short contracts. There is nothing to draw, so here are its clauses: pick one to read it and see how your other contracts word the same thing.</p>
                  </div>
                  <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3 text-sm">
                    {focus.clauses.map((c, i) => (
                      <li key={i}>
                        <button onClick={() => setClause(i)} aria-current={clause === i} className={`w-full cursor-pointer rounded-md px-3 py-2 text-left hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent ${clause === i ? "bg-raised font-semibold" : ""}`}>
                          <span className="mr-2 font-mono text-xs text-accent-fg">{c.clause_identifier}</span>{c.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {focus && flow.nodes.length === 0 && (
                    <p className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-muted">No linked clause mentions “{filter.trim()}”. Clauses with no cross-references are not drawn.</p>
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
                    onPaneClick={() => { setPick(focus ? pick : null); setClause(null); }}
                  >
                    <Background color="var(--line)" gap={22} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                  {!focus && <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-xs text-muted">Boxes are contracts, pills are companies. A <b className="text-accent-fg">red pill</b> sits in several contracts. Click anything.</p>}
                  {focus && <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface/90 px-2 py-1 text-xs text-muted">Arrow: “refers to”. Select a clause: solid outline = one step away, dashed = further.</p>}
                </>
              )}
            </div>

            {/* right: what you can do with the selection */}
            <aside className="space-y-3 lg:max-h-[68dvh] lg:overflow-y-auto" aria-label="Details" aria-live="polite">
              {!contract && !party && !focus && (
                <div className={card}>
                  <p className="font-semibold text-fg">What can I do here?</p>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-fg-soft">
                    <li><b>Pick a contract</b> to see its companies and open its clause links.</li>
                    <li><b>Pick a company</b> to see every contract it is in.</li>
                    <li><b>Pick a clause</b> to see what a change to it would touch, and how your other contracts word the same clause.</li>
                    <li>Every selection has an <b>Ask</b> button that sends the question to the chat.</li>
                  </ul>
                </div>
              )}

              {contract && !focus && (
                <div className={`space-y-3 ${card}`}>
                  <p className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{nice(contract.filename)}</p>
                  {contract.summary && <p className="text-fg-soft">{contract.summary}</p>}
                  <ul className="space-y-1">
                    {lib.links.filter((l) => l.contract === contract.id).map((l) => (
                      <li key={l.party}><b>{lib.parties.find((p) => p.key === l.party)?.name}</b> <span className="text-muted">· {l.role}</span></li>
                    ))}
                  </ul>
                  <p className="text-muted">{contract.links ? `${contract.links} clause links inside it.` : "No clause in it refers to another by number, so there is no web to draw. You can still read its clauses and compare them with other contracts."}</p>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={loadingFocus} onClick={() => open(contract.id)} className={`${primary} disabled:opacity-50`}>
                      <Network className="h-4 w-4" aria-hidden /> {loadingFocus ? "Opening…" : contract.links ? "Explore clause links" : "Browse its clauses"}
                    </button>
                    <button onClick={() => ask(`Give me the key terms of ${nice(contract.filename)}: parties, term, payment, termination and liability.`)} className={quiet}><MessageSquareText className="h-4 w-4" aria-hidden /> Ask about it</button>
                    <Link to={`/contracts/${contract.id}`} className={quiet}><ExternalLink className="h-4 w-4" aria-hidden /> Open contract</Link>
                  </div>
                </div>
              )}

              {party && !focus && (
                <div className={`space-y-2 ${card}`}>
                  <p className="font-display text-lg font-semibold leading-snug">{party.name}</p>
                  <p className="text-muted">{lib.links.filter((l) => l.party === party.key).length > 1 ? "Appears in several contracts, which is what links them:" : "Appears in one contract:"}</p>
                  <ul className="space-y-1">{lib.links.filter((l) => l.party === party.key).map((l) => (
                    <li key={l.contract}><button onClick={() => { setTab("contracts"); setPick({ kind: "contract", id: l.contract }); }} className="cursor-pointer text-left underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"><b>{short(nameOf(l.contract), 40)}</b></button> <span className="text-muted">· {l.role}</span></li>
                  ))}</ul>
                  <button onClick={() => ask(`Which contracts involve ${party.name}, and what are its obligations in each?`)} className={quiet}><MessageSquareText className="h-4 w-4" aria-hidden /> Ask about this company</button>
                </div>
              )}

              {focus && (
                <div className={`space-y-2 ${card}`}>
                  <p className="font-semibold">{short(nameOf(focus.id), 44)}</p>
                  {!showOutline && (
                    <>
                      <label htmlFor="clause-filter" className="block text-xs text-muted">Show only clauses that mention…</label>
                      <input id="clause-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="a word, e.g. termination" className="h-10 w-full rounded-md border border-line-strong bg-canvas px-3 focus-visible:outline-2 focus-visible:outline-accent" />
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
                        {["termination", "payment", "confidential", "liability", "governing law", "indemn"].map((w) => (
                          <button key={w} onClick={() => setFilter(filter === w ? "" : w)} aria-pressed={filter === w}
                            className={`h-8 cursor-pointer rounded-full border px-3 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent ${filter === w ? "border-accent bg-accent/10 font-semibold text-fg" : "border-line-strong text-muted hover:text-fg"}`}>{w}</button>
                        ))}
                      </div>
                      <p className="text-xs text-muted">
                        {needle ? `${hit.size} clause${hit.size === 1 ? "" : "s"} mention it, shown with ${flow.edges.length} link${flow.edges.length === 1 ? "" : "s"}.` : `${flow.nodes.length} linked clauses, ${flow.edges.length} links.`}
                        {needle && <button onClick={() => setFilter("")} className="ml-2 cursor-pointer underline focus-visible:outline-2 focus-visible:outline-accent">Clear</button>}
                      </p>
                      {!sel && top.length > 0 && (
                        <div>
                          <p className="mt-1 font-semibold">Most connected clauses</p>
                          <p className="text-xs text-muted">A change here ripples furthest.</p>
                          <ul className="mt-1 space-y-1">{top.map((h) => (
                            <li key={h.pos}><button onClick={() => setClause(h.pos)} className="cursor-pointer text-left text-accent-fg underline decoration-dotted underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">{short(label(h.pos), 36)}</button> <span className="text-xs text-muted">{h.in} in · {h.out} out</span></li>
                          ))}</ul>
                        </div>
                      )}
                    </>
                  )}
                  {!sel && <p className="text-muted">{showOutline ? "Pick a clause from the list." : "Click a clause to see what it says, what depends on it and how other contracts word it."}</p>}
                </div>
              )}

              {focus && sel && clause !== null && (
                <>
                  <div className={`space-y-3 ${card}`}>
                    <p className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
                      <span className="mr-2 rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-xs font-medium text-accent-fg">{sel.clause_identifier}</span>{sel.title}
                    </p>
                    {sel.page_number && <p className="text-muted">Page {sel.page_number}</p>}
                    <p className="whitespace-pre-wrap font-display leading-relaxed text-fg-soft">{sel.content.length > 460 ? `${sel.content.slice(0, 460).trim()}…` : sel.content}</p>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openClause(focus.id, focus.filename, clause, sel)} className={primary}><ExternalLink className="h-4 w-4" aria-hidden /> Open beside</button>
                      <button onClick={() => ask(`Explain "${sel.title}" (${sel.clause_identifier}) in ${nice(focus.filename)} in plain English, and how it interacts with the clauses it refers to.`)} className={quiet}><MessageSquareText className="h-4 w-4" aria-hidden /> Ask about it</button>
                    </div>
                  </div>
                  {!showOutline && (
                    <div className={`space-y-3 ${card}`}>
                      <p className="font-display text-base font-semibold">If this clause changes</p>
                      {impact("Depends on it", dependents, "These clauses point at it, so they may need a second look.", "text-accent-fg")}
                      {impact("It relies on", relies, "This is the wording it leans on.", "text-fg")}
                    </div>
                  )}
                  <div className={`space-y-2 ${card}`}>
                    <p className="font-display text-base font-semibold">Same clause in your other contracts</p>
                    {sim === "loading" && <p className="text-muted" role="status">Looking…</p>}
                    {sim && sim !== "loading" && !sim.embedded && <p className="text-muted">This contract is not embedded yet, so it cannot be compared. Embed it on My contracts.</p>}
                    {sim && sim !== "loading" && sim.embedded && sim.similar.length === 0 && <p className="text-muted">You have no other embedded contracts to compare with. Save another one and this fills in.</p>}
                    {sim && sim !== "loading" && sim.similar.map((s) => (
                      <article key={`${s.document_id}-${s.position}`} className="rounded-md border border-line p-3">
                        <p className="flex items-start justify-between gap-2"><b className="[overflow-wrap:anywhere]">{short(nice(s.filename), 34)}</b><span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-xs tabular-nums" title="How close in meaning (cosine similarity)">{Math.round(s.similarity * 100)}%</span></p>
                        <p className="text-xs text-muted"><span className="font-mono">{s.clause_identifier}</span> {s.title}</p>
                        <p className="mt-1 line-clamp-4 whitespace-pre-wrap font-display text-fg-soft">{s.content}</p>
                        <button onClick={() => openClause(s.document_id, s.filename, s.position, s)} className="mt-2 h-9 cursor-pointer rounded-md px-2 text-xs underline decoration-dotted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">Open it beside</button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {focus && sel && clause !== null && !showOutline && (
        <section aria-labelledby="compare-title" className="space-y-3">
          <h2 id="compare-title" className="font-display text-2xl font-semibold">Compare {sel.clause_identifier} with the clauses it is linked to</h2>
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
                      <button onClick={() => openClause(focus.id, focus.filename, pos, c)} className="h-9 cursor-pointer rounded-md px-3 hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">Open PDF page</button>
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
