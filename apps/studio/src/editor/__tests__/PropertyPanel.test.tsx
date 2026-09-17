import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
]});

afterEach(cleanup);

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
  it("ignores sizes, font size, padding and stroke width the schema rejects so the report stays saveable", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A", style: { fontSize: 10, padding: 1, strokeWidth: 0.2 } },
      { id: "b", type: "rect", x: 10, y: 30, w: 20, h: 5, style: { radius: 1 } },
    ]}));
    store.getState().select(["a"]);
    const { unmount } = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    for (const [label, value] of [["W", "-1"], ["H", "-0.5"], ["글자크기", "0"], ["글자크기", "-2"], ["여백", "-1"], ["선굵기", "-0.1"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    expect(store.getState().findElement("a")).toMatchObject({ w: 20, h: 5, style: { fontSize: 10, padding: 1, strokeWidth: 0.2 } });
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "0" } });   // 0 크기는 스키마가 허용한다
    expect(store.getState().findElement("a")).toMatchObject({ w: 0 });
    unmount();
    act(() => store.getState().select(["b"]));
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(screen.getByLabelText("모서리"), { target: { value: "-1" } });
    expect(store.getState().findElement("b")).toMatchObject({ style: { radius: 1 } });
    expect(store.getState().problems).toEqual([]);
  });
  it("moves a whole line with X/Y so its box keeps matching the drawn line", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "l", type: "line", x: 10, y: 20, w: 50, h: 0, x2: 60, y2: 20 },
    ]}));
    store.getState().select(["l"]);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "30" } });
    expect(store.getState().findElement("l")).toMatchObject({ x: 15, y: 30, w: 50, h: 0, x2: 65, y2: 30 });
    expect(store.getState().history.past).toHaveLength(2);
  });
  it("resizes a line from W/H like a handle, keeping its direction, and keeps W/H in step with X2/Y2", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "l", type: "line", x: 60, y: 20, w: 50, h: 0, x2: 10, y2: 20 },
    ]}));
    store.getState().select(["l"]);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(screen.getByLabelText("W"), { target: { value: "80" } });
    expect(store.getState().findElement("l")).toMatchObject({ x: 90, y: 20, x2: 10, y2: 20, w: 80, h: 0 });
    fireEvent.change(screen.getByLabelText("X2"), { target: { value: "30" } });
    expect(store.getState().findElement("l")).toMatchObject({ x: 90, x2: 30, w: 60 });
    expect((screen.getByLabelText("W") as HTMLInputElement).value).toBe("60");
  });
  it("accepts negative numbers and ignores an emptied number field", () => {
    const store = createEditorStore(report);
    store.getState().select(["a"]);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "-3" } });
    expect(store.getState().findElement("a")).toMatchObject({ y: -3 });
    const past = store.getState().history.past.length;
    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "" } });
    expect(store.getState().findElement("a")).toMatchObject({ y: -3 });
    expect(store.getState().history.past.length).toBe(past);   // 0을 커밋하거나 히스토리를 쌓지 않는다
  });
});

describe("PropertyPanel barcode", () => {
  it("edits format, value, showText and font size", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "code128", value: "123" },
    ]}));
    store.getState().select(["b"]);
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(getByLabelText("형식"), { target: { value: "qr" } });
    fireEvent.change(getByLabelText("값"), { target: { value: "{{ record.NO }}" } });
    fireEvent.click(getByLabelText("텍스트 표시"));
    fireEvent.change(getByLabelText("글자크기"), { target: { value: "6" } });
    expect(store.getState().findElement("b")).toMatchObject({ format: "qr", value: "{{ record.NO }}", showText: false, style: { fontSize: 6 } });
  });
});
