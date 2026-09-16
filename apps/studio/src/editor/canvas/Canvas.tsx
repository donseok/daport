"use client";
import { useMemo, useState, type PointerEvent } from "react";
import { layout } from "@daport/renderer/layout";
import { PaintPage, pageCss, fontFaceCss } from "@daport/renderer/paint";   // 패키지 루트는 react-dom/server를 쓰는 html.ts까지 끌어온다
import { resolveDataSync } from "@/lib/data";
import { resolveAssetUrls } from "@/lib/assets";
import { useEditor } from "../store";
import { useDrag, type Box, type Handle } from "./useDrag";
import { SelectionBox } from "./SelectionBox";
import { pxToMm } from "./snap";

/** 채우기 없는 사각형은 선에서 이 화면 거리(px) 안쪽일 때만 고른다 */
const STROKE_HIT_PX = 3;

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
  // 미리보기·PDF와 같게 asset://을 /api/assets/{id}로 바꾼다 (상대 URL이라 studio 출처 기준으로 해석된다)
  const pages = useMemo(() => layout(resolveAssetUrls(report, ""), data), [report, data]);
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

  /**
   * 포인터 아래 요소를 위에서부터 훑는다. 채우기 없는 사각형(틀)은 투명한 안쪽이 아래 요소를 가리지 않도록
   * 선 근처일 때만 고른다. elementsFromPoint가 없는 환경(jsdom)에서는 이벤트 대상만 본다.
   */
  const pickElementId = (e: PointerEvent<HTMLDivElement>): string | null => {
    const root = e.currentTarget;
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
    const origin = root.querySelector(".dp-page")?.getBoundingClientRect();
    const mx = pxToMm(e.clientX - (origin?.left ?? 0), zoom), my = pxToMm(e.clientY - (origin?.top ?? 0), zoom);
    const seen = new Set<string>();
    for (const node of stack) {
      if (!root.contains(node)) continue;
      const id = node.closest("[data-element-id]")?.getAttribute("data-element-id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const it = pages[0].items.find((i) => i.elementId === id);
      if (!it) continue;
      if (it.kind === "rect" && !it.style.fill) {
        const edge = Math.min(mx - it.x, it.x + it.w - mx, my - it.y, it.y + it.h - my);   // 안쪽이면 가장 가까운 변까지의 mm
        if (edge > Math.max(it.style.strokeWidth, pxToMm(STROKE_HIT_PX, zoom))) continue;
      }
      return id;
    }
    return null;
  };

  const onPagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const id = pickElementId(e);
    if (!id) { select([]); return; }
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
