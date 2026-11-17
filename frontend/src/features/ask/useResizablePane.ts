import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { readPref, writePref } from "@/lib/store";

const FRAC_KEY = "jurion.pane.frac"; // how much of the screen the reference pane takes
const MIN_FRAC = 0.3;
const MAX_FRAC = 0.82;
const clamp = (f: number) => Math.min(MAX_FRAC, Math.max(MIN_FRAC, f));
const readFrac = () => {
  const f = Number(readPref(FRAC_KEY));
  return f >= MIN_FRAC && f <= MAX_FRAC ? f : 0.6;
};

/** The reference pane beside the answer: its width (dragged or set with the arrow keys, remembered), and "wide", where it
 *  fills the whole area and the chat steps aside (a reading mode). `row` goes on the element the pane is measured against. */
export function useResizablePane<T extends HTMLElement>() {
  const row = useRef<T>(null);
  const dragging = useRef(false);
  const [frac, setFrac] = useState(readFrac);
  const [wide, setWide] = useState(false);
  const share = wide ? 1 : frac;
  const set = (f: number) => {
    setWide(false);
    setFrac(f);
  };

  /** Props for the vertical separator that resizes the pane. */
  const separator = {
    role: "separator",
    "aria-orientation": "vertical" as const,
    "aria-label": "Resize the reference pane",
    "aria-valuemin": Math.round(MIN_FRAC * 100),
    "aria-valuemax": Math.round(MAX_FRAC * 100),
    "aria-valuenow": Math.round(share * 100),
    tabIndex: 0,
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging.current || !row.current) return;
      const box = row.current.getBoundingClientRect();
      set(clamp((box.right - e.clientX) / box.width));
    },
    onPointerUp: () => {
      dragging.current = false;
      writePref(FRAC_KEY, String(frac));
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const d = e.key === "ArrowLeft" ? 0.03 : e.key === "ArrowRight" ? -0.03 : 0;
      if (!d) return;
      e.preventDefault();
      const f = clamp(share + d);
      set(f);
      writePref(FRAC_KEY, String(f));
    },
  };

  return { row, share, wide, toggleWide: () => setWide((w) => !w), separator };
}
