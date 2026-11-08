// Pure helpers for the Graph page (no React), so they can be tested with `npm test`.
export type Ref = { from_position: number; to_position: number };

/** Everything a clause reaches by following links: "out" = clauses it relies on, "in" = clauses that depend on it. Direct = one hop, indirect = more hops. */
export function reach(refs: Ref[], start: number, dir: "out" | "in") {
  const [a, b] = dir === "out" ? (["from_position", "to_position"] as const) : (["to_position", "from_position"] as const);
  const next = (p: number) => refs.filter((r) => r[a] === p).map((r) => r[b]);
  const direct = [...new Set(next(start))].filter((p) => p !== start);
  const seen = new Set([start, ...direct]);
  const indirect: number[] = [];
  for (let queue = [...direct]; queue.length; ) {
    const p = queue.shift()!;
    for (const q of next(p)) if (!seen.has(q)) { seen.add(q); indirect.push(q); queue.push(q); }
  }
  return { direct, indirect };
}

/** The most-linked clauses: the ones a change would ripple through. */
export function hubs(refs: Ref[], n = 3) {
  const deg = new Map<number, { pos: number; in: number; out: number }>();
  const at = (p: number) => deg.get(p) ?? deg.set(p, { pos: p, in: 0, out: 0 }).get(p)!;
  for (const r of refs) { at(r.from_position).out++; at(r.to_position).in++; }
  return [...deg.values()].sort((x, y) => y.in + y.out - (x.in + x.out) || x.pos - y.pos).slice(0, n);
}

/** Companies that sit in more than one contract: the dots that connect your contracts. */
export function sharedCompanies(links: { party: string; contract: string }[]) {
  const docs = new Map<string, Set<string>>();
  links.forEach((l) => docs.set(l.party, (docs.get(l.party) ?? new Set()).add(l.contract)));
  return [...docs].filter(([, d]) => d.size > 1).map(([p]) => p);
}
