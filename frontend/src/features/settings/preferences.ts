import { api } from "@/lib/api";

/** Optional steps of Search and Ask, saved on the signed-in user's account (GET/PUT /settings/preferences). */
export interface Preferences {
  rerank: boolean;
  followups: boolean;
  widen: boolean;
  facts: boolean;
}
export interface PreferencesState {
  preferences: Preferences;
  rerank_unavailable: string | null; // why the reranker cannot run on this server, else null
}

export const PREFERENCES: { id: keyof Preferences; label: string; detail: string }[] = [
  {
    id: "rerank",
    label: "Reranker",
    detail: "Re-scores the top 30 search results with a local model (bge-reranker-v2-m3) that reads the question and each clause together. Adds about 1.5 s per search.",
  },
  {
    id: "followups",
    label: "Follow-up suggestions",
    detail: "Suggests questions to ask next under each answer. One extra model call per answer.",
  },
  {
    id: "widen",
    label: "Graph widening",
    detail: "Also brings in the clauses a cited clause refers to (“subject to Section 8”), from the contract graph.",
  },
  {
    id: "facts",
    label: "Company facts",
    detail: "Adds what the contract graph knows about the companies a question names: their roles and their contracts.",
  },
];

export const getPreferences = async () => (await api.get<PreferencesState>("/settings/preferences")).data;
export const savePreferences = async (p: Partial<Preferences>) =>
  (await api.put<PreferencesState>("/settings/preferences", p)).data;
