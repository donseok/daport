"use client";
import { StyleSchema, type Element, type Report } from "@daport/core";
import { useEditor } from "../store";

const defaultStyle = () => StyleSchema.parse({});   // core의 기본값을 그대로 쓴다

// 스키마(min 1)를 만족하는 기본 소스 — 첫 데이터셋 이름, 없으면 "items"(없는 이름은 undefined → 빈 배열로 그려져 #ERR가 아니다)
export function defaultSource(report: Report): string {
  return report.datasets[0]?.name ?? "items";
}

const ITEMS: { label: string; base: string; make: (id: string, alloc: (base: string) => string, report: Report) => Element }[] = [
  { label: "텍스트", base: "text", make: (id) => ({ id, type: "text", x: 10, y: 10, w: 40, h: 8, value: "텍스트", flow: "once", style: defaultStyle() }) },
  { label: "이미지", base: "image", make: (id) => ({ id, type: "image", x: 10, y: 10, w: 30, h: 30, src: "", fit: "contain", flow: "once", style: defaultStyle() }) },
  { label: "선", base: "line", make: (id) => ({ id, type: "line", x: 10, y: 10, w: 50, h: 0, x2: 60, y2: 10, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "사각형", base: "rect", make: (id) => ({ id, type: "rect", x: 10, y: 10, w: 40, h: 20, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "페이지번호", base: "pn", make: (id) => ({ id, type: "pageNumber", x: 10, y: 10, w: 40, h: 6, format: "{{ page }} / {{ total }}", flow: "every", style: defaultStyle() }) },
  { label: "바코드", base: "barcode", make: (id) => ({ id, type: "barcode", x: 10, y: 10, w: 40, h: 15, format: "code128", value: "123456", showText: true, flow: "once", style: { ...defaultStyle(), fontSize: 8 } }) },
  { label: "표", base: "table", make: (id, _alloc, report) => ({ id, type: "table", x: 10, y: 10, w: 100, h: 40, source: defaultSource(report), columns: [{ header: "열 1", value: "", w: 50, style: defaultStyle() }],
    repeatHeader: true, overflow: "continue", keepTogether: "row", rowHeight: 6, headerHeight: 7, border: "all", borderStyle: { stroke: "#000000", strokeWidth: 0.2 },
    headerStyle: {}, groups: [], pageFooter: [], footer: [], flow: "once", style: defaultStyle() }) },
  { label: "반복 영역", base: "repeater", make: (id, alloc, report) => ({ id, type: "repeater", x: 10, y: 10, w: 100, h: 80, source: defaultSource(report), layout: "list", gap: [0, 2], overflow: "continue", groups: [],
    item: { w: 60, h: 20, children: [{ id: alloc("text"), type: "text", x: 2, y: 2, w: 50, h: 8, value: "항목 {{ index + 1 }}", flow: "once", style: defaultStyle() }] },
    flow: "once", style: defaultStyle() }) },
];

export function ElementPalette() {
  const addElement = useEditor((s) => s.addElement);
  const allocateId = useEditor((s) => s.allocateId);
  const selection = useEditor((s) => s.selection);
  const findElement = useEditor((s) => s.findElement);
  const findParentRepeater = useEditor((s) => s.findParentRepeater);
  const report = useEditor((s) => s.report);
  // repeater(또는 그 템플릿 자식)가 선택돼 있으면 새 요소를 그 항목 템플릿에 넣는다 (R8). 반복 영역 자체는 항상 최상위
  const targetRepeater = (): string | undefined => {
    if (selection.length !== 1) return undefined;
    const sel = findElement(selection[0]);
    return sel?.type === "repeater" ? sel.id : findParentRepeater(selection[0]);
  };
  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="text-xs font-semibold mb-1">요소</div>
      {ITEMS.map((it) => (
        <button key={it.label} className="text-left text-xs border rounded px-2 py-1 hover:bg-neutral-100" onClick={() => {
          const el = it.make(allocateId(it.base), allocateId, report);
          const into = it.base === "repeater" ? undefined : targetRepeater();
          addElement(el, into ? { into: { repeaterId: into, band: "item" } } : undefined);
        }}>
          + {it.label}
        </button>
      ))}
    </div>
  );
}
