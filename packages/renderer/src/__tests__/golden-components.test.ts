import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { fixtureContext } from "./fixtures/context";
import demo from "./fixtures/component-demo.report.json";

const text = (i: unknown) => (i as { lines: string[] }).lines.join("");

describe("golden: component example", () => {
  it("component-demo lays out two header instances and a splitting table component, and matches its snapshot", () => {
    const report = parseReport(demo);
    const pages = layout(report, fixtureContext(report));
    expect(pages.flatMap((p) => p.items).filter((i) => i.error)).toEqual([]);
    expect(pages).toHaveLength(2);                                              // 첫 영역 112mm, 이어지는 영역 267-54=213mm, 40행
    for (const p of pages) {
      expect(p.items.filter((i) => i.role === "refBox").map((i) => i.elementId)).toEqual(["hdr-top", "checks", "hdr-bottom"]);
      const keys = p.items.filter((i) => i.role === undefined || i.role === "refBox").map((i) => `${i.elementId}|${i.instance}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(p.items.filter((i) => i.elementId === "hdr-top" && i.instance === "hdr-top/ttl").map(text)).toEqual(["품질 검사 성적서"]);
      expect(p.items.filter((i) => i.elementId === "hdr-bottom" && i.instance === "hdr-bottom/ttl").map(text)).toEqual(["확인"]);
      expect(p.items.filter((i) => i.instance === "checks/t/t#h" && i.role === "cell")).toHaveLength(3);   // 머리 반복
    }
    expect(pages.map((p) => text(p.items.find((i) => i.instance === "hdr-bottom/sub")))).toEqual(["L-2026-0917 · 1/2", "L-2026-0917 · 2/2"]);
    expect(pages.map((p) => text(p.items.find((i) => i.instance === "hdr-top/sub")))).toEqual(["LOT L-2026-0917", "LOT L-2026-0917"]);
    expect(pages[0].items.filter((i) => i.instance === "checks/cap").map(text)).toEqual(["2라인 검사 항목 (40건)"]);
    expect(pages[1].items.some((i) => i.instance === "checks/cap")).toBe(false);   // ref.flow once
    const rowCells = pages.map((p) => p.items.filter((i) => i.role === "cell" && /^checks\/t\/t#\d+$/.test(i.instance ?? "") && i.elementId === "checks"));
    expect(rowCells.every((c) => c.length > 0)).toBe(true);
    expect(new Set(rowCells.flat().map((i) => i.instance)).size).toBe(40);
    expect(rowCells.flat().filter((i) => i.x === 10).map(text).slice(0, 2)).toEqual(["1", "2"]);
    expect(pages.flatMap((p) => p.items).find((i) => i.role === "refBox" && i.elementId === "checks")).toMatchObject({ x: 10, y: 46, w: 190, h: 120 });
    expect(pages).toMatchSnapshot();
  });
});
