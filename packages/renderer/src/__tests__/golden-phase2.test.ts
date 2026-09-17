import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { fixtureContext } from "./fixtures/context";
import inspection from "./fixtures/inspection-cert.report.json";
import invoice from "./fixtures/invoice.report.json";
import shipping from "./fixtures/shipping-order.report.json";
import badges from "./fixtures/badge-sheet.report.json";

const cases: [string, unknown, (pages: ReturnType<typeof layout>) => void][] = [
  ["inspection-cert", inspection, (pages) => {
    expect(pages.length).toBeGreaterThanOrEqual(3);                                   // L-001 2장 이상 + L-002 1장
    expect(pages.filter((p) => p.copyIndex === 1)).toHaveLength(1);
    // border: "all"이라 열마다 테두리 rect + 텍스트 2항목 → 4열 = 8항목. 머리 반복 자체(양쪽 페이지에 결과 4)는 아래서 별도 확인
    expect(pages[0].items.filter((i) => i.instance === "results#h")).toHaveLength(8);   // 머리 반복
    expect(pages[1].items.filter((i) => i.instance === "results#h")).toHaveLength(8);
    expect(pages[0].items.filter((i) => i.instance === "results#h" && i.kind === "text")).toHaveLength(4);
    expect(pages[1].items.filter((i) => i.instance === "results#h" && i.kind === "text")).toHaveLength(4);
    expect(pages[0].items.some((i) => i.instance?.startsWith("results#g0h"))).toBe(true);
    expect(pages[0].items.some((i) => i.instance === "results#pf")).toBe(true);
    const last = pages.filter((p) => p.copyIndex === 0).at(-1)!;
    expect(last.items.some((i) => i.instance === "results#f")).toBe(true);
    expect(last.items.some((i) => i.elementId === "sign")).toBe(true);
    expect(pages[0].items.some((i) => i.elementId === "sign")).toBe(false);
  }],
  ["invoice", invoice, (pages) => {
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.copyIndex)).toEqual([0, 1]);
    const footer = pages[0].items.filter((i) => i.instance === "items#f" && i.kind === "text").map((i) => (i as { lines: string[] }).lines.join(""));
    expect(footer).toEqual(["합계", "240", "", expect.any(String)]);
    expect(pages[0].items.some((i) => i.elementId === "note")).toBe(true);
  }],
  ["shipping-order", shipping, (pages) => {
    expect(pages).toHaveLength(1);
    expect(pages[0].items.filter((i) => i.elementId === "gh-t").length).toBe(2);        // 1라인, 2라인
    expect(pages[0].items.filter((i) => i.elementId === "card-no").map((i) => i.instance)).toEqual(["cards#0", "cards#1", "cards#2"]);
    expect(pages[0].items.filter((i) => i.instance === "cards#2/card-items#2" && i.role === "cell").length).toBe(2);   // O-3의 세 번째 행
    expect(pages[0].items.filter((i) => i.instance === "cards#1/card-items#1")).toHaveLength(0);             // O-2는 한 행
  }],
  ["badge-sheet", badges, (pages) => {
    expect(pages).toHaveLength(2);                                                       // 3열 × 6줄 = 18장/페이지, 30명
    expect(pages[0].items.filter((i) => i.elementId === "b-name")).toHaveLength(18);
    expect(pages[1].items.filter((i) => i.elementId === "b-name")).toHaveLength(12);
    expect(pages[0].items.find((i) => i.role === "template")).toMatchObject({ x: 10, y: 10, w: 60, h: 35 });
  }],
];

describe("golden: phase 2 examples", () => {
  it.each(cases)("%s lays out without errors and matches its snapshot", (_name, fixture, check) => {
    const report = parseReport(fixture);
    const pages = layout(report, fixtureContext(report));
    expect(pages.flatMap((p) => p.items).filter((i) => i.error)).toEqual([]);
    check(pages);
    expect(pages).toMatchSnapshot();
  });
});
