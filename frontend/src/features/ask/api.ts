import { api } from "@/lib/api";

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

export type AskMode = "agent" | "workflow";
/** One thing the agent did: a tool call, why, and what came back (full hits only while streaming). */
export interface AgentStep { n: number; tool: string; args: Record<string, unknown>; reason: string; observation: string; ms: number; hits?: Brief[] }
/** What an answer cost, from the server: LLM calls (embeddings not counted), tokens, wall time. */
export interface Stats { mode: AskMode; llm_calls: number; tokens: number; ms: number; steps?: number; tool_calls?: number; stop?: string; model?: string }
export interface ModelInfo { id: string; provider: string; available: boolean }
export interface Models { default: string; default_mode: AskMode; models: ModelInfo[] }

export type AskEvent =
  | { event: "retrieved"; query: string; mode: "hybrid" | "keyword"; note: string | null; scope?: string[]; contracts?: number; scope_reason?: string; hits: Brief[] }
  | { event: "graded"; relevant: number[]; reasons?: Record<string, string> } // positions in the last "retrieved" hits
  | { event: "clarify"; options: { id: string; filename: string; summary: string }[] } // the question does not say which contract
  | { event: "context"; used: number; limit: number } // an estimate of the tokens about to be sent to the answer model
  | { event: "full"; used: number; limit: number } // this session has no room left: start a new one
  | { event: "followups"; questions: string[] } // questions the user could ask next
  | { event: "facts"; text: string } // what the contract graph knows about the companies named
  | { event: "rewritten"; query: string }
  | { event: "step" } & AgentStep // agent mode: one tool call
  | { event: "fallback"; reason: string } // the agent could not run: the standard search answered
  | { event: "budget"; steps: number; tool_calls: number; tokens: number; hit: string } // the agent stopped at a limit and answered with what it had
  | ({ event: "stats" } & Stats)
  | { event: "sources"; sources: Brief[] }
  | { event: "token"; text: string }
  | { event: "done"; session_id: string | null; used: number; limit: number; full: boolean } // used: the session's context after this answer
  | { event: "error"; detail: string };

/** POST /ask and hand over each event as it arrives (one JSON object per line). axios can't stream in a browser, so fetch. */
export interface AskExtra { only?: string[]; anywhere?: boolean; sessionId?: string | null; mode?: AskMode; model?: string }
export const ask = (question: string, before: string[], extra: AskExtra, onEvent: (e: AskEvent) => void, signal: AbortSignal) =>
  stream("/api/ask", { question, before, only: extra.only, anywhere: extra.anywhere, session_id: extra.sessionId, mode: extra.mode, model: extra.model }, onEvent, signal);

/** Workflow and agent answer the same question at once. Events say which `system` they belong to; `compared` ends the stream. Not saved to the chat. */
export type CompareEvent = (AskEvent & { system?: AskMode }) | { event: "compared"; session_id?: string | null; same_clauses: number; only_agent: [string, number][]; only_workflow: [string, number][]; system?: undefined };
export const askCompare = (question: string, extra: AskExtra, onEvent: (e: CompareEvent) => void, signal: AbortSignal) =>
  stream("/api/ask/compare", { question, model: extra.model }, onEvent, signal);

export const getModels = async () => (await api.get<Models>("/ask/models")).data;

async function stream<E>(url: string, payload: object, onEvent: (e: E) => void, signal: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
