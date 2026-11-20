type Score = { "hit@1": number; "hit@10": number; n: number };
type Summary = Record<string, Partial<Record<string, Score>>>;

const GROUPS = [
  ["all", "All questions"],
  ["direct", "Same words"],
  ["paraphrase", "Other words"],
  ["broad", "Whole section"],
  ["graph", "Names a party"],
  ["multi", "Needs two clauses"],
] as const;
const pts = (a: number, b: number) => Math.round((b - a) * 100);
const signed = (d: number) => (d > 0 ? `+${d}` : `${d}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** What the reranker changed, per question type, against plain hybrid search on the same questions. Wins and losses are
 *  stated the same way: the group the reranker was meant to fix ("other words") is called out whatever it shows. */
export default function RerankEffect({ summary }: { summary: Summary }) {
  const rows = GROUPS.flatMap(([id, label]) => {
    const h = summary[id]?.hybrid, r = summary[id]?.rerank;
    return h && r ? [{ id, label, h, r, top1: pts(h["hit@1"], r["hit@1"]), top10: pts(h["hit@10"], r["hit@10"]) }] : [];
  });
  if (!rows.length) return null;
  const para = rows.find((x) => x.id === "paraphrase");
  const all = rows.find((x) => x.id === "all");

  return (
    <div className="rounded-md border border-line p-5">
      <p className="font-semibold">Reranker (bge-reranker-v2-m3): does re-scoring the top 30 help?</p>
      <p className="mt-1 text-fg-soft">
        A cross-encoder reads the question and each clause together and re-orders hybrid's results.
        {all && <> Over all questions the right clause is in the top 10 <b>{pct(all.h["hit@10"])} → {pct(all.r["hit@10"])}</b>, and #1 <b>{pct(all.h["hit@1"])} → {pct(all.r["hit@1"])}</b>.</>}
        {para && (
          <> It was added for questions in other words, where the change is <b>{signed(para.top10)} points</b> in the top 10 and <b>{signed(para.top1)}</b> at #1
            {Math.abs(para.top10) < 5 ? <>: below the 5 points it had to gain, so it is off by default. Most of those misses never reach the top 30, and a reranker can only re-order what search found.</> : "."}</>
        )}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="text-left text-muted">
            <tr><th className="py-1 pr-3 font-normal">Question type</th><th className="py-1 pr-3 font-normal">#1: hybrid → reranked</th><th className="py-1 pr-3 font-normal">Top 10: hybrid → reranked</th></tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className="border-t border-line">
                <td className="py-1.5 pr-3">{x.label} <span className="font-mono text-xs text-subtle">({x.h.n})</span></td>
                {([["hit@1", x.top1], ["hit@10", x.top10]] as const).map(([k, d]) => (
                  <td key={k} className="py-1.5 pr-3 tabular-nums">
                    {pct(x.h[k])} → {pct(x.r[k])}{" "}
                    <span className={d > 0 ? "text-accent-fg" : d < 0 ? "text-danger" : "text-muted"}>({d > 0 ? "▲" : d < 0 ? "▼" : "="} {signed(d)})</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Small groups move a lot per question: in a group of 6, one question is 17 points. Switch it on for your account in Settings.</p>
    </div>
  );
}
