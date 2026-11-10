export interface Brief {
  document_id: string;
  filename: string;
  position: number;
  clause_identifier: string;
  title: string;
  page_number: number | null;
  vector_rank: number | null;
  keyword_rank: number | null;
  snippet?: string;
  content?: string; // the clause text the model saw (sources only)
  via?: string | null; // pulled in because this clause refers to it (the graph)
}

export type AskEvent =
  | { event: "retrieved"; query: string; mode: "hybrid" | "keyword"; note: string | null; scope?: string[]; contracts?: number; scope_reason?: string; hits: Brief[] }
  | { event: "graded"; relevant: number[]; reasons?: Record<string, string> } // positions in the last "retrieved" hits
  | { event: "clarify"; options: { id: string; filename: string; summary: string }[] } // the question does not say which contract
  | { event: "context"; used: number; limit: number } // an estimate of the tokens about to be sent to the answer model
  | { event: "full"; used: number; limit: number } // this session has no room left: start a new one
  | { event: "followups"; questions: string[] } // questions the user could ask next
  | { event: "facts"; text: string } // what the contract graph knows about the companies named
  | { event: "rewritten"; query: string }
  | { event: "sources"; sources: Brief[] }
  | { event: "token"; text: string }
  | { event: "done"; session_id: string | null; used: number; limit: number; full: boolean } // used: the session's context after this answer
  | { event: "error"; detail: string };

/** POST /ask and hand over each event as it arrives (one JSON object per line). axios can't stream in a browser, so fetch. */
export interface AskExtra { only?: string[]; anywhere?: boolean; sessionId?: string | null }
export async function ask(question: string, before: string[], extra: AskExtra, onEvent: (e: AskEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, before, only: extra.only, anywhere: extra.anywhere, session_id: extra.sessionId }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.filter(Boolean).forEach((l) => onEvent(JSON.parse(l)));
  }
}
