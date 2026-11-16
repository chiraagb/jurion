import { api } from "@/lib/api";

export type Provider = "gemini" | "openai"; // the PDF-reading fallback choices
export type KeyProvider = Provider | "anthropic"; // a key can also be saved for the Ask agent's model (Anthropic)

const PROVIDER_KEY = "jurion.provider";

/** The chosen fallback provider is not a secret, so it lives in the browser; the keys live in Postgres. */
export function loadProvider(): Provider {
  try {
    return localStorage.getItem(PROVIDER_KEY) === "openai" ? "openai" : "gemini";
  } catch {
    return "gemini";
  }
}

export function saveProvider(provider: Provider) {
  try {
    localStorage.setItem(PROVIDER_KEY, provider);
  } catch {
    /* blocked storage: falls back to Gemini */
  }
}

export const llmHeaders = () => ({ "X-LLM-Provider": loadProvider() });

/** Masked hints of saved keys, e.g. { openai: "sk-…a1b2" }. The real keys are never sent back. */
export const fetchKeyHints = async () => (await api.get<{ keys: Partial<Record<KeyProvider, string>> }>("/settings/llm")).data.keys;
export const saveKey = (provider: KeyProvider, apiKey: string) => api.put(`/settings/llm/${provider}`, { api_key: apiKey });
export const removeKey = (provider: KeyProvider) => api.delete(`/settings/llm/${provider}`);
