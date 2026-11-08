import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface Setup { loading: boolean; failed: boolean; contracts: number; hasKey: boolean }

/** What a first-time user is missing: an OpenAI key (embeddings and answers) and at least one saved contract. Re-checked when the
 *  page comes back into view, when keys change, and when `refreshOn` changes (e.g. the Ask tab is shown again). */
export function useSetup(refreshOn?: unknown): Setup {
  const [s, setS] = useState<Setup>({ loading: true, failed: false, contracts: 0, hasKey: false });
  const load = useCallback(async () => {
    try {
      const [docs, keys] = await Promise.all([
        api.get<unknown[]>("/documents"),
        api.get<{ keys: Record<string, string>; server_openai?: boolean }>("/settings/llm"),
      ]);
      setS({ loading: false, failed: false, contracts: docs.data.length, hasKey: !!keys.data.keys.openai || !!keys.data.server_openai });
    } catch {
      setS((x) => ({ ...x, loading: false, failed: true })); // an API problem must not lock the user out: the page then behaves as before
    }
  }, []);
  useEffect(() => { load(); }, [load, refreshOn]);
  useEffect(() => {
    addEventListener("jurion:keys-changed", load);
    addEventListener("focus", load);
    return () => { removeEventListener("jurion:keys-changed", load); removeEventListener("focus", load); };
  }, [load]);
  return s;
}

export const openSettings = () => dispatchEvent(new Event("jurion:open-settings"));
