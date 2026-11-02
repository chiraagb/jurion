import { api } from "@/lib/api";
import { llmHeaders } from "@/features/settings/llmConfig";
import type { ParseResult } from "./types";

export async function parseContract(file: File, onUploadPct: (pct: number) => void) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<ParseResult>("/parse", form, {
    headers: llmHeaders(),
    onUploadProgress: (e) => onUploadPct(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
  });
  return data;
}
