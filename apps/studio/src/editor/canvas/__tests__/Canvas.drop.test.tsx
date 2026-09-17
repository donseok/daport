import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, type TableElement, type RepeaterElement } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";
import { DRAG_MIME, type DragField } from "../../data/bindings";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i, NAME: `n${i}` }));
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "items", type: "static", rows: rows(3) }, { name: "lots", type: "static", rows: rows(2) }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
  { id: "cards", type: "repeater", x: 5, y: 60, w: 90, h: 30, source: "lots", layout: "grid", item: { w: 30, h: 20, children: [{ id: "nm", type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.N }}" }] } },
]});
const px = (mm: number) => mmToPxScaled(mm, 1);
const field = (over: Partial<DragField> = {}): DragField => ({ dataset: "items", path: "NAME", type: "string", isArray: false, ...over });
const dt = (f: DragField) => ({ types: [DRAG_MIME], getData: (k: string) => (k === DRAG_MIME ? JSON.stringify(f) : ""), dropEffect: "copy" });

function mount(store: EditorStore) {
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  return { ...utils, q: (sel: string) => utils.container.querySelector(sel) as HTMLElement, all: (sel: string) => Array.from(utils.container.querySelectorAll<HTMLElement>(sel)) };
}
// jsdom은 DragEvent를 구현하지 않는다: fireEvent.drop이 만드는 이벤트가 일반 Event로 대체되어 clientX/clientY가 사라진다
// (dataTransfer는 testing-library가 따로 붙여준다). MouseEvent를 상속한 대역으로 좌표를 되살린다
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  class DragEventStub extends MouseEvent { constructor(type: string, init: MouseEventInit = {}) { super(type, init); } }
  (window as unknown as { DragEvent: unknown }).DragEvent = DragEventStub;
});
afterEach(cleanup);

describe("Canvas drop", () => {
  it("drops a dataset root on the empty page as a table at the snapped position", () => {
    const store = createEditorStore(report);
    const { q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: px(70.3), clientY: px(10.2), dataTransfer: dt(field({ path: "", type: "array", isArray: true, children: [{ name: "N", path: "N", type: "number" }] })) });
    expect(store.getState().findElement("table-1")).toMatchObject({ type: "table", x: 70.5, y: 10, source: "items", columns: [{ value: "{{ row.N }}" }] });
    expect(store.getState().selection).toEqual(["table-1"]);
  });
  it("drops a field on a table cell or flowBox as a new column", () => {
    const store = createEditorStore(report);
    const { all, q } = mount(store);
    fireEvent.drop(all('[data-element-id="t"][data-role="cell"]')[1], { clientX: px(10), clientY: px(30), dataTransfer: dt(field()) });
    expect((store.getState().findElement("t") as TableElement).columns.map((c) => c.value)).toEqual(["{{ row.N }}", "{{ row.NAME }}"]);
    fireEvent.drop(q('[data-element-id="t"][data-role="flowBox"]'), { clientX: px(10), clientY: px(30), dataTransfer: dt(field({ dataset: "lots", path: "X" })) });
    expect((store.getState().findElement("t") as TableElement).columns).toHaveLength(3);
    expect(q('[data-testid="drop-warning"]').textContent).toContain("다른 데이터셋");
  });
  it("drops a field on the template slot or on any instance child as a text inside the item template", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    fireEvent.drop(q('[data-element-id="cards"][data-role="template"]'), { clientX: px(15), clientY: px(70), dataTransfer: dt(field({ dataset: "lots", path: "NAME" })) });
    let cards = store.getState().findElement("cards") as RepeaterElement;
    expect(cards.item.children.map((c) => c.id)).toEqual(["nm", "text-1"]);
    expect(cards.item.children[1]).toMatchObject({ x: 10, y: 10, value: "{{ item.NAME }}" });               // 템플릿 원점(5,60) 기준
    fireEvent.drop(all('[data-element-id="nm"]')[1], { clientX: px(40), clientY: px(65), dataTransfer: dt(field({ dataset: "lots", path: "N" })) });
    cards = store.getState().findElement("cards") as RepeaterElement;
    expect(cards.item.children.map((c) => c.id)).toEqual(["nm", "text-1", "text-2"]);
    expect(cards.item.children[2]).toMatchObject({ x: 5, y: 5, value: "{{ item.N }}" });                   // 두 번째 항목(35,60) 기준 → 템플릿 상대
  });
  it("ignores drops without the field mime", () => {
    const store = createEditorStore(report);
    const { q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: 10, clientY: 10, dataTransfer: { types: ["text/plain"], getData: () => "" } });
    expect(store.getState().report.elements).toHaveLength(2);
  });
});
