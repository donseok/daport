import { describe, it, expect, beforeEach } from "vitest";
import { parseReport, ElementSchema } from "@daport/core";
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
