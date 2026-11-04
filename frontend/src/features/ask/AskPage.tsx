import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import ClausePanel, { type ClauseRef } from "@/features/clause/ClausePanel";
import { Link, navigate } from "@/lib/router";
import { AnswerCard, Trace, type Attempt } from "./AnswerCard";
import { ask, type AskEvent, type Brief } from "./api";

const EXAMPLES = ["Who can terminate and with how much notice?", "What are the payment terms?", "Which law governs the agreement?"];
const STAGE = { search: "Searching your contracts…", grade: "Checking which clauses are relevant…", rewrite: "Nothing relevant yet, rewriting the question…", write: "Writing the answer…" };

export default function AskPage({ q: urlQuestion }: { q: string }) {
  const [text, setText] = useState(urlQuestion); // the question lives in the URL: /ask?q=...
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sources, setSources] = useState<Brief[]>([]);
  const [answer, setAnswer] = useState("");
  const [stage, setStage] = useState<keyof typeof STAGE | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null); // this run's session id, once stored
  const [picked, setPicked] = useState<ClauseRef | null>(null);

  useEffect(() => {
    setText(urlQuestion);
    setAttempts([]);
    setSources([]);
    setAnswer("");
    setError(null);
    setSaved(null);
    setPicked(null);
    if (urlQuestion.trim().length < 3) return setStage(null);
    const ctl = new AbortController();
    setStage("search");
    const on = (e: AskEvent) => {
      if (e.event === "retrieved") { setAttempts((a) => [...a, { query: e.query, mode: e.mode, note: e.note, hits: e.hits, relevant: null }]); setStage("grade"); }
      else if (e.event === "graded") setAttempts((a) => a.map((x, i) => (i === a.length - 1 ? { ...x, relevant: e.relevant } : x)));
      else if (e.event === "rewritten") setStage("rewrite");
      else if (e.event === "sources") setSources(e.sources);
      else if (e.event === "token") { setStage("write"); setAnswer((t) => t + e.text); }
      else if (e.event === "done") { setStage(null); setSaved(e.session_id); }
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

      {(answer || sources.length > 0) && <AnswerCard answer={answer} sources={sources} onPick={setPicked} />}
      {saved && (
        <p className="text-sm text-muted">
          Saved to <Link to={`/sessions/${saved}`} className="underline">History</Link>, where you can compare it with other questions.
        </p>
      )}

      {attempts.length > 0 && <Trace attempts={attempts} onPick={setPicked} />}
      <ClausePanel clause={picked} onClose={() => setPicked(null)} />
    </section>
  );
}
