"use client";
import { useEffect, useMemo, useState, type DragEvent, type PointerEvent } from "react";
import type { PlacedItem } from "@daport/renderer";
import { PaintPage, pageCss, fontFaceCss } from "@daport/renderer/paint";   // 패키지 루트는 react-dom/server를 쓰는 html.ts까지 끌어온다
import { useEditor, lineBox } from "../store";
import { useDrag, type Box, type Handle } from "./useDrag";
import { SelectionBox } from "./SelectionBox";
import { pxToMm, snapMm } from "./snap";
import { clampView, currentPage, primaryItem, isOtherInstance } from "./pages";
import { layoutFor } from "./layoutCache";
import { resolveDrop, DRAG_MIME, type DragField, type DropTarget } from "../data/bindings";

/** 채우기 없는 사각형은 선에서 이 화면 거리(px) 안쪽일 때만 고른다 */
const STROKE_HIT_PX = 3;

/** 선택 상자·드래그 시작 상자. 선은 두 끝점을 감싸는 상자다 (x/y가 시작점이라 오른쪽→왼쪽 선이면 왼쪽 변이 아니다) */
const itemBox = (it: PlacedItem): Box => (it.kind === "line" ? lineBox(it) : { x: it.x, y: it.y, w: it.w, h: it.h });

export function Canvas({ zoom }: { zoom: number }) {
  const report = useEditor((s) => s.report);
  const selection = useEditor((s) => s.selection);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const findElement = useEditor((s) => s.findElement);
  const moveSelected = useEditor((s) => s.moveSelected);
  const resizeElement = useEditor((s) => s.resizeElement);
  const addElement = useEditor((s) => s.addElement);
  const updateElement = useEditor((s) => s.updateElement);
  const allocateId = useEditor((s) => s.allocateId);
  const findParentRepeater = useEditor((s) => s.findParentRepeater);
  const [ghost, setGhost] = useState<Record<string, Box> | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // 캔버스와 페이지 선택기가 같은 레이아웃을 쓴다 (report 객체당 한 번 계산). 스펙 10: 표현식 오류는 요소마다 #ERR로 보인다
  const pages = useMemo(() => layoutFor(report), [report]);
  const css = useMemo(() => fontFaceCss("/fonts") + "\n" + pageCss(report.page.width, report.page.height), [report.page.width, report.page.height]);
  const page = currentPage(pages, view);

  // 편집으로 페이지 수가 줄면 보기를 마지막 페이지로 당긴다 (스펙 7.4)
  useEffect(() => {
    const c = clampView(view, pages);
    if (c.copyIndex !== view.copyIndex || c.pageInCopy !== view.pageInCopy) setView(c);
  }, [pages, view, setView]);

  // 선택 요소들의 절대 박스 (그룹 자식은 layout 결과에서 좌표를 얻는다. 반복 자식은 첫 인스턴스)
  const boxes = useMemo(() => {
    const m: Record<string, Box> = {};
    for (const id of selection) { const it = primaryItem(page, id); if (it) m[id] = itemBox(it); }
    return m;
  }, [page, selection]);

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
        // 그룹·템플릿 자식은 layout 절대좌표와 요소 상대좌표의 차이를 유지한다. 선은 상대좌표의 경계 상자를 옮긴다
        const rel = el.type === "line" ? lineBox(el) : el;
        resizeElement(id, { x: rel.x + (b.x - orig.x), y: rel.y + (b.y - orig.y), w: b.w, h: b.h });
      }
    },
  });

  /**
   * 포인터 아래 요소를 위에서부터 훑는다. 채우기 없는 사각형(틀)은 투명한 안쪽이 아래 요소를 가리지 않도록
   * 선 근처일 때만 고른다. 표 셀·테두리·반복 인스턴스는 그 요소 id(표 id·템플릿 자식 id)로 매핑된다.
   * elementsFromPoint가 없는 환경(jsdom)에서는 이벤트 대상만 본다.
   */
  const pickElementId = (e: PointerEvent<HTMLDivElement>): string | null => {
    const root = e.currentTarget;
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
    const origin = root.querySelector(".dp-page")?.getBoundingClientRect();
    const mx = pxToMm(e.clientX - (origin?.left ?? 0), zoom), my = pxToMm(e.clientY - (origin?.top ?? 0), zoom);
    const seen = new Set<string>();
    for (const node of stack) {
      if (!root.contains(node)) continue;
      const host = node.closest("[data-element-id]");
      const id = host?.getAttribute("data-element-id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const role = host?.getAttribute("data-role");
      if (role === "flowBox" || role === "cell" || role === "border" || role === "template") return id;
      const it = primaryItem(page, id);
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
    for (const sid of ids) { const it = primaryItem(page, sid); if (it) start[sid] = itemBox(it); }
    drag.begin(e, "move", start);
  };
  // 핸들은 단일 선택에만 보인다. 선은 크기 0이 정상이라 최소 크기를 0으로 둔다 (1이면 가로선의 n/s 핸들이 선을 1mm 기울인다)
  const onHandleDown = (e: PointerEvent, h: Handle) => { drag.begin(e, h, boxes, findElement(selection[0])?.type === "line" ? 0 : 1); };

  /** 놓인 자리의 대상: 표(셀·테두리·flowBox), 반복 영역 템플릿(템플릿 자리·어느 인스턴스든), 그 밖은 빈 캔버스 */
  const dropTargetAt = (e: DragEvent<HTMLDivElement>, x: number, y: number): DropTarget => {
    const root = e.currentTarget;
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
    const templateOf = (repeaterId: string): DropTarget => {
      const t = page.items.find((i) => i.role === "template" && i.elementId === repeaterId);
      return t ? { kind: "repeaterItem", repeaterId, x: snapMm(x - t.x), y: snapMm(y - t.y) } : { kind: "canvas", x, y };
    };
    for (const node of stack) {
      if (!root.contains(node)) continue;
      const host = node.closest("[data-element-id]");
      const id = host?.getAttribute("data-element-id");
      if (!host || !id) continue;
      const role = host.getAttribute("data-role");
      const el = findElement(id);
      if (el?.type === "table") return { kind: "table", tableId: id };
      if (el?.type === "repeater" && (role === "flowBox" || role === "template")) return templateOf(id);
      const rep = findParentRepeater(id);
      if (rep) {
        // 인스턴스 자식 위에 놓으면 그 인스턴스의 원점 기준 상대좌표를 템플릿 좌표로 쓴다
        const inst = host.getAttribute("data-instance");
        const slot = page.items.find((i) => i.role === "template" && i.elementId === rep);
        const first = page.items.find((i) => i.elementId === id && i.instance === inst);
        const tmpl = primaryItem(page, id);
        if (slot && first && tmpl) return { kind: "repeaterItem", repeaterId: rep, x: snapMm(x - (first.x - tmpl.x) - slot.x), y: snapMm(y - (first.y - tmpl.y) - slot.y) };
        return templateOf(rep);
      }
    }
    return { kind: "canvas", x, y };
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => { if (Array.from(e.dataTransfer.types).includes(DRAG_MIME)) e.preventDefault(); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const field = JSON.parse(raw) as DragField;
    const origin = e.currentTarget.querySelector(".dp-page")?.getBoundingClientRect();
    const x = snapMm(pxToMm(e.clientX - (origin?.left ?? 0), zoom)), y = snapMm(pxToMm(e.clientY - (origin?.top ?? 0), zoom));
    const result = resolveDrop(field, dropTargetAt(e, x, y), report, allocateId);
    if (result.action === "addElement") addElement(result.element, result.into ? { into: result.into } : undefined);
    else if (result.action === "addColumn") { const t = findElement(result.tableId); if (t?.type === "table") updateElement(t.id, { columns: [...t.columns, result.column] }); }
    setWarning(result.warning ?? null);
  };

  const shown = ghost ?? boxes;
  const templates = page.items.filter((i) => i.role === "template");
  return (
    <div className="relative inline-block shadow-lg" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
      data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel}
      onDragOver={onDragOver} onDrop={onDrop}>
      <style>{css}</style>
      <PaintPage page={{ ...page, items: page.items.map((it) => (isOtherInstance(it.instance, (id) => findElement(id)?.type === "repeater") ? dim(it) : it)) }} />
      <div className="absolute inset-0 pointer-events-none">
        {templates.map((t) => (
          <div key={`${t.elementId}|${t.instance}`} data-testid="template-outline" className="absolute border border-dashed border-blue-400"
            style={{ left: `${t.x}mm`, top: `${t.y}mm`, width: `${t.w}mm`, height: `${t.h}mm` }} />
        ))}
        {Object.entries(shown).map(([id, b]) => <SelectionBox key={id} box={b} single={selection.length === 1} onHandleDown={onHandleDown} />)}
        {warning && <div data-testid="drop-warning" role="status" className="absolute left-2 top-2 text-xs bg-amber-100 border border-amber-400 rounded px-2 py-1">{warning}</div>}
      </div>
    </div>
  );
}

/** 첫 항목이 아닌 반복 인스턴스는 흐리게 그린다 (스펙 7.3). Paint의 Item이 dim 표시를 읽어 opacity 0.5를 준다 */
function dim(it: PlacedItem): PlacedItem { return { ...it, dim: true } as unknown as PlacedItem; }
