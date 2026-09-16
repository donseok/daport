"use client";
import { useMemo, useState, type PointerEvent } from "react";
import { layout, PaintPage, pageCss, fontFaceCss } from "@daport/renderer";
import { resolveDataSync } from "@/lib/data";
import { useEditor } from "../store";
import { useDrag, type Box, type Handle } from "./useDrag";
import { SelectionBox } from "./SelectionBox";

export function Canvas({ zoom }: { zoom: number }) {
  const report = useEditor((s) => s.report);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const findElement = useEditor((s) => s.findElement);
  const moveSelected = useEditor((s) => s.moveSelected);
  const resizeElement = useEditor((s) => s.resizeElement);
  const [ghost, setGhost] = useState<Record<string, Box> | null>(null);

  const data = useMemo(() => resolveDataSync(report), [report]);
  const pages = useMemo(() => layout(report, data), [report, data]);
  const css = useMemo(() => fontFaceCss("/fonts") + "\n" + pageCss(report.page.width, report.page.height), [report.page.width, report.page.height]);

  // 선택 요소들의 절대 박스 (그룹 자식은 layout 결과에서 좌표를 얻는다)
  const boxes = useMemo(() => {
    const m: Record<string, Box> = {};
    for (const it of pages[0].items) if (selection.includes(it.elementId)) m[it.elementId] = { x: it.x, y: it.y, w: it.w, h: it.h };
    return m;
  }, [pages, selection]);

  const drag = useDrag({
    zoom,
    onChange: setGhost,
    onCancel: () => setGhost(null),
    onEnd: (final, handle) => {
      setGhost(null);
      const entries = Object.entries(final);
      if (entries.length === 0) return;
      if (handle === "move") {
        // 이동 델타는 모든 박스에 같으므로 선택 전체를 한 번의 커밋(undo 한 단위)으로 옮긴다
        const [id, b] = entries[0]; const orig = boxes[id]; if (!orig) return;
        moveSelected(b.x - orig.x, b.y - orig.y);
        return;
      }
      for (const [id, b] of entries) {
        const el = findElement(id); const orig = boxes[id]; if (!el || !orig) continue;
        // 그룹 자식은 layout 절대좌표와 요소 상대좌표의 차이를 유지한다
        resizeElement(id, { x: el.x + (b.x - orig.x), y: el.y + (b.y - orig.y), w: b.w, h: b.h });
      }
    },
  });

  const onPagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("[data-element-id]") as HTMLElement | null;
    if (!target) { select([]); return; }
    const id = target.dataset.elementId!;
    if (e.shiftKey) { toggleSelect(id); return; }
    const ids = selection.includes(id) ? selection : [id];
    if (!selection.includes(id)) select([id]);
    const start: Record<string, Box> = {};
    for (const sid of ids) { const it = pages[0].items.find((i) => i.elementId === sid); if (it) start[sid] = { x: it.x, y: it.y, w: it.w, h: it.h }; }
    drag.begin(e, "move", start);
  };
  const onHandleDown = (e: PointerEvent, h: Handle) => { drag.begin(e, h, boxes); };

  const shown = ghost ?? boxes;
  return (
    <div className="relative inline-block shadow-lg" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
      data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel}>
      <style>{css}</style>
      <PaintPage page={pages[0]} />
      <div className="absolute inset-0 pointer-events-none">
        {Object.entries(shown).map(([id, b]) => <SelectionBox key={id} box={b} single={selection.length === 1} onHandleDown={onHandleDown} />)}
      </div>
    </div>
  );
}
