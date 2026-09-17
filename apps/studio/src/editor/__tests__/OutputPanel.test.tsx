import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { OutputPanel } from "../panels/OutputPanel";

afterEach(cleanup);
const report = parseReport({ id: "r", version: 1, page: { width: 60, height: 40 } });
function setup() {
  const store = createEditorStore(report);
  const utils = render(<EditorContext.Provider value={store}><OutputPanel /></EditorContext.Provider>);
  return { store, out: () => store.getState().report.output, ...utils };
}

describe("OutputPanel", () => {
  it("switches to label with defaults, edits language/dpi/threshold/copies, and back to pdf", () => {
    const { getByLabelText, queryByLabelText, out } = setup();
    expect(queryByLabelText("언어")).toBeNull();
    fireEvent.change(getByLabelText("출력 종류"), { target: { value: "label" } });
    expect(out()).toEqual({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } });
    fireEvent.change(getByLabelText("언어"), { target: { value: "tspl" } });
    fireEvent.change(getByLabelText("DPI"), { target: { value: "300" } });
    fireEvent.change(getByLabelText("임계값"), { target: { value: "100" } });
    fireEvent.change(getByLabelText("매수"), { target: { value: "3" } });
    expect(out()).toEqual({ kind: "label", label: { language: "tspl", dpi: 300, threshold: 100, copies: 3 } });
    fireEvent.change(getByLabelText("출력 종류"), { target: { value: "pdf" } });
    expect(out()).toEqual({ kind: "pdf" });
  });
  it("sets and clears optional darkness/speed and ignores out-of-range values", () => {
    const { getByLabelText, out } = setup();
    fireEvent.change(getByLabelText("출력 종류"), { target: { value: "label" } });
    fireEvent.change(getByLabelText("농도"), { target: { value: "15" } });
    fireEvent.change(getByLabelText("속도"), { target: { value: "4" } });
    expect((out() as { label: { darkness?: number; speed?: number } }).label).toMatchObject({ darkness: 15, speed: 4 });
    fireEvent.change(getByLabelText("농도"), { target: { value: "" } });
    fireEvent.change(getByLabelText("속도"), { target: { value: "99" } });
    const label = (out() as { label: { darkness?: number; speed?: number } }).label;
    expect(label.darkness).toBeUndefined();
    expect(label.speed).toBe(4);
  });
});
