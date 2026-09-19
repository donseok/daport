import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { diffIds, proposalFromEdit, proposalFromGenerate, proposalFromImport } from "../proposal";

const base = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 0, y: 0, w: 10, h: 5, value: "A" },
  { id: "b", type: "rect", x: 0, y: 10, w: 10, h: 5 },
]});

describe("proposal", () => {
  it("diffIds reports added, changed and removed element ids (nested included)", () => {
    const after = parseReport({ ...base, elements: [{ ...base.elements[0], value: "A2" }, { id: "c", type: "rect", x: 0, y: 20, w: 5, h: 5 }] });
    expect(diffIds(base, after)).toEqual({ added: ["c"], changed: ["a"], removed: ["b"] });
  });
  it("proposalFromEdit applies the patch to a copy and never mutates the base", () => {
    const p = proposalFromEdit(base, { patch: [{ op: "replace", path: "/elements/0/value", value: "X" }], explanation: "e", warnings: [] });
    expect(p.next.elements[0]).toMatchObject({ value: "X" });
    expect(base.elements[0]).toMatchObject({ value: "A" });
    expect(p.changes.changed).toEqual(["a"]);
    expect(p.kind).toBe("edit");
  });
  it("proposalFromEdit summarizes ops outside /elements (I1)", () => {
    const p = proposalFromEdit(base, { patch: [
      { op: "add", path: "/datasets/-", value: { name: "ds1", type: "static", rows: [] } },
      { op: "replace", path: "/name", value: "새 이름" },
    ], explanation: "e", warnings: [] });
    expect(p.otherOps).toContain("datasets 1건 추가");
    expect(p.otherOps).toContain("name 1건 변경");
    expect(p.changes).toEqual({ added: [], changed: [], removed: [] });   // diffIds는 이 변화를 못 본다
  });
  it("proposalFromGenerate puts elements and components into the next report", () => {
    const empty = parseReport({ id: "e", version: 1, page: { width: 100, height: 100 } });
    const p = proposalFromGenerate(empty, { elements: [base.elements[0]], components: {}, explanation: "g", warnings: ["w"] });
    expect(p.next.elements).toHaveLength(1);
    expect(p.changes.added).toEqual(["a"]);
    expect(p.warnings).toEqual(["w"]);
  });
  it("proposalFromImport는 요소·파라미터·데이터셋을 함께 넣는다", () => {
    const p = proposalFromImport(base, {
      elements: [{ id: "t1", type: "text", x: 1, y: 1, w: 10, h: 5, value: "A" } as never],
      params: [{ name: "lotNo", type: "string" } as never],
      datasets: [{ name: "rows1", type: "static", rows: [] } as never],
      explanation: "옮겼습니다",
      warnings: ["도장 못 읽음"],
    });
    expect(p.kind).toBe("import");
    expect(p.next.elements).toHaveLength(1);
    expect(p.next.params.map((x) => x.name)).toContain("lotNo");
    expect(p.next.datasets.map((d) => d.name)).toContain("rows1");
    expect(p.changes.added).toEqual(["t1"]);
    expect(p.warnings).toContain("도장 못 읽음");
  });
});
