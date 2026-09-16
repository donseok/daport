import { describe, it, expect, beforeEach } from "vitest";
import { parseReport, ElementSchema, type Element } from "@daport/core";
import { createEditorStore } from "../store";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
]});

describe("editor store", () => {
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(report); });

  it("selects and moves elements with undo", () => {
    store.getState().select(["a"]);
    store.getState().moveSelected(5, -2);
    expect(store.getState().findElement("a")).toMatchObject({ x: 15, y: 8 });
    store.getState().undo();
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });
  });
  it("updates a nested element by id", () => {
    store.getState().updateElement("b", { w: 9 });
    expect(store.getState().findElement("b")).toMatchObject({ w: 9 });
  });
  it("adds, duplicates and deletes", () => {
    store.getState().addElement(ElementSchema.parse({ id: "n", type: "rect", x: 0, y: 0, w: 1, h: 1 }));
    expect(store.getState().findElement("n")).toBeTruthy();
    store.getState().select(["n"]);
    store.getState().duplicateSelected();
    expect(store.getState().report.elements).toHaveLength(4);
    expect(store.getState().selection).toHaveLength(1);
    expect(store.getState().selection[0]).not.toBe("n");
    store.getState().deleteSelected();
    expect(store.getState().report.elements).toHaveLength(3);
  });
  it("duplicates a group child inside its group, right after the original, offset in group coordinates", () => {
    store.getState().select(["b"]);
    store.getState().duplicateSelected();
    const g = store.getState().findElement("g") as Extract<Element, { type: "group" }>;
    expect(g.children.map((c) => c.id)).toEqual(["b", "b-1"]);
    expect(g.children[1]).toMatchObject({ type: "rect", x: 6, y: 6, w: 5, h: 5 });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "g"]);
    expect(store.getState().selection).toEqual(["b-1"]);
    store.getState().undo();
    expect(g.children).toHaveLength(2);                                             // 이전 스냅샷은 그대로
    expect((store.getState().findElement("g") as typeof g).children.map((c) => c.id)).toEqual(["b"]);
  });
  it("gives a duplicated group's children fresh ids and moves a line's end point with it", () => {
    const s = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
      { id: "l", type: "line", x: 10, y: 40, w: 30, h: 0, x2: 40, y2: 40 },
    ]}));
    s.getState().select(["g", "l"]);
    s.getState().duplicateSelected();
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["g", "g-1", "l", "l-1"]);
    expect((s.getState().findElement("g-1") as Extract<Element, { type: "group" }>).children.map((c) => c.id)).toEqual(["b-1"]);
    expect(s.getState().findElement("l-1")).toMatchObject({ x: 15, y: 45, x2: 45, y2: 45 });
    expect(s.getState().selection).toEqual(["g-1", "l-1"]);
    expect(s.getState().replaceReport(JSON.parse(JSON.stringify(s.getState().report)))).toBe(true);   // 중복 id 없음
  });
  it("rejects a JSON edit that changes the report id", () => {
    expect(store.getState().replaceReport({ ...report, id: "quality-cert" })).toBe(false);
    expect(store.getState().problems).toEqual([{ path: "id", message: "id는 바꿀 수 없습니다" }]);
    expect(store.getState().report.id).toBe("r");
    expect(store.getState().history.past).toHaveLength(0);
  });
  it("clearing an optional field leaves no dead undo step when the JSON editor echoes the model back", () => {
    store.getState().updateElement("a", { visible: "{{ true }}" });
    store.getState().updateElement("a", { visible: undefined });
    const past = store.getState().history.past.length;
    expect(store.getState().replaceReport(JSON.parse(JSON.stringify(store.getState().report)))).toBe(true);
    expect(store.getState().history.past).toHaveLength(past);
  });
  it("undo/redo with nothing to do keep the report clean", () => {
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });
  it("undo drops selected ids that no longer exist", () => {
    store.getState().addElement(ElementSchema.parse({ id: "n", type: "rect", x: 0, y: 0, w: 1, h: 1 }));
    expect(store.getState().selection).toEqual(["n"]);
    store.getState().undo();
    expect(store.getState().selection).toEqual([]);
  });
  it("replaces whole report from JSON text and reports validation errors", () => {
    const ok = store.getState().replaceReport({ ...report, name: "new" });
    expect(ok).toBe(true);
    expect(store.getState().report.name).toBe("new");
    const bad = store.getState().replaceReport({ ...report, elements: [{ id: "z", type: "nope" }] } as any);
    expect(bad).toBe(false);
    expect(store.getState().problems.length).toBeGreaterThan(0);
    expect(store.getState().report.name).toBe("new");   // 마지막 유효 모델 유지
  });
  it("updates page size", () => {
    store.getState().updatePage({ width: 297, height: 210 });
    expect(store.getState().report.page).toMatchObject({ width: 297, height: 210 });
  });
  it("marks dirty after change and clean after markSaved", () => {
    expect(store.getState().dirty).toBe(false);
    store.getState().updatePage({ width: 50 });
    expect(store.getState().dirty).toBe(true);
    store.getState().markSaved();
    expect(store.getState().dirty).toBe(false);
  });
});
