import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { createEditorStore } from "../store";
import { proposalFromEdit } from "../ai/proposal";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "a", type: "text", x: 0, y: 0, w: 10, h: 5, value: "A" }] });

describe("store proposal", () => {
  it("keeps the model untouched until apply, then applies as one undo step", () => {
    const s = createEditorStore(report);
    s.getState().setProposal(proposalFromEdit(report, { patch: [{ op: "replace", path: "/elements/0/value", value: "B" }, { op: "replace", path: "/elements/0/w", value: 20 }], explanation: "", warnings: [] }));
    expect(s.getState().report.elements[0]).toMatchObject({ value: "A", w: 10 });
    expect(s.getState().dirty).toBe(false);
    s.getState().applyProposal();
    expect(s.getState().report.elements[0]).toMatchObject({ value: "B", w: 20 });
    expect(s.getState().proposal).toBeNull();
    s.getState().undo();
    expect(s.getState().report.elements[0]).toMatchObject({ value: "A", w: 10 });
  });
  it("reject clears without changing; any other edit discards the proposal", () => {
    const s = createEditorStore(report);
    const p = proposalFromEdit(report, { patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "", warnings: [] });
    s.getState().setProposal(p); s.getState().rejectProposal();
    expect(s.getState().proposal).toBeNull(); expect(s.getState().report.elements[0]).toMatchObject({ value: "A" });
    s.getState().setProposal(p);
    s.getState().updateElement("a", { x: 5 });
    expect(s.getState().proposal).toBeNull();
  });
});
