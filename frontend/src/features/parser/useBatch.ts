import { useState } from "react";
import { saveDocument } from "@/features/documents/api";
import { parseContract } from "./api";
import { MAX_MB } from "./useParseContract";

export interface BatchItem {
  name: string;
  status: "queued" | "parsing" | "saving" | "saved" | "duplicate" | "error";
  id?: string; // the saved contract, once saved (the row links to it)
  note?: string; // the error, the warning, or the clause count
}

/** Parses and saves several PDFs one after another (one at a time: each call embeds and builds the graph). */
export function useBatch() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const set = (i: number, p: Partial<BatchItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const run = async (files: File[]) => {
    setItems(files.map((f) => ({ name: f.name, status: "queued" })));
    setRunning(true);
    for (const [i, f] of files.entries()) {
      if (!f.name.toLowerCase().endsWith(".pdf")) { set(i, { status: "error", note: "Not a PDF." }); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { set(i, { status: "error", note: `Over ${MAX_MB} MB.` }); continue; }
      try {
        set(i, { status: "parsing" });
        const parsed = await parseContract(f, () => {});
        set(i, { status: "saving" });
        const saved = (await saveDocument(f, parsed)) as { id: string; warnings?: string[] };
        const warn = saved?.warnings?.join(" ");
        set(i, { status: "saved", id: saved.id, note: warn ? `Saved, but ${warn}` : `${parsed.clauses.length} clauses` });
      } catch (e: any) {
        if (e.response?.status === 409) set(i, { status: "duplicate", note: "Already saved." });
        else set(i, { status: "error", note: e.response?.data?.detail ?? e.message ?? "Failed." });
      }
    }
    setRunning(false);
  };

  return { items, running, run, clear: () => setItems([]) };
}
