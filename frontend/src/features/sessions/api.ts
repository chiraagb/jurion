import { api } from "@/lib/api";
import type { Attempt } from "@/features/ask/AnswerCard";
import type { Brief } from "@/features/ask/api";
import type { SearchResponse } from "@/features/search/api";

export interface SessionItem {
  id: string;
  kind: "chat" | "search";
  query: string; // the first question
  created_at: string;
  turns?: number; // chat
  used?: number; // chat: estimated tokens of context used
  limit?: number;
  results?: number; // search: how many clauses
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
}
export type SessionFull = SessionItem & { data: { turns: StoredTurn[] } | SearchResponse };

export const listSessions = async () => (await api.get<SessionItem[]>("/sessions")).data;
export const getSession = async (id: string) => (await api.get<SessionFull>(`/sessions/${id}`)).data;
export const deleteSession = (id: string) => api.delete(`/sessions/${id}`);
export const renameSession = async (id: string, title: string) => (await api.patch<SessionItem>(`/sessions/${id}`, { title })).data;
