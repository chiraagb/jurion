import { api } from "@/lib/api";
import { llmHeaders } from "@/features/settings/llmConfig";
import type { ParseResult } from "./types";

/** forceLlm: ask the AI for the headings even when the local parse looks fine. */
export async function parseContract(file: File, onUploadPct: (pct: number) => void, forceLlm = false) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<ParseResult>("/parse", form, {
    headers: llmHeaders(),
    params: forceLlm ? { force_llm: true } : undefined,
    onUploadProgress: (e) => onUploadPct(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
  });
  return data;
}
