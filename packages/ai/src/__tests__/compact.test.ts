import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { compactReport, compactFields, compactLibrary, estimateTokens } from "../index";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 210, height: 297 }, elements: [
  { id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "품질보증서 " + "가".repeat(60) },
  { id: "g1", type: "group", x: 0, y: 30, w: 100, h: 40, children: [{ id: "r1", type: "rect", x: 1, y: 1, w: 10, h: 10 }] },
  { id: "tb", type: "table", x: 10, y: 80, w: 190, h: 60, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
]});

describe("compactReport", () => {
  it("writes one line per element with id, type, box and truncated value", () => {
    const out = compactReport(report);
    const lines = out.trim().split("\n");
    expect(lines[0]).toMatch(/^t1 text 10,10 80×8 "품질보증서/);
    expect(lines[0].length).toBeLessThan(80);                       // 값은 40자로 자른다
    expect(out).toContain("g1 group 0,30 100×40 [자식 1]");
    expect(out).toContain("  r1 rect 1,1 10×10");                   // 자식은 들여쓰기
    expect(out).toContain("tb table 10,80 190×60 source=items 열 1");
  });
  it("drops children below the depth limit", () => {
    expect(compactReport(report, { depth: 0 })).not.toContain("r1 rect");
  });
});

describe("compactFields / compactLibrary / estimateTokens", () => {
  it("formats fields as ds.PATH: type and library items in one line", () => {
    expect(compactFields({ items: [{ name: "NO", path: "NO", type: "string" }, { name: "QTY", path: "QTY", type: "number" }] }))
      .toBe("items.NO: string\nitems.QTY: number");
    expect(compactLibrary([{ id: "header", name: "회사 헤더", version: 3, w: 190, h: 20, props: [{ name: "title", type: "text" }] }]))
      .toBe("header 회사 헤더 v3 190×20 props(title:text)");
  });
  it("estimateTokens is ceil(chars/3)", () => {
    expect(estimateTokens("abcdef")).toBe(2);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
