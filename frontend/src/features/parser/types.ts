export interface Clause {
  clause_identifier: string;
  title: string;
  content: string;
  page_number?: number;
  parent_identifier?: string | null;
  start_line?: number; // [start_line, end_line) in the stored full text; absent for scans and old contracts
  end_line?: number;
}

export interface Confidence {
  score: number;
  coverage: number;
  numbering: number;
  titled: number;
  unique?: number;
  balanced?: number; // absent on contracts saved before this check existed
  issues?: string[];
}

export interface ParseResult {
  filename: string;
  size_bytes: number;
  pages: number;
  total_ms: number;
  method: "local" | "gemini" | "openai";
  clauses: Clause[];
  confidence: Confidence | null;
  local_result?: { clauses: Clause[]; confidence: Confidence | null }; // sent with an AI result, for comparison
  steps: { name: "local" | "llm"; status: "done" | "skipped" | "insufficient" | "failed"; ms: number; provider?: string }[];
}

export type Phase = "idle" | "uploading" | "parsing" | "done" | "error";
