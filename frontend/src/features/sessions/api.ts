import { api } from "@/lib/api";
import type { Attempt } from "@/features/ask/AnswerCard";
import type { Brief } from "@/features/ask/api";
import type { SearchResponse } from "@/features/search/api";

export interface SessionItem {
  id: string;
  kind: "ask" | "search";
  query: string;
  created_at: string;
  answer?: string; // ask: the first 200 characters
  sources?: number;
  results?: number; // search: how many clauses
}
export interface AskData { answer: string; sources: Brief[]; attempts: Attempt[] }
export type SessionFull = SessionItem & { data: AskData | SearchResponse };

export const listSessions = async () => (await api.get<SessionItem[]>("/sessions")).data;
export const getSession = async (id: string) => (await api.get<SessionFull>(`/sessions/${id}`)).data;
export const deleteSession = (id: string) => api.delete(`/sessions/${id}`);
