import { api } from "@/lib/api";
import type { Confidence, ParseResult } from "@/features/parser/types";

export interface DocSummary {
  id: string;
  filename: string;
  size_bytes: number;
  pages: number;
  method: ParseResult["method"];
  confidence: Confidence | null;
  clause_count: number;
  created_at: string;
}

export async function saveDocument(file: File, result: ParseResult) {
  const form = new FormData();
  form.append("file", file);
  const { method, total_ms, confidence, clauses } = result;
  form.append("result", JSON.stringify({ method, total_ms, confidence, clauses }));
  return (await api.post<DocSummary>("/documents", form)).data;
}

export const listDocuments = async () => (await api.get<DocSummary[]>("/documents")).data;

export const deleteDocument = (id: string) => api.delete(`/documents/${id}`);

/** A saved contract as the same ParseResult + File that ResultsView already renders. */
export async function openDocument(id: string): Promise<{ result: ParseResult; file: File }> {
  const [{ data: doc }, { data: pdf }] = await Promise.all([
    api.get(`/documents/${id}`),
    api.get<Blob>(`/documents/${id}/pdf`, { responseType: "blob" }),
  ]);
  return {
    file: new File([pdf], doc.filename, { type: "application/pdf" }),
    result: { ...doc, steps: [] },
  };
}
