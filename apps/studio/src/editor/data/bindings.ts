import type { FieldNode, FieldType, Element, Report, TableColumn } from "@daport/core";
import { walkElements, StyleSchema } from "@daport/core";

export const DRAG_MIME = "application/x-daport-field";
/** 필드 트리에서 끄는 항목. children은 배열 노드일 때 원소 필드(표 생성용) */
export type DragField = { dataset: string; path: string; type: FieldType; isArray: boolean; children?: FieldNode[] };

/** 소스 표현식의 루트 식별자. `items` → items, `items[.A == 1]` → items, `record.items` → undefined(레코드 상대), `a.b` → undefined */
export function sourceDataset(source: string): string | undefined {
  const m = source.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(\s*\[.*)?$/s);
  return m ? m[1] : undefined;
}

export type DropTarget =
  | { kind: "canvas"; x: number; y: number }
  | { kind: "table"; tableId: string }
  | { kind: "repeaterItem"; repeaterId: string; x: number; y: number };

export type DropResult =
  | { action: "addElement"; element: Element; into?: { repeaterId: string; band: "item" }; warning?: string }
  | { action: "addColumn"; tableId: string; column: TableColumn; warning?: string }
  | { action: "none"; warning?: string };

const MAX_AUTO_COLUMNS = 8;
const last = (path: string) => path.split(".").at(-1) ?? path;

function findById(report: Report, id: string): Element | undefined {
  let found: Element | undefined;
  walkElements(report.elements, (el) => { if (el.id === id) { found = el; return true; } });
  return found;
}

/** 캔버스 기준 경로: repeat 소스 데이터셋의 필드면 record.path, 아니면 dataset.path. 루트 노드(path "")는 데이터셋 자체 */
function canvasPath(field: DragField, report: Report): string {
  const root = report.repeat && sourceDataset(report.repeat.source) === field.dataset ? report.repeat.as : field.dataset;
  return field.path ? `${root}.${field.path}` : root;
}

function textElement(id: string, x: number, y: number, value: string): Element {
  return { id, type: "text", x, y, w: 40, h: 8, value, flow: "once", style: StyleSchema.parse({}) };
}

/** 필드 드롭 규칙 (스펙 7.2). 순수 함수: 스토어 변경은 호출자가 한다 */
export function resolveDrop(field: DragField, target: DropTarget, report: Report, allocateId: (base: string) => string): DropResult {
  if (target.kind === "canvas") {
    if (field.isArray) {
      const cols = (field.children ?? []).filter((c) => c.type !== "object" && c.type !== "array").slice(0, MAX_AUTO_COLUMNS);
      const w = 80;
      const columns: TableColumn[] = cols.map((c) => ({ header: c.name, value: `{{ row.${c.name} }}`, w: Math.round((w / Math.max(1, cols.length)) * 100) / 100, style: StyleSchema.parse({}) }));
      const element: Element = { id: allocateId("table"), type: "table", x: target.x, y: target.y, w, h: 40, source: canvasPath(field, report), columns,
        repeatHeader: true, overflow: "continue", keepTogether: "row", rowHeight: 6, headerHeight: 7, border: "all",
        borderStyle: { stroke: "#000000", strokeWidth: 0.2 }, headerStyle: {}, groups: [], pageFooter: [], footer: [], flow: "once", style: StyleSchema.parse({}) };
      return { action: "addElement", element };
    }
    return { action: "addElement", element: textElement(allocateId("text"), target.x, target.y, `{{ ${canvasPath(field, report)} }}`) };
  }
  if (target.kind === "table") {
    const table = findById(report, target.tableId);
    if (!table || table.type !== "table") return { action: "none", warning: "표를 찾을 수 없습니다" };
    if (field.isArray) return { action: "none", warning: "배열은 표 열이 될 수 없습니다" };
    const src = sourceDataset(table.source);
    // 소스가 데이터셋 이름이면 그 데이터셋 필드만 row 상대. 상대 소스(record.items 등)는 어느 데이터셋인지 알 수 없어 row 상대로 신뢰한다
    const relative = src === undefined || src === field.dataset;
    const column: TableColumn = { header: last(field.path), value: relative ? `{{ row.${field.path} }}` : `{{ ${field.dataset}.${field.path} }}`, w: 30, style: StyleSchema.parse({}) };
    return relative ? { action: "addColumn", tableId: table.id, column } : { action: "addColumn", tableId: table.id, column, warning: "표 소스와 다른 데이터셋" };
  }
  const rep = findById(report, target.repeaterId);
  if (!rep || rep.type !== "repeater") return { action: "none", warning: "반복 영역을 찾을 수 없습니다" };
  if (field.isArray) return { action: "none", warning: "배열은 반복 항목 텍스트가 될 수 없습니다" };
  const src = sourceDataset(rep.source);
  const relative = src === undefined || src === field.dataset;
  const element = textElement(allocateId("text"), target.x, target.y, relative ? `{{ item.${field.path} }}` : `{{ ${field.dataset}.${field.path} }}`);
  const result: DropResult = { action: "addElement", element, into: { repeaterId: rep.id, band: "item" } };
  return relative ? result : { ...result, warning: "반복 영역 소스와 다른 데이터셋" };
}
