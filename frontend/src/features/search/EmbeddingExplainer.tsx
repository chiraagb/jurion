import { ArrowRight, ArrowDown } from "lucide-react";
import type { ReactNode } from "react";

// A made-up 8-number head, only to draw bars. Real ones are on each clause of a saved contract.
const BARS = [0.42, -0.18, 0.77, 0.05, -0.61, 0.33, -0.09, 0.52];

// Illustrative 2D positions: clauses about the same thing sit close together. Real vectors have 1536 dimensions.
const POINTS = [
  { x: 70, y: 50, label: "Termination", g: 0 },
  { x: 105, y: 78, label: "Notice period", g: 0 },
  { x: 55, y: 95, label: "Cancellation fee", g: 0 },
  { x: 250, y: 60, label: "Payment terms", g: 1 },
  { x: 285, y: 95, label: "Invoices", g: 1 },
  { x: 160, y: 150, label: "Governing law", g: 2 },
  { x: 200, y: 175, label: "Jurisdiction", g: 2 },
];
const Q = { x: 88, y: 68 }; // "who pays if the project is cancelled early?"

export default function EmbeddingExplainer({ open }: { open: boolean }) {
  return (
    <details open={open} className="rounded-md border border-line bg-surface">
      <summary className="cursor-pointer list-none px-5 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        How embeddings work here
      </summary>
      <div className="space-y-8 border-t border-line p-5">
        <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-start">
          <Step n={1} title="A clause">
            <p className="font-display text-sm leading-snug text-fg-soft">
              <b>9.2 TERMINATION</b>
              <br />
              Either party may terminate this agreement with thirty days written notice…
            </p>
          </Step>
          <Arrow />
          <Step n={2} title="Build the text">
            <code className="block whitespace-pre-wrap font-mono text-xs text-fg-soft">{"<id> <title>\n<content>"}</code>
            <p className="mt-2 text-xs text-muted">Cut at 8,000 characters (about 2k tokens).</p>
          </Step>
          <Arrow />
          <Step n={3} title="OpenAI model">
            <p className="text-xs text-muted">
              <code className="font-mono text-fg-soft">text-embedding-3-small</code> reads the meaning and returns <b>1,536 numbers</b>.
            </p>
            <div className="mt-2 flex h-10 items-center gap-0.5" aria-hidden>
              {BARS.map((v, i) => (
                <span key={i} className="flex h-full w-3 flex-col justify-center">
                  <span className={`block w-full ${v >= 0 ? "bg-accent" : "bg-danger"}`} style={{ height: `${Math.abs(v) * 100}%` }} />
                </span>
              ))}
              <span className="ml-1 font-mono text-xs text-subtle">… ×1536</span>
            </div>
          </Step>
          <Arrow />
          <Step n={4} title="Stored in Postgres">
            <code className="font-mono text-xs text-fg-soft">clauses.embedding vector(1536)</code>
            <p className="mt-2 text-xs text-muted">One vector per clause, next to its text.</p>
          </Step>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Why it finds clauses with different words</h3>
            <svg viewBox="0 0 340 200" className="w-full rounded-md border border-line bg-canvas" role="img"
              aria-label="Illustrative map: the question about cancelling early lands next to the termination clauses, far from payment and governing law clauses.">
              {POINTS.map((p) => (
                <g key={p.label}>
                  <circle cx={p.x} cy={p.y} r="5" className={["fill-accent", "fill-muted", "fill-subtle"][p.g]} />
                  <text x={p.x + 9} y={p.y + 4} className="fill-fg-soft text-[10px]">{p.label}</text>
                </g>
              ))}
              <line x1={Q.x} y1={Q.y} x2={70} y2={50} className="stroke-accent" strokeDasharray="3 3" />
              <line x1={Q.x} y1={Q.y} x2={105} y2={78} className="stroke-accent" strokeDasharray="3 3" />
              <path d={`M${Q.x} ${Q.y - 8} l2.4 5 5.4 .8 -4 3.8 1 5.4 -4.8 -2.6 -4.8 2.6 1 -5.4 -4 -3.8 5.4 -.8z`} className="fill-danger" />
              <text x={Q.x + 10} y={Q.y - 8} className="fill-danger text-[10px] font-semibold">your question</text>
            </svg>
            <p className="mt-2 text-xs text-muted">
              Made-up positions to explain the idea; your real vectors are plotted below. “Cancelled early” shares no words with “terminate”, but its vector lands beside them.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">What happens when you search</h3>
            <ol className="space-y-2 text-sm text-fg-soft">
              <Li n={1}>Your question is embedded the same way (one OpenAI call).</Li>
              <Li n={2}>
                <b>Vector list:</b> the 20 clauses whose vectors point the same way (cosine similarity).
              </Li>
              <Li n={3}>
                <b>Keyword list:</b> the 20 clauses with the best Postgres full-text match.
              </Li>
              <Li n={4}>
                <b>Merge:</b> each clause scores <code className="font-mono text-xs">1/(60+rank)</code> per list it appears in; a clause in both rises to the top.
              </Li>
            </ol>
            <p className="mt-3 text-xs text-muted">Vectors catch meaning; keywords catch exact terms like names and clause numbers. Each result card shows both ranks.</p>
          </div>
        </div>
      </div>
    </details>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/10 font-mono text-xs text-accent-fg">{n}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

const Arrow = () => (
  <span className="grid shrink-0 place-items-center self-center text-subtle" aria-hidden>
    <ArrowRight className="hidden h-4 w-4 lg:block" />
    <ArrowDown className="h-4 w-4 lg:hidden" />
  </span>
);

const Li = ({ n, children }: { n: number; children: ReactNode }) => (
  <li className="flex gap-2">
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 font-mono text-xs text-accent-fg">{n}</span>
    <span>{children}</span>
  </li>
);
