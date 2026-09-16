import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
]});

describe("PropertyPanel", () => {
  it("shows nothing selected message", () => {
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    expect(screen.getByText(/선택된 요소가 없습니다/)).toBeTruthy();
  });
  it("edits x and value of selected text", () => {
    const store = createEditorStore(report);
    store.getState().select(["a"]);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "{{ params.x }}" } });
    expect(store.getState().findElement("a")).toMatchObject({ x: 15, value: "{{ params.x }}" });
  });
});
