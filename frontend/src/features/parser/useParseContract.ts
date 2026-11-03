import { useState } from "react";
import { parseContract } from "./api";
import type { ParseResult, Phase } from "./types";

export const MAX_MB = 25;

export type View = "local" | "ai";

/** The local result of a parse, rebuilt from the `local_result` the server sends along with an AI result. */
const localOf = (data: ParseResult): ParseResult | null =>
  data.method === "local"
    ? data
    : data.local_result
      ? { ...data, method: "local", clauses: data.local_result.clauses, confidence: data.local_result.confidence }
      : null;

/** Upload → parse state machine for one contract at a time. Keeps the local and the AI result so they can be compared. */
export function useParseContract() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [results, setResults] = useState<{ local: ParseResult | null; ai: ParseResult | null }>({ local: null, ai: null });
  const [view, setView] = useState<View>("local");
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const result = view === "ai" ? results.ai : results.local;

  const fail = (f: File, message: string) => {
    setFile(f);
    setResults({ local: null, ai: null });
    setError(message);
    setPhase("error");
  };

  const start = async (f: File) => {
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"))
      return fail(f, "That file isn't a PDF. Choose a .pdf contract and try again.");
    if (f.size > MAX_MB * 1024 * 1024)
      return fail(f, `That PDF is over ${MAX_MB} MB. Split it or compress it and try again.`);

    setFile(f);
    setResults({ local: null, ai: null });
    setAi({ busy: false, error: null });
    setError(null);
    setUploadPct(0);
    setPhase("uploading");

    try {
      const data = await parseContract(f, (pct) => {
        setUploadPct(pct);
        if (pct >= 100) setPhase("parsing");
      });
      // A low-confidence parse is upgraded to the AI automatically: then both results are available.
      setResults({ local: localOf(data), ai: data.method === "local" ? null : data });
      setView(data.method === "local" ? "local" : "ai");
      setPhase("done");
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message ?? "Something went wrong.");
      setPhase("error");
    }
  };

  /** "Parse with Gemini": re-run the same file with the AI picking the headings. Both results stay available. */
  const rerunWithAi = async () => {
    if (!file) return;
    setAi({ busy: true, error: null });
    try {
      const data = await parseContract(file, () => {}, true);
      if (data.method === "local") {
        setAi({ busy: false, error: "The AI did not return a usable result (it may be busy), so only the local result is available. Try again in a minute." });
        return;
      }
      setResults((r) => ({ local: r.local ?? localOf(data), ai: data }));
      setView("ai");
      setAi({ busy: false, error: null });
    } catch (err: any) {
      setAi({ busy: false, error: err.response?.data?.detail ?? err.message ?? "Something went wrong." });
    }
  };

  const reset = () => {
    setAi({ busy: false, error: null });
    setPhase("idle");
    setFile(null);
    setResults({ local: null, ai: null });
    setView("local");
    setError(null);
  };

  const busy = phase === "uploading" || phase === "parsing";

  return { phase, file, uploadPct, result, results, view, setView, error, busy, start, reset, ai, rerunWithAi };
}
