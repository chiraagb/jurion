import { useEffect, useMemo, useRef, useState } from "react";
import { listDocuments, type DocSummary } from "@/features/documents/api";
import { embeddingMap, type EmbeddingMapData, type MapPoint } from "./api";

const W = 520, H = 340, PAD = 28;
const color = (i: number) => `hsl(${(i * 53 + 20) % 360} 62% 52%)`; // one hue per contract

interface Props {
  query: string | null; // the last search; its real position is drawn as a star
  onOpen: (p: MapPoint) => void;
}

/** The stored vectors of the user's contracts, squashed from 1536 numbers to 2 (PCA) and drawn. */
export default function EmbeddingMap({ query, onOpen }: Props) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [docId, setDocId] = useState<string>(""); // "" = all contracts
  const [data, setData] = useState<EmbeddingMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<MapPoint | null>(null);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [rot, setRot] = useState({ yaw: 0.6, pitch: -0.35 }); // 3D view angle, set by dragging
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    listDocuments().then((d) => setDocs(d.filter((x) => x.embedded_count > 0))).catch(() => {});
  }, []);

  useEffect(() => {
    let stale = false;
    setError(null);
    setPicked(null);
    embeddingMap(docId || null, query)
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && setError(e.response?.data?.detail ?? e.message));
    return () => {
      stale = true;
    };
  }, [docId, query]);

  const hue = useMemo(() => new Map(docs.map((d, i) => [d.id, color(i)])), [docs]);
  // Screen position and depth for any point. 2D: x/y fitted to the box. 3D: rotated about the middle, with perspective.
  const project = useMemo(() => {
    if (!data?.points.length) return null;
    const all = [...data.points, ...(data.query ? [data.query] : [])];
    if (mode === "3d") {
      const { yaw, pitch } = rot;
      const [cy, sy_, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
      const k = (Math.min(W, H) / 2 - PAD) / 1.15;
      return (p: { x: number; y: number; z: number }) => {
        const x1 = p.x * cy + p.z * sy_, z1 = -p.x * sy_ + p.z * cy; // turn left/right
        const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp; // tilt up/down
        const f = 3 / (3 - z2); // nearer = bigger
        return { x: W / 2 + x1 * k * f, y: H / 2 - y2 * k * f, depth: z2, f };
      };
    }
    const [x0, x1, y0, y1] = [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x)), Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))];
    const k = Math.min((W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD) / (y1 - y0 || 1)); // same scale on both axes
    return (p: { x: number; y: number }) => ({ x: W / 2 + (p.x - (x0 + x1) / 2) * k, y: H / 2 - (p.y - (y0 + y1) / 2) * k, depth: 0, f: 1 });
  }, [data, mode, rot]) as ((p: { x: number; y: number; z: number }) => { x: number; y: number; depth: number; f: number }) | null;

  const nearest = useMemo(() => {
    const ranked = (data?.points ?? []).filter((p) => p.similarity !== null).sort((a, b) => b.similarity! - a.similarity!);
    return new Set(ranked.slice(0, 5));
  }, [data]);

  const shown = data && data.points.length > 0 && project;
  return (
    <section aria-labelledby="map-title" className="space-y-3 rounded-md border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="map-title" className="text-sm font-semibold">Your real embeddings, drawn in {mode === "3d" ? "3D" : "2D"}</h2>
        <div role="group" aria-label="Dimensions" className="flex overflow-hidden rounded-md border border-line-strong text-sm">
          {(["2d", "3d"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`cursor-pointer px-3 py-1 focus-visible:outline-2 focus-visible:outline-accent ${mode === m ? "bg-accent/10 font-semibold text-accent-fg" : "text-muted hover:text-fg"}`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Contract
          <select
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            className="max-w-56 cursor-pointer truncate rounded-md border border-line-strong bg-canvas px-2 py-1 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All contracts</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{d.filename}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && !shown && (
        <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-muted">
          Nothing embedded yet. Use the sparkle button on My contracts, then come back.
        </p>
      )}

      {shown && (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className={`w-full touch-none select-none rounded-md border border-line bg-canvas ${mode === "3d" ? "cursor-grab active:cursor-grabbing" : ""}`}
            role="img"
            aria-label={`${data.points.length} clauses drawn by meaning${data.query ? ", with your question marked by a star" : ""}.`}
            onPointerDown={(e) => {
              if (mode !== "3d") return;
              drag.current = { x: e.clientX, y: e.clientY, moved: false };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
              if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
              drag.current = { ...d, x: e.clientX, y: e.clientY };
              setRot((r) => ({ yaw: r.yaw + dx * 0.01, pitch: Math.max(-1.5, Math.min(1.5, r.pitch + dy * 0.01)) }));
            }}
            onPointerUp={() => setTimeout(() => (drag.current = null))} // after click handlers: a drag must not select a dot
          >
            {mode === "3d" && <Axes project={project} />}
            {data.points
              .map((p) => ({ p, ...project(p) }))
              .sort((a, b) => a.depth - b.depth) // far dots first, so near ones cover them
              .map(({ p, x, y, depth, f }) => {
                const ring = nearest.has(p);
                return (
                  <circle
                    key={`${p.document_id}-${p.position}`}
                    cx={x} cy={y} r={(ring ? 7 : 5) * f}
                    fill={hue.get(p.document_id) ?? "currentColor"}
                    opacity={mode === "3d" ? 0.55 + 0.45 * ((depth + 1.7) / 3.4) : 1}
                    className={`cursor-pointer ${ring || picked === p ? "stroke-fg" : "stroke-canvas"}`}
                    strokeWidth={ring || picked === p ? 2 : 1}
                    onClick={() => !drag.current?.moved && setPicked(p)}
                  >
                    <title>{`${p.clause_identifier} ${p.title}${p.similarity !== null ? ` · similarity ${p.similarity.toFixed(3)}` : ""}`}</title>
                  </circle>
                );
              })}
            {data.query && (() => {
              const q = project(data.query);
              return (
                <g transform={`translate(${q.x} ${q.y}) scale(${q.f})`}>
                  <path d="M0 -10 l3 7 7.5 .8 -5.6 5 1.7 7.4 -6.6 -3.9 -6.6 3.9 1.7 -7.4 -5.6 -5 7.5 -.8z" className="fill-danger stroke-canvas" />
                  <title>{data.query.text}</title>
                </g>
              );
            })()}
          </svg>
          {mode === "3d" && (
            <p className="flex items-center justify-between text-xs text-muted">
              Drag to rotate. Axes are the three strongest directions (PC1 PC2 PC3).
              <button onClick={() => setRot({ yaw: 0.6, pitch: -0.35 })} className="cursor-pointer underline focus-visible:outline-2 focus-visible:outline-accent">Reset view</button>
            </p>
          )}

          {docs.length > 1 && !docId && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: hue.get(d.id) }} aria-hidden />
                  {d.filename}
                </li>
              ))}
            </ul>
          )}

          {picked && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-raised p-3 text-sm">
              <span className="font-mono text-xs text-accent-fg">{picked.clause_identifier}</span>
              <span className="font-semibold">{picked.title}</span>
              <span className="text-muted">{picked.filename}{picked.page_number ? ` · p.${picked.page_number}` : ""}</span>
              {picked.similarity !== null && <span className="font-mono text-xs tabular-nums text-muted">similarity {picked.similarity.toFixed(3)}</span>}
              <button onClick={() => onOpen(picked)} className="ml-auto cursor-pointer text-accent-fg underline focus-visible:outline-2 focus-visible:outline-accent">
                Open clause
              </button>
            </p>
          )}

          <p className="text-xs text-muted">
            {data.points.length} clauses, each dot is one stored vector of {data.dims} numbers, squashed to {mode === "3d" ? 3 : 2} with PCA. The {mode === "3d" ? "three axes keep" : "two axes keep"}{" "}
            <b>{Math.round(data.explained.slice(0, mode === "3d" ? 3 : 2).reduce((a, b) => a + b, 0) * 100)}%</b> of the variation; the rest is lost, so closeness here is only a hint.
            {data.query ? " The star is your question, placed with the same squash. Rings mark the 5 clauses nearest to it in the full " + data.dims + " dimensions." : " Search for something and your question appears as a star."}
          </p>
        </>
      )}
    </section>
  );
}

/** Faint X/Y/Z lines through the middle, so a rotated cloud has something to orient by. */
function Axes({ project }: { project: (p: { x: number; y: number; z: number }) => { x: number; y: number } }) {
  return (
    <g className="stroke-line-strong" strokeWidth={1}>
      {([["PC1", 1, 0, 0], ["PC2", 0, 1, 0], ["PC3", 0, 0, 1]] as const).map(([name, x, y, z]) => {
        const [a, b] = [project({ x: -x, y: -y, z: -z }), project({ x, y, z })];
        return (
          <g key={name}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <text x={b.x + 4} y={b.y - 4} className="fill-subtle stroke-none text-[10px]">{name}</text>
          </g>
        );
      })}
    </g>
  );
}
