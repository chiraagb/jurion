import { useEffect, useState } from "react";
import {
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
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

/** The clause's number as a person would say it. Unnumbered headings carry an internal id ("SEC_(WITH_INSTITUTI"): those show no number. */
export const niceId = (id: string) =>
  id.startsWith("SEC_")
    ? ""
    : id === "PREAMBLE"
      ? "Preamble"
      : id === "SIGNATURES"
        ? "Signatures"
        : id;

/** The contract screen scrolled to that clause, opened and highlighted, with the PDF on its page. */
export const clauseHref = (c: ClauseRef) =>
  `/contracts/${c.document_id}?${c.page_number ? `page=${c.page_number}&` : ""}clause=${c.position}`;

export interface ViewerNav {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

/** The cited clause in its PDF page, plus its full text. Embeddable: the Ask page docks it beside the answer. */
type View = "both" | "pdf" | "text";
const SIZES = ["text-base", "text-lg", "text-xl", "text-2xl"]; // clause text sizes
const SIZE_KEY = "jurion.text.step";
const readSize = () => {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return Number.isInteger(n) && n >= 0 && n < SIZES.length ? n : 1;
  } catch {
    return 1;
  }
};

/** The cited clause in its PDF page, plus its full text. Embeddable: the Ask page docks it beside the answer.
 *  Wide enough, the page and the text sit side by side; otherwise they stack. Either can fill the whole pane. */
export function ClauseViewer({
  clause: c,
  onClose,
  nav,
  expanded,
  onExpand,
}: {
  clause: ClauseRef;
  onClose: () => void;
  nav?: ViewerNav;
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const [view, setView] = useState<View>("both");
  const [size, setSize] = useState(readSize);
  const bump = (d: number) =>
    setSize((n) => {
      const m = Math.min(SIZES.length - 1, Math.max(0, n + d));
      try {
        localStorage.setItem(SIZE_KEY, String(m));
      } catch {
        /* ignore */
      }
      return m;
    });
  const iconBtn =
    "grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
  const seg = (v: View, label: string, Icon: typeof Columns2) => (
    <button
      key={v}
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-accent ${view === v ? "bg-accent/10 font-semibold text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
    >
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
  return (
    <div className="@container flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-start gap-1.5 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            {niceId(c.clause_identifier) && (
              <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-xs font-medium text-accent-fg">
                {niceId(c.clause_identifier)}
              </span>
            )}
            <span className="truncate font-display text-xl font-semibold">
              {c.title}
            </span>
          </p>
          <p className="mt-1 truncate text-sm text-muted" title={c.filename}>
            {c.filename}
            {c.page_number ? ` · p.${c.page_number}` : ""}
          </p>
        </div>
        {nav && nav.total > 1 && (
          <div
            className="flex shrink-0 items-center"
            role="group"
            aria-label="Reference navigation"
          >
            <button
              onClick={nav.onPrev}
              aria-label="Previous reference"
              className={iconBtn}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span
              className="min-w-10 text-center font-mono text-xs tabular-nums text-muted"
              aria-live="polite"
            >
              {nav.index + 1} / {nav.total}
            </span>
            <button
              onClick={nav.onNext}
              aria-label="Next reference"
              className={iconBtn}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        <Link
          to={clauseHref(c)}
          target="_blank"
          rel="noopener"
          title="Open this clause in the full contract (new tab)"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />{" "}
          <span className="hidden @xl:inline">Open in contract</span>
          <span className="@xl:hidden">Open</span>
        </Link>
        {onExpand && (
          <button
            onClick={onExpand}
            aria-pressed={!!expanded}
            aria-label={expanded ? "Back to the chat" : "Read full width"}
            title={expanded ? "Back to the chat" : "Read full width"}
            className={`${iconBtn} hidden lg:grid`}
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" aria-hidden />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden />
            )}
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close reference"
          className={iconBtn}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/60 px-3 py-1.5">
        <div
          role="group"
          aria-label="What to show"
          className="flex items-center gap-1"
        >
          {seg("both", "Page + text", Columns2)}
          {seg("pdf", "Page", FileText)}
          {seg("text", "Text", AlignLeft)}
        </div>
        {view !== "pdf" && (
          <div
            role="group"
            aria-label="Clause text size"
            className="flex items-center"
          >
            <button
              onClick={() => bump(-1)}
              disabled={size === 0}
              aria-label="Smaller text"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-md font-display text-sm text-muted hover:bg-raised hover:text-fg disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
            >
              A
            </button>
            <span className="px-1 font-mono text-xs tabular-nums text-subtle">
              {size + 1}/{SIZES.length}
            </span>
            <button
              onClick={() => bump(1)}
              disabled={size === SIZES.length - 1}
              aria-label="Larger text"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-md font-display text-xl text-muted hover:bg-raised hover:text-fg disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
            >
              A
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        {view !== "text" && (
          <div
            className={`min-h-72 min-w-0 border-line ${view === "both" ? "flex-[11_1_0] border-b @3xl:border-b-0 @3xl:border-r" : "flex-1"}`}
          >
            <PanelPdf key={`${c.document_id}-${c.position}`} c={c} />
          </div>
        )}
        {view !== "pdf" && (
          <div
            className={`min-h-48 min-w-0 overflow-y-auto p-6 ${view === "both" ? "flex-[9_1_0]" : "flex-1"}`}
          >
            <p className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">
              Clause text
            </p>
            <p
              className={`max-w-[66ch] whitespace-pre-wrap font-display leading-[1.8] text-fg ${SIZES[size]}`}
            >
              {c.content ?? c.snippet ?? "(text not stored with this result)"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The clause's page with the clause shaded. Remounts per clause, so the page and the highlight reset with it. */
function PanelPdf({ c }: { c: ClauseRef }) {
  const [page, setPage] = useState(c.page_number ?? 1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  useEffect(() => {
    let stale = false;
    clauseBoxes(c.document_id, c.position)
      .then((b) => {
        if (stale) return;
        setBoxes(b);
        if (b.length && !b.some((x) => x.page === page)) setPage(b[0].page); // the clause starts on a different page than the result said
      })
      .catch(() => {}); // no highlight is fine: the page still shows
    return () => {
      stale = true;
    };
  }, [c.document_id, c.position]);
  return (
    <LazyPdfViewer
      docKey={c.document_id}
      getData={() => fetchPdf(c.document_id)}
      page={page}
      onPage={setPage}
      boxes={boxes}
    />
  );
}
