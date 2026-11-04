import { Fragment, useEffect, useState } from "react";
import { Check, Loader2, Send, X } from "lucide-react";
import { Link, navigate } from "@/lib/router";
import { ask, type AskEvent, type Brief } from "./api";

interface Attempt {
  query: string;
  mode: "hybrid" | "keyword";
  note: string | null;
  hits: Brief[];
  relevant: number[] | null; // null until graded
}
const EXAMPLES = ["Who can terminate and with how much notice?", "What are the payment terms?", "Which law governs the agreement?"];
const STAGE = { search: "Searching your contracts…", grade: "Checking which clauses are relevant…", rewrite: "Nothing relevant yet, rewriting the question…", write: "Writing the answer…" };

const link = (s: Brief) => `/contracts/${s.document_id}${s.page_number ? `?page=${s.page_number}` : ""}`;

export default function AskPage({ q: urlQuestion }: { q: string }) {
  const [text, setText] = useState(urlQuestion); // the question lives in the URL: /ask?q=...
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sources, setSources] = useState<Brief[]>([]);
  const [answer, setAnswer] = useState("");
  const [stage, setStage] = useState<keyof typeof STAGE | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(urlQuestion);
    setAttempts([]);
    setSources([]);
    setAnswer("");
    setError(null);
    if (urlQuestion.trim().length < 3) return setStage(null);
    const ctl = new AbortController();
    setStage("search");
    const on = (e: AskEvent) => {
      if (e.event === "retrieved") { setAttempts((a) => [...a, { query: e.query, mode: e.mode, note: e.note, hits: e.hits, relevant: null }]); setStage("grade"); }
      else if (e.event === "graded") setAttempts((a) => a.map((x, i) => (i === a.length - 1 ? { ...x, relevant: e.relevant } : x)));
      else if (e.event === "rewritten") setStage("rewrite");
      else if (e.event === "sources") setSources(e.sources);
      else if (e.event === "token") { setStage("write"); setAnswer((t) => t + e.text); }
      else if (e.event === "done") setStage(null);
      else if (e.event === "error") { setError(e.detail); setStage(null); }
    };
    ask(urlQuestion.trim(), on, ctl.signal).catch((e) => {
      if (ctl.signal.aborted) return;
      setError(e.message);
      setStage(null);
    });
    return () => ctl.abort();
  }, [urlQuestion]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (q.length >= 3) navigate(`/ask?q=${encodeURIComponent(q)}`);
  };
  const busy = stage !== null;

  return (
    <section aria-labelledby="ask-title" className="space-y-6">
      <div>
        <p className="caption mb-3">Answers from your contracts, with citations</p>
        <h1 id="ask-title" className="font-display text-4xl font-semibold tracking-tight">Ask</h1>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="ask-q" className="sr-only">Your question</label>
        <input
          id="ask-q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="e.g. Can the customer cancel early, and who pays?"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          disabled={busy || text.trim().length < 3}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-5 py-3 font-semibold text-canvas transition-opacity duration-200 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          Ask
        </button>
      </form>

      {!urlQuestion && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((x) => (
            <Link key={x} to={`/ask?q=${encodeURIComponent(x)}`} className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors duration-200 hover:border-line-strong hover:text-fg">
              {x}
            </Link>
          ))}
        </div>
      )}

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {stage && <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{STAGE[stage]}</p>}

      {(answer || sources.length > 0) && (
        <div className="space-y-4 rounded-md border border-line bg-surface p-5">
          <p className="whitespace-pre-wrap font-display text-lg leading-relaxed text-fg" aria-live="polite">
            {answer.split(/(\[\d+\])/g).map((part, i) => {
              const s = /^\[(\d+)\]$/.exec(part) && sources[Number(part.slice(1, -1)) - 1];
              return s ? (
                <Link key={i} to={link(s)} title={`${s.filename}, clause ${s.clause_identifier}`} className="mx-0.5 rounded bg-accent/10 px-1 font-mono text-xs text-accent-fg hover:bg-accent/20">
                  {part.slice(1, -1)}
                </Link>
              ) : <Fragment key={i}>{part}</Fragment>;
            })}
          </p>
          {sources.length > 0 && (
            <ol className="space-y-2 border-t border-line pt-4">
              {sources.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 font-mono text-xs text-accent-fg">{i + 1}</span>
                  <Link to={link(s)} className="min-w-0 hover:underline">
                    <span className="font-semibold text-fg">{s.clause_identifier} {s.title}</span>
                    <span className="text-muted"> · {s.filename}{s.page_number ? ` · p.${s.page_number}` : ""}</span>
                    {s.snippet && <span className="line-clamp-2 block text-fg-soft">{s.snippet}</span>}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {attempts.length > 0 && <Trace attempts={attempts} />}
    </section>
  );
}

/** "How I got this": what was retrieved, which clauses passed the relevance check, and whether the question was rewritten. */
function Trace({ attempts }: { attempts: Attempt[] }) {
  return (
    <details className="rounded-md border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">How I got this answer</summary>
      <div className="space-y-5 border-t border-line p-5">
        {attempts.map((a, n) => (
          <div key={n}>
            <p className="text-sm">
              <span className="font-semibold">{n === 0 ? "Searched for" : "Rewrote the question and searched for"}</span> “{a.query}”
              <span className="text-muted"> · {a.mode === "hybrid" ? "vector + keyword" : "keyword only"} · {a.hits.length} clauses retrieved</span>
            </p>
            {a.note && <p className="mt-1 text-xs text-muted">{a.note}</p>}
            <ul className="mt-2 space-y-1">
              {a.hits.map((h, i) => {
                const ok = a.relevant?.includes(i);
                return (
                  <li key={i} className={`flex items-center gap-2 text-sm ${ok ? "text-fg" : "text-muted"}`}>
                    {a.relevant === null ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : ok ? <Check className="h-3.5 w-3.5 text-accent" aria-label="relevant" /> : <X className="h-3.5 w-3.5" aria-label="not relevant" />}
                    <span className="font-mono text-xs">{h.clause_identifier}</span>
                    <span className="min-w-0 truncate">{h.title}</span>
                    <span className="shrink-0 text-xs text-subtle">{h.filename}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
