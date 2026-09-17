import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100, margin: [5, 5, 5, 5] },
  datasets: [{ name: "items", type: "static", rows: rows(20) }, { name: "lots", type: "static", rows: rows(3) }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
  { id: "cards", type: "repeater", x: 5, y: 60, w: 90, h: 30, source: "lots", layout: "grid", item: { w: 30, h: 20, children: [{ id: "nm", type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.N }}" }] } },
  { id: "fixed", type: "rect", x: 80, y: 5, w: 10, h: 10, flow: "every" },
]});

function mount(store: EditorStore) {
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  const q = (sel: string) => utils.container.querySelector(sel) as HTMLElement | null;
  const all = (sel: string) => Array.from(utils.container.querySelectorAll<HTMLElement>(sel));
  return { ...utils, q, all };
}
const ptr = (clientX: number, clientY: number) => ({ pointerId: 1, clientX, clientY });
const px = (mm: number) => mmToPxScaled(mm, 1);

beforeAll(() => {
  class PointerEventStub extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; } }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});
afterEach(cleanup);

describe("Canvas (phase 2)", () => {
  it("draws the page chosen by view and clamps when pages shrink", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    expect(q(".dp-page")?.getAttribute("data-page-index")).toBe("0");
    act(() => store.getState().setView({ pageInCopy: 2 }));
    expect(q(".dp-page")?.getAttribute("data-page-index")).toBe("2");
    expect(all('[data-role="cell"]').length).toBe(7);                                  // 머리 + 6행 (14..19)
    expect(q('[data-element-id="fixed"]')).not.toBeNull();
    act(() => store.getState().setDatasets([{ name: "items", type: "static", rows: rows(2) }, { name: "lots", type: "static", rows: rows(3) }]));
    expect(store.getState().view.pageInCopy).toBe(0);                                  // 페이지가 줄어 마지막 페이지로
    expect(q(".dp-page")?.getAttribute("data-page-index")).toBe("0");
  });
  it("selects the table via its flowBox or a cell, and shows its box", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    fireEvent.pointerDown(all('[data-role="cell"]')[2], ptr(px(10), px(35)));
    fireEvent.pointerUp(q('[data-testid="canvas"]')!, ptr(px(10), px(35)));
    expect(store.getState().selection).toEqual(["t"]);
    const box = q(".border-blue-500.pointer-events-none") as HTMLElement;
    expect(box.style.left).toBe("5mm");
    expect(box.style.top).toBe("20mm");
    expect(box.style.height).toBe("30mm");
  });
  it("maps a click on a non-template instance to the template child, dims other instances and outlines the template slot", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    const nm = all('[data-element-id="nm"]');
    expect(nm).toHaveLength(3);
    expect(nm[0].style.opacity).toBe("");
    expect(nm[1].style.opacity).toBe("0.5");
    expect(q('[data-testid="template-outline"]')).not.toBeNull();
    expect(all('[data-element-id="t"][data-role="cell"]').every((el) => el.style.opacity === "")).toBe(true);
    fireEvent.pointerDown(nm[2], ptr(px(70), px(62)));
    fireEvent.pointerUp(q('[data-testid="canvas"]')!, ptr(px(70), px(62)));
    expect(store.getState().selection).toEqual(["nm"]);
    const box = q(".border-blue-500.pointer-events-none") as HTMLElement;
    expect(box.style.left).toBe("6mm");                                                // 템플릿(첫 항목) 위치 5+1
  });
  it("drags a template child and commits relative coordinates", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    const nm = all('[data-element-id="nm"]')[0];
    fireEvent.pointerDown(nm, ptr(px(8), px(63)));
    fireEvent.pointerMove(q('[data-testid="canvas"]')!, ptr(px(8 + 10), px(63)));
    fireEvent.pointerUp(q('[data-testid="canvas"]')!, ptr(px(8 + 10), px(63)));
    expect(store.getState().findElement("nm")).toMatchObject({ x: 11, y: 1 });
    expect(all('[data-element-id="nm"]').every((el) => el.style.left === "16mm" || el.style.left === "46mm" || el.style.left === "76mm")).toBe(true);
  });
});
