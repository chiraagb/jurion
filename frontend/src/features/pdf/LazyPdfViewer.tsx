import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const Viewer = lazy(() => import("./PdfViewer")); // pdf.js is large: loaded only when a PDF is first shown

export default function LazyPdfViewer(props: ComponentProps<typeof Viewer>) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted" aria-busy>Loading viewer…</p>}>
      <Viewer {...props} />
    </Suspense>
  );
}
