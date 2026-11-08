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
  embedded_count: number;
  graph_parties: number | null; // null = graph not built
  graph_refs: number | null;
  created_at: string;
}

/** replace: the same file is already saved; swap that copy for this result. */
export async function saveDocument(file: File, result: ParseResult, replace = false) {
  const form = new FormData();
  form.append("file", file);
  const { method, total_ms, confidence, clauses } = result;
  form.append("result", JSON.stringify({ method, total_ms, confidence, clauses }));
  if (replace) form.append("replace", "true");
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

export const embedDocument = async (id: string) => (await api.post<{ embedded_count: number }>(`/documents/${id}/embed`)).data;

export const fetchPdf = async (id: string) => (await api.get<ArrayBuffer>(`/documents/${id}/pdf`, { responseType: "arraybuffer" })).data;

/** Where one clause sits on its pages (for the PDF highlight). Empty for scans and for contracts saved without line ranges. */
export const clauseBoxes = async (id: string, position: number) =>
  (await api.get<{ boxes: import("@/features/pdf/PdfViewer").Box[] }>(`/documents/${id}/clauses/${position}/boxes`)).data.boxes;

export interface GraphData {
  built: boolean;
  parties: { name: string; role: string; aliases: string[]; also_in: string[] }[];
  references: { from_position: number; from_id: string; from_title: string; to_position: number; to_id: string; to_title: string }[];
}
export const buildGraph = async (id: string) => (await api.post<{ parties: number; references: number }>(`/documents/${id}/graph`)).data;
export const getGraph = async (id: string) => (await api.get<GraphData>(`/documents/${id}/graph`)).data;
