import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { clauseBoxes, fetchPdf } from "@/features/documents/api";
import LazyPdfViewer from "@/features/pdf/LazyPdfViewer";
import type { Box } from "@/features/pdf/PdfViewer";
import { Link } from "@/lib/router";

/** Enough to find one clause: which contract, which clause, which page (and the text, when the result carried it). */
export interface ClauseRef {
  document_id: string;
  filename: string;
  position: number; // the clause's index in the contract
  clause_identifier: string;
  title: string;
  page_number: number | null;
  content?: string;
  snippet?: string;
}

/** The contract screen scrolled to that clause, opened and highlighted, with the PDF on its page. */
export const clauseHref = (c: ClauseRef) =>
  `/contracts/${c.document_id}?${c.page_number ? `page=${c.page_number}&` : ""}clause=${c.position}`;

/** A side drawer: the cited clause in its PDF page plus its full text, without leaving the answer, search or comparison. */
export default function ClausePanel({ clause: c, onClose }: { clause: ClauseRef | null; onClose: () => void }) {
  useEffect(() => {
    if (!c) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [c, onClose]);
  if (!c) return null;
  return (
    <aside
      role="dialog"
      aria-label={`Clause ${c.clause_identifier} ${c.title}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[min(38rem,100vw)] flex-col border-l border-line-strong bg-surface shadow-2xl"
    >
      <header className="flex items-start gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-xs font-medium text-accent-fg">{c.clause_identifier}</span>
            <span className="truncate font-display text-lg font-semibold">{c.title}</span>
          </p>
          <p className="mt-1 truncate text-sm text-muted">{c.filename}{c.page_number ? ` · p.${c.page_number}` : ""}</p>
        </div>
        <Link to={clauseHref(c)} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 py-1.5 text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Jump to clause
        </Link>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="h-[48%] shrink-0 border-b border-line"><PanelPdf key={`${c.document_id}-${c.position}`} c={c} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-subtle">Clause text</p>
        <p className="whitespace-pre-wrap font-display text-base leading-relaxed text-fg-soft">{c.content ?? c.snippet ?? "(text not stored with this result)"}</p>
      </div>
    </aside>
  );
}

/** The clause's page with the clause shaded. Remounts per clause, so the page and the highlight reset with it. */
function PanelPdf({ c }: { c: ClauseRef }) {
  const [page, setPage] = useState(c.page_number ?? 1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    let stale = false;
    clauseBoxes(c.document_id, c.position).then((b) => {
      if (stale) return;
      setBoxes(b);
      if (b.length && !b.some((x) => x.page === page)) setPage(b[0].page); // the clause starts on a different page than the result said
    }).catch(() => {}); // no highlight is fine: the page still shows
    return () => { stale = true; };
  }, [c.document_id, c.position]);
  return <LazyPdfViewer docKey={c.document_id} getData={() => fetchPdf(c.document_id)} page={page} onPage={setPage} boxes={boxes} />;
}
