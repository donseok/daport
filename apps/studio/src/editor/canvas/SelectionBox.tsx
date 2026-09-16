import type { PointerEvent } from "react";
import type { Box, Handle } from "./useDrag";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const pos: Record<Handle, string> = {
  move: "", n: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize", s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-e-resize", w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
  ne: "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize", nw: "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
  se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize", sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
};

export function SelectionBox({ box, single, onHandleDown }: { box: Box; single: boolean; onHandleDown: (e: PointerEvent, h: Handle) => void }) {
  return (
    <div className="absolute border border-blue-500 pointer-events-none" style={{ left: `${box.x}mm`, top: `${box.y}mm`, width: `${box.w}mm`, height: `${box.h}mm` }}>
      {single && HANDLES.map((h) => (
        <div key={h} data-handle={h} onPointerDown={(e) => { e.stopPropagation(); onHandleDown(e, h); }}
          className={`absolute w-2 h-2 bg-white border border-blue-500 pointer-events-auto ${pos[h]}`} />
      ))}
    </div>
  );
}
