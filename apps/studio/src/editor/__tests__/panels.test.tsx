import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, ElementSchema, type Element } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../store";
import { ElementPalette } from "../panels/ElementPalette";
import { PagePanel } from "../panels/PagePanel";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
]});

function mount(store: EditorStore, ui: React.ReactNode) {
  return render(<EditorContext.Provider value={store}>{ui}</EditorContext.Provider>);
}

afterEach(cleanup);

describe("ElementPalette", () => {
  it("allocates sequential ids per type and selects the new element", () => {
    const store = createEditorStore(report);
    mount(store, <ElementPalette />);
    fireEvent.click(screen.getByText("+ 텍스트"));
    fireEvent.click(screen.getByText("+ 텍스트"));
    fireEvent.click(screen.getByText("+ 페이지번호"));
    const ids = store.getState().report.elements.map((e) => e.id);
    expect(ids).toEqual(["a", "text-1", "text-2", "pn-1"]);
    expect(store.getState().selection).toEqual(["pn-1"]);
    expect(store.getState().findElement("pn-1")).toMatchObject({ type: "pageNumber", flow: "every" });
  });

  it("skips ids that already exist, including inside groups", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "rect-1", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "rect-2", type: "rect", x: 0, y: 0, w: 1, h: 1 }] },
    ]}));
    mount(store, <ElementPalette />);
    fireEvent.click(screen.getByText("+ 사각형"));
    expect(store.getState().selection).toEqual(["rect-3"]);
  });

  it("creates elements that already satisfy the core schema defaults", () => {
    const store = createEditorStore(report);
    mount(store, <ElementPalette />);
    for (const label of ["+ 텍스트", "+ 이미지", "+ 선", "+ 사각형", "+ 페이지번호"]) fireEvent.click(screen.getByText(label));
    for (const el of store.getState().report.elements) expect(ElementSchema.parse(el)).toEqual(el);
    expect(store.getState().findElement("line-1")).toMatchObject({ x2: 60, y2: 10, style: { stroke: "#000" } });
  });
});

describe("PagePanel", () => {
  it("applies a preset and reflects it in the select", () => {
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    expect((screen.getByLabelText("프리셋") as HTMLSelectElement).value).toBe("사용자 정의");
    fireEvent.change(screen.getByLabelText("프리셋"), { target: { value: "A4 가로" } });
    expect(store.getState().report.page).toMatchObject({ width: 297, height: 210 });
    expect((screen.getByLabelText("프리셋") as HTMLSelectElement).value).toBe("A4 가로");
    // "사용자 정의"를 고르면 크기는 그대로 둔다
    fireEvent.change(screen.getByLabelText("프리셋"), { target: { value: "사용자 정의" } });
    expect(store.getState().report.page).toMatchObject({ width: 297, height: 210 });
  });

  it("edits width and height in mm", () => {
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("높이(mm)"), { target: { value: "40" } });
    expect(store.getState().report.page).toMatchObject({ width: 60, height: 40 });
    expect((screen.getByLabelText("프리셋") as HTMLSelectElement).value).toBe("Tag 60×40");
  });

  it("ignores empty or non-positive size input instead of committing it", () => {
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    const before = store.getState().history.past.length;
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("높이(mm)"), { target: { value: "-5" } });
    expect(store.getState().report.page).toMatchObject({ width: 100, height: 100 });
    expect(store.getState().history.past.length).toBe(before);
  });
});

describe("palette (phase 2)", () => {
  it("adds a table and a repeater with a default template child", () => {
    const store = createEditorStore(report);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 표" }));
    // 스키마(min 1)를 만족하는 기본 소스 — 데이터셋이 없으면 "items"
    expect(store.getState().findElement("table-1")).toMatchObject({ type: "table", source: "items", columns: [{ header: "열 1" }] });
    fireEvent.click(getByRole("button", { name: "+ 반복 영역" }));
    const rep = store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>;
    expect(rep).toMatchObject({ type: "repeater", source: "items", layout: "list", item: { w: 60, h: 20 } });
    expect(rep.item.children[0]).toMatchObject({ type: "text", value: "항목 {{ index + 1 }}" });
    expect(store.getState().selection).toEqual(["repeater-1"]);
  });
  it("uses the first dataset's name as the default source when one exists", () => {
    const withDataset = parseReport({ id: "r2", version: 1, page: { width: 100, height: 100 },
      datasets: [{ name: "lots", type: "static", rows: [{ NAME: "L1" }] }], elements: [] });
    const store = createEditorStore(withDataset);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 반복 영역" }));
    expect(store.getState().findElement("repeater-1")).toMatchObject({ type: "repeater", source: "lots" });
  });
  it("adds into the selected repeater's template", () => {
    const store = createEditorStore(report);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 반복 영역" }));
    fireEvent.click(getByRole("button", { name: "+ 사각형" }));
    const rep = store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>;
    expect(rep.item.children.map((c) => c.id)).toEqual(["text-1", "rect-1"]);
    store.getState().select(["rect-1"]);                                       // 템플릿 자식이 선택돼도 같은 템플릿에
    fireEvent.click(getByRole("button", { name: "+ 텍스트" }));
    expect((store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>).item.children.map((c) => c.id)).toEqual(["text-1", "rect-1", "text-2"]);
  });
});

describe("page panel repeat switch", () => {
  it("toggles repeat with a source expression", () => {
    const store = createEditorStore(report);
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PagePanel /></EditorContext.Provider>);
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    // 스키마(min 1)를 만족하는 기본 소스 — 데이터셋이 없으면 "items"
    expect(store.getState().report.repeat).toEqual({ source: "items", as: "record" });
    fireEvent.change(getByLabelText("반복 소스"), { target: { value: "shipments" } });
    expect(store.getState().report.repeat).toEqual({ source: "shipments", as: "record" });
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    expect(store.getState().report.repeat).toBeUndefined();
  });
});
