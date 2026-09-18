import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { createEditorStore } from "../store";
import { proposalFromEdit } from "../ai/proposal";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "a", type: "text", x: 0, y: 0, w: 10, h: 5, value: "A" }] });
const reportAB = parseReport({ id: "r2", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 0, y: 0, w: 10, h: 5, value: "A" },
  { id: "b", type: "rect", x: 0, y: 10, w: 10, h: 5 },
]});

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
  it("setProposal rejects a proposal whose base no longer matches the current report", () => {
    const s = createEditorStore(report);
    // AI 요청이 오가는 동안 편집이 있었다고 가정: p는 옛 report에서 만든 제안이다
    const p = proposalFromEdit(report, { patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "", warnings: [] });
    s.getState().updateElement("a", { x: 5 });   // report가 새 객체로 바뀐다
    expect(s.getState().setProposal(p)).toBe(false);
    expect(s.getState().proposal).toBeNull();
  });
  it("applyProposal discards a stale proposal without touching the report", () => {
    const s = createEditorStore(report);
    const p = proposalFromEdit(report, { patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "", warnings: [] });
    s.getState().updateElement("a", { x: 5 });   // apply가 이미 proposal을 null로 비웠다 — 정상 경로로는 여기서 끝
    const changedReport = s.getState().report;
    // 정상적인 스토어 액션만으로는 "proposal이 있는데 base가 report와 다른" 상태를 다시 만들 수 없다(apply·travel이
    // report를 바꿀 때마다 proposal도 함께 비우기 때문이다). applyProposal 자체의 방어 검사를 확인하려고 zustand의
    // setState로 그 상태를 직접 주입한다 — 이는 실제로 일어날 수 없는 상황을 흉내 낸 것이고, 방어선이 있다는 것만 본다
    s.setState({ proposal: p });
    s.getState().applyProposal();
    expect(s.getState().report).toBe(changedReport);
    expect(s.getState().proposal).toBeNull();
  });
  it("applyProposal prunes selection ids the proposal removed", () => {
    const s = createEditorStore(reportAB);
    s.getState().select(["a", "b"]);
    const p = proposalFromEdit(reportAB, { patch: [{ op: "remove", path: "/elements/1" }], explanation: "", warnings: [] });
    s.getState().setProposal(p);
    s.getState().applyProposal();
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["a"]);
    expect(s.getState().selection).toEqual(["a"]);
  });
});
