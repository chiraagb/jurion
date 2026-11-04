import { api } from "@/lib/api";

export interface Hit {
  document_id: string;
  filename: string;
  position: number;
  clause_identifier: string;
  title: string;
  snippet: string;
  page_number: number | null;
  vector_rank: number | null;
  vector_similarity: number | null;
  keyword_rank: number | null;
  score: number;
}

export interface SearchResponse {
  mode: "hybrid" | "keyword";
  note: string | null;
  model: string;
  results: Hit[];
}

export const search = async (query: string) => (await api.post<SearchResponse>("/search", { query })).data;

export interface MapPoint {
  document_id: string;
  filename: string;
  position: number;
  clause_identifier: string;
  title: string;
  page_number: number | null;
  x: number; // -1..1 after squashing 1536 numbers to 3 (PCA)
  y: number;
  z: number;
  similarity: number | null; // true cosine to the question, in all 1536 dimensions
}

export interface EmbeddingMapData {
  points: MapPoint[];
  query: { x: number; y: number; z: number; text: string } | null;
  explained: [number, number, number]; // share of the variation each axis keeps
  dims: number;
}

export const embeddingMap = async (documentId: string | null, query: string | null) =>
  (await api.post<EmbeddingMapData>("/embeddings/map", { document_id: documentId, query })).data;
