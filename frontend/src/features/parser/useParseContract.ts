import { useState } from "react";
import { parseContract } from "./api";
import type { ParseResult, Phase } from "./types";

export const MAX_MB = 25;

/** Upload → parse state machine for one contract at a time. */
export function useParseContract() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (f: File, message: string) => {
    setFile(f);
    setResult(null);
    setError(message);
    setPhase("error");
  };

  const start = async (f: File) => {
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"))
      return fail(f, "That file isn't a PDF. Choose a .pdf contract and try again.");
    if (f.size > MAX_MB * 1024 * 1024)
      return fail(f, `That PDF is over ${MAX_MB} MB. Split it or compress it and try again.`);

    setFile(f);
    setResult(null);
    setError(null);
    setUploadPct(0);
    setPhase("uploading");

    try {
      const data = await parseContract(f, (pct) => {
        setUploadPct(pct);
        if (pct >= 100) setPhase("parsing");
      });
      setResult(data);
      setPhase("done");
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message ?? "Something went wrong.");
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setResult(null);
    setError(null);
  };

  const busy = phase === "uploading" || phase === "parsing";

  return { phase, file, uploadPct, result, error, busy, start, reset };
}
