import { api } from "@/lib/api";
import type { Attempt } from "@/features/ask/AnswerCard";
import type { Brief } from "@/features/ask/api";
import type { SearchResponse } from "@/features/search/api";

export interface SessionItem {
  id: string;
  kind: "chat" | "search" | "compare"; // compare: one question answered by the workflow and the agent side by side
  query: string; // the first question
  created_at: string;
  turns?: number; // chat
  used?: number; // chat: estimated tokens of context used
  limit?: number;
  results?: number; // search: how many clauses
  compared?: boolean; // compare
}
export interface StoredTurn {
  question: string;
  answer: string;
  sources: Brief[];
  attempts: Attempt[];
  clarify: boolean;
  clarify_options?: { id: string; filename: string; summary: string }[] | null;
  followups?: string[];
  facts?: string;
  mode?: "agent" | "workflow"; // missing on chats from before agent mode: those were the workflow
  steps?: import("../ask/api").AgentStep[];
  stats?: import("../ask/api").Stats;
  fallback?: string;
  budget?: { hit: string };
}
export interface StoredSide { answer: string; sources: Brief[]; steps: import("../ask/api").AgentStep[]; stats?: import("../ask/api").Stats; fallback?: string; budget?: { hit: string }; error?: string }
export interface StoredCompare { question: string; workflow: StoredSide; agent: StoredSide; compared: { same_clauses: number; only_agent: [string, number][]; only_workflow: [string, number][] } }
export type SessionFull = SessionItem & { data: { turns: StoredTurn[] } | SearchResponse | StoredCompare };
/** Where a session opens: a chat in Ask, a comparison on its own page. */
export const sessionHref = (s: Pick<SessionItem, "id" | "kind">) => (s.kind === "compare" ? `/sessions/${s.id}` : `/ask?s=${s.id}`);

export const listSessions = async () => (await api.get<SessionItem[]>("/sessions")).data;
export const getSession = async (id: string) => (await api.get<SessionFull>(`/sessions/${id}`)).data;
export const deleteSession = (id: string) => api.delete(`/sessions/${id}`);
export const renameSession = async (id: string, title: string) => (await api.patch<SessionItem>(`/sessions/${id}`, { title })).data;
