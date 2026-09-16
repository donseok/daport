import { useRef, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { pxToMm, snapMm } from "./snap";

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type Box = { x: number; y: number; w: number; h: number };

type DragState = { handle: Handle; start: { px: number; py: number }; boxes: Record<string, Box>; last: Record<string, Box> };

/** 포인터 드래그를 mm 델타로 바꿔 onChange(id, box)로 흘리고, 끝나면 onEnd로 최종 박스를 넘긴다 */
export function useDrag(opts: {
  zoom: number;
  onChange: (boxes: Record<string, Box>) => void;
  onEnd: (boxes: Record<string, Box>) => void;
}) {
  const state = useRef<DragState | null>(null);

  const begin = useCallback((e: ReactPointerEvent, handle: Handle, boxes: Record<string, Box>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    state.current = { handle, start: { px: e.clientX, py: e.clientY }, boxes, last: boxes };
  }, []);

  const move = useCallback((e: ReactPointerEvent) => {
    const s = state.current; if (!s) return;
    const dx = snapMm(pxToMm(e.clientX - s.start.px, opts.zoom));
    const dy = snapMm(pxToMm(e.clientY - s.start.py, opts.zoom));
    const next: Record<string, Box> = {};
    for (const [id, b] of Object.entries(s.boxes)) next[id] = applyHandle(b, s.handle, dx, dy);
    s.last = next;
    opts.onChange(next);
  }, [opts]);

  const end = useCallback(() => {
    const s = state.current; if (!s) return;
    state.current = null;
    opts.onEnd(s.last);
  }, [opts]);

  return { begin, move, end };
}

export function applyHandle(b: Box, h: Handle, dx: number, dy: number, min = 1): Box {
  let { x, y, w, h: hh } = b;
  if (h === "move") return { x: x + dx, y: y + dy, w, h: hh };
  if (h.includes("e")) w = Math.max(min, w + dx);
  if (h.includes("s")) hh = Math.max(min, hh + dy);
  if (h.includes("w")) { const nw = Math.max(min, w - dx); x += w - nw; w = nw; }
  if (h.includes("n")) { const nh = Math.max(min, hh - dy); y += hh - nh; hh = nh; }
  return { x, y, w, h: hh };
}
