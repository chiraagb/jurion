import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readPref, writePref } from "@/lib/store";

GlobalWorkerOptions.workerSrc = workerSrc;

/** Where a clause sits on one page, in PDF points (72 per inch), origin top-left. */
export interface Box { page: number; x0: number; y0: number; x1: number; y1: number; w: number; h: number }

// ponytail: opened documents are kept so flipping between clauses of one contract doesn't re-download it; keeps the last 3
const open = new Map<string, Promise<PDFDocumentProxy>>();
function load(key: string, getData: () => Promise<ArrayBuffer>) {
  let p = open.get(key);
  if (!p) {
    p = getData().then((data) => getDocument({ data }).promise);
    p.catch(() => open.delete(key));
    open.set(key, p);
    if (open.size > 3) open.delete(open.keys().next().value!);
  }
  return p;
}

const ZOOM_KEY = "jurion.pdf.zoom";
const STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]; // 1 = the page fits the width
const readZoom = () => { const z = Number(readPref(ZOOM_KEY)); return STEPS.includes(z) ? z : 1; };

interface Props {
  docKey: string; // what identifies this PDF (its contract id)
  getData: () => Promise<ArrayBuffer>;
  page: number;
  onPage: (n: number) => void;
  boxes?: Box[]; // the clause to highlight; the viewer scrolls to the first one on the current page
}

/** A page of a PDF drawn with pdf.js, with the cited clause shaded. Plain on purpose: no search, no zoom beyond fit-width. */
export default function PdfViewer({ docKey, getData, page, onPage, boxes = [] }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(readZoom);
  const [view, setView] = useState<{ scale: number; w: number; h: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stale = false;
    setPdf(null);
    setError(null);
    load(docKey, getData).then((d) => !stale && setPdf(d)).catch((e) => !stale && setError(e.message ?? "Could not load the PDF"));
    return () => { stale = true; };
  }, [docKey]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !width || !canvas.current) return;
    let task: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let stale = false;
    pdf.getPage(Math.min(Math.max(page, 1), pdf.numPages)).then((p) => {
      if (stale || !canvas.current) return;
      const scale = (width / p.getViewport({ scale: 1 }).width) * zoom; // zoom 1 = fit the width; larger scrolls sideways
      const vp = p.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = vp.width * dpr;
      c.height = vp.height * dpr;
      task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      task.promise.then(() => !stale && setView({ scale, w: vp.width, h: vp.height })).catch(() => {}); // a cancelled render is expected
    });
    return () => { stale = true; task?.cancel(); };
  }, [pdf, page, width, zoom]);

  const here = boxes.filter((b) => b.page === page);
  useEffect(() => {
    if (view && here[0] && scroller.current) scroller.current.scrollTo({ top: Math.max(0, here[0].y0 * view.scale - 56), left: zoom > 1 ? Math.max(0, here[0].x0 * view.scale - 40) : 0, behavior: "smooth" });
  }, [view, boxes, page]);

  const pages = [...new Set(boxes.map((b) => b.page))];
  const step = (d: number) => setZoom((z) => {
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, STEPS.indexOf(z) + d))];
    writePref(ZOOM_KEY, String(next));
    return next;
  });
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-sm">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className="grid h-9 w-9 cursor-pointer place-items-center rounded hover:bg-raised disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"><ChevronLeft className="h-4 w-4" /></button>
        <span className="tabular-nums text-muted">Page {page}{pdf ? ` of ${pdf.numPages}` : ""}</span>
        <button onClick={() => onPage(page + 1)} disabled={!pdf || page >= pdf.numPages} aria-label="Next page" className="grid h-9 w-9 cursor-pointer place-items-center rounded hover:bg-raised disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"><ChevronRight className="h-4 w-4" /></button>
        <div role="group" aria-label="Zoom" className="ml-2 flex items-center">
          <button onClick={() => step(-1)} disabled={zoom <= STEPS[0]} aria-label="Zoom out" className="grid h-9 w-9 cursor-pointer place-items-center rounded hover:bg-raised disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"><Minus className="h-4 w-4" /></button>
          <button onClick={() => { setZoom(1); writePref(ZOOM_KEY, "1"); }} aria-label="Fit page to width" title="Fit to width" className="min-w-12 cursor-pointer rounded px-1 text-center font-mono text-xs tabular-nums text-muted hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">{Math.round(zoom * 100)}%</button>
          <button onClick={() => step(1)} disabled={zoom >= STEPS[STEPS.length - 1]} aria-label="Zoom in" className="grid h-9 w-9 cursor-pointer place-items-center rounded hover:bg-raised disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"><Plus className="h-4 w-4" /></button>
        </div>
        {pages.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted">
            Clause on
            {pages.map((n) => (
              <button key={n} onClick={() => onPage(n)} aria-current={n === page} className={`cursor-pointer rounded px-1.5 py-0.5 tabular-nums hover:bg-raised ${n === page ? "bg-accent/10 font-semibold text-accent-fg" : ""}`}>p.{n}</button>
            ))}
          </span>
        )}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto p-3">
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : !view && <p className="flex items-center gap-2 text-sm text-muted" aria-busy><Loader2 className="h-4 w-4 animate-spin" /> Loading page…</p>}
        <div className="relative mx-auto bg-white shadow-sm" style={view ? { width: view.w, height: view.h } : undefined}>
          <canvas ref={canvas} className="block" style={view ? { width: view.w, height: view.h } : undefined} />
          {view && here.map((b, i) => (
            <div
              key={i}
              aria-label="Highlighted clause"
              className="pointer-events-none absolute rounded-sm bg-accent/20 ring-2 ring-accent"
              style={{ left: b.x0 * view.scale - 4, top: b.y0 * view.scale - 3, width: (b.x1 - b.x0) * view.scale + 8, height: (b.y1 - b.y0) * view.scale + 6 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
