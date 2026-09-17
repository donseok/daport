import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { paginate } from "../flow/paginate";
import { RegionTooSmallError } from "../layout/errors";
import type { Block } from "../flow/types";

const page = { width: 210, height: 297, margin: [10, 10, 10, 10] as [number, number, number, number] };
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const table = (extra: Record<string, unknown> = {}) => ({ id: "t", type: "table", x: 10, y: 20, w: 190, h: 200, source: "items", rowHeight: 6,
  columns: [{ header: "N", value: "{{ row.N }}", w: 190 }], ...extra });
const mk = (elements: unknown[], extra: Record<string, unknown> = {}) => parseReport({ id: "r", version: 1, page, elements, ...extra });
const cellBottom = (items: { role?: string; y: number; h: number }[]) => Math.max(...items.filter((i) => i.role === "cell").map((i) => i.y + i.h));

describe("continuation region", () => {
  it("stops above every/last fixed elements that sit below the table and overlap it horizontally", () => {
    const pages = layout(mk([table(),
      { id: "total", type: "text", x: 10, y: 250, w: 190, h: 10, value: "합계", flow: "last" },
      { id: "pn", type: "pageNumber", x: 10, y: 280, w: 190, h: 6, flow: "every" },
    ]), { params: {}, items: rows(120) });
    expect(pages.length).toBeGreaterThan(2);
    for (const p of pages.slice(1)) expect(cellBottom(p.items)).toBeLessThanOrEqual(250 + 1e-6);
  });
  it("ignores fixed elements that do not overlap horizontally, sit above the table bottom, or are once-only", () => {
    const pages = layout(mk([table(),
      { id: "side", type: "pageNumber", x: 205, y: 240, w: 3, h: 5, flow: "every" },
      { id: "inside", type: "text", x: 10, y: 100, w: 20, h: 5, value: "x", flow: "every" },
      { id: "once", type: "text", x: 10, y: 230, w: 190, h: 5, value: "x" },
    ]), { params: {}, items: rows(120) });
    expect(cellBottom(pages[1].items)).toBeGreaterThan(260);                        // 하단 여백(287)까지 쓴다
  });
  it("uses the top of a line drawn bottom-to-top", () => {
    const pages = layout(mk([table(), { id: "ln", type: "line", x: 10, y: 270, w: 190, h: 10, x2: 200, y2: 260, flow: "every" }]), { params: {}, items: rows(120) });
    for (const p of pages.slice(1)) expect(cellBottom(p.items)).toBeLessThanOrEqual(260 + 1e-6);
  });
});

describe("region too small for any block", () => {
  it("renders the flow element as one #ERR on one page instead of one page per row", () => {
    const pages = layout(mk([table({ y: 280, h: 10 })]), { params: {}, items: rows(30) });
    expect(pages).toHaveLength(1);
    const err = pages[0].items.find((i) => i.elementId === "t" && i.error);
    expect(err).toMatchObject({ kind: "text", lines: ["#ERR"] });
    expect(err!.error).toMatch(/region/);
  });
  it("throws in fail mode", () => {
    expect(() => layout(mk([table({ y: 280, h: 10 })], { onExpressionError: "fail" }), { params: {}, items: rows(30) })).toThrow(RegionTooSmallError);
  });
  it("still allows a single oversized row when other rows fit (rule 5)", () => {
    const blk = (h: number): Block => ({ kind: "row", height: h, keepWithNext: false, rows: [{ h }], paint: () => [] });
    const pages = paginate({ body: [blk(5), blk(80), blk(5)] }, { first: { x: 0, y: 0, w: 10, h: 10 }, next: { x: 0, y: 0, w: 10, h: 50 }, repeatHeader: false, clip: false });
    expect(pages.map((p) => p.overflow)).toEqual([false, true, false]);
  });
  it("paginate throws when continuation pages cannot hold even the smallest block", () => {
    const blk = (h: number): Block => ({ kind: "row", height: h, keepWithNext: false, rows: [{ h }], paint: () => [] });
    const header: Block = { kind: "header", height: 7, keepWithNext: false, rows: [], paint: () => [] };
    expect(() => paginate({ header, body: [blk(6), blk(6), blk(6)] }, { first: { x: 0, y: 0, w: 10, h: 10 }, next: { x: 0, y: 0, w: 10, h: 12 }, repeatHeader: true, clip: false })).toThrow(RegionTooSmallError);
    expect(paginate({ header, body: [blk(6)] }, { first: { x: 0, y: 0, w: 10, h: 20 }, next: { x: 0, y: 0, w: 10, h: -5 }, repeatHeader: true, clip: false })).toHaveLength(1);
  });
});
