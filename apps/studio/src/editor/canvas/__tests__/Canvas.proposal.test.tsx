import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { proposalFromEdit } from "../../ai/proposal";

afterEach(cleanup);
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 0, y: 0, w: 30, h: 5, value: "A" }, { id: "b", type: "rect", x: 0, y: 10, w: 10, h: 5 }] });

describe("Canvas proposal overlay", () => {
  it("draws the shadow page, highlights changes and applies from the bar", () => {
    const store = createEditorStore(report);
    const { container, getByTestId, queryByTestId } = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
    expect(queryByTestId("ai-proposal")).toBeNull();
    act(() => store.getState().setProposal(proposalFromEdit(report, {
      patch: [{ op: "replace", path: "/elements/0/value", value: "AI" }, { op: "remove", path: "/elements/1" }, { op: "add", path: "/elements/-", value: { id: "c", type: "rect", x: 50, y: 50, w: 10, h: 10 } }],
      explanation: "e", warnings: ["w1"] })));
    const overlay = getByTestId("ai-proposal");
    expect(overlay.textContent).toContain("AI");
    expect(container.querySelector('[data-ai-change="changed"][data-ai-id="a"]')).not.toBeNull();
    expect(container.querySelector('[data-ai-change="added"][data-ai-id="c"]')).not.toBeNull();
    expect(container.querySelector('[data-ai-change="removed"][data-ai-id="b"]')).not.toBeNull();
    expect(getByTestId("ai-proposal-bar").textContent).toMatch(/3.*1/);   // op 3개, 경고 1개
    fireEvent.click(getByTestId("ai-apply"));
    expect(store.getState().report.elements[0]).toMatchObject({ value: "AI" });
    expect(queryByTestId("ai-proposal")).toBeNull();
  });
});
