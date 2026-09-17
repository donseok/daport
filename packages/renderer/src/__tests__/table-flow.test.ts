import { describe, it, expect } from "vitest";
import { parseReport, type TableElement } from "@daport/core";
import { tableFlow, tableWidth } from "../flow/table";
import { paginate } from "../flow/paginate";
import { createMeasureCache } from "../text/cache";
import type { PageFlowContext } from "../flow/types";

const page = { width: 210, height: 297 };
const mkTable = (extra: Record<string, unknown> = {}): TableElement => {
  const r = parseReport({ id: "r", version: 1, page, elements: [{ id: "t", type: "table", x: 10, y: 20, w: 100, h: 60, source: "items",
    columns: [{ header: "품목", value: "{{ row.NAME }}", w: 40 }, { header: "수량", value: "{{ row.QTY }}", w: 30, align: "right" }], ...extra }] });
  return r.elements[0] as TableElement;
};
const items = [{ NAME: "A", QTY: 1, CAT: "x" }, { NAME: "B", QTY: 2, CAT: "x" }, { NAME: "C", QTY: 3, CAT: "y" }];
const opts = () => ({ measure: createMeasureCache(), onExpressionError: "blank" as const });
const pctx: PageFlowContext = { page: 1, total: 1, sheet: 1, sheets: 1, copy: 1, copies: 1, pageRows: [] };
const texts = (its: { kind: string; lines?: string[] }[]) => its.filter((i) => i.kind === "text").map((i) => (i as { lines: string[] }).lines.join(""));

describe("tableFlow", () => {
  it("builds header, one row block per row with cells, borders and instances", () => {
    const f = tableFlow(mkTable(), { params: {}, items }, opts());
    expect(f.rows).toBe(items);
    expect(f.header?.kind).toBe("header");
    expect(f.header?.height).toBe(7);
    expect(f.body.map((b) => b.kind)).toEqual(["row", "row", "row"]);
    expect(f.body[0].height).toBe(6);
    expect(f.body[0].rows).toEqual([items[0]]);
    const painted = f.body[1].paint({ x: 10, y: 50 }, pctx);
    expect(painted.map((i) => [i.kind, i.role])).toEqual([["rect", "border"], ["text", "cell"], ["rect", "border"], ["text", "cell"]]);
    expect(painted[1]).toMatchObject({ elementId: "t", instance: "t#1", x: 10, y: 50, w: 40, h: 6, lines: ["B"], style: { align: "left" } });
    expect(painted[3]).toMatchObject({ x: 50, w: 30, lines: ["2"], style: { align: "right" } });
    expect(texts(f.header!.paint({ x: 0, y: 0 }, pctx))).toEqual(["품목", "수량"]);
    expect(f.header!.paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ instance: "t#h" });
    expect(tableWidth(mkTable())).toBe(70);
  });
  it("draws one line per block for border rows and nothing for none", () => {
    const rows = tableFlow(mkTable({ border: "rows" }), { params: {}, items }, opts()).body[0].paint({ x: 10, y: 20 }, pctx);
    expect(rows.map((i) => i.kind)).toEqual(["text", "text", "line"]);
    expect(rows[2]).toMatchObject({ x: 10, y: 26, x2: 80, y2: 26 });
    expect(tableFlow(mkTable({ border: "none" }), { params: {}, items }, opts()).body[0].paint({ x: 0, y: 0 }, pctx).map((i) => i.kind)).toEqual(["text", "text"]);
  });
  it("grows a row to fit wrapped text and applies headerStyle and cell style overrides", () => {
    const long = [{ NAME: "가나다라마바사아자차카타파하 가나다라마바사아자차카타파하", QTY: 1 }];
    const f = tableFlow(mkTable({ headerStyle: { bold: true, fill: "#eee" } }), { params: {}, items: long }, opts());
    expect(f.body[0].height).toBeGreaterThan(6);
    const [, head] = f.header!.paint({ x: 0, y: 0 }, pctx);
    expect(head.style).toMatchObject({ bold: true, fill: "#eee" });
  });
  it("emits group headers/footers around consecutive keys, keepWithNext on headers, with group context", () => {
    const f = tableFlow(mkTable({ groups: [{ by: "row.CAT", header: [{ value: "분류 {{ group.key }} ({{ count(group.rows) }})", span: "all", style: { bold: true } }],
      footer: [{ value: "" }, { value: "소계 {{ sum(group.rows, 'QTY') }}" }] }] }), { params: {}, items }, opts());
    expect(f.body.map((b) => b.kind)).toEqual(["groupHeader", "row", "row", "groupFooter", "groupHeader", "row", "groupFooter"]);
    expect(f.body[0].keepWithNext).toBe(true);
    expect(f.body[0].rows).toEqual([]);
    expect(texts(f.body[0].paint({ x: 0, y: 0 }, pctx))).toEqual(["분류 x (2)"]);
    expect(f.body[0].paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ w: 70, instance: "t#g0h0", style: { bold: true } });
    expect(texts(f.body[3].paint({ x: 0, y: 0 }, pctx))).toEqual(["", "소계 3"]);
    expect(texts(f.body[6].paint({ x: 0, y: 0 }, pctx))).toEqual(["", "소계 3"]);
    expect(f.body[6].paint({ x: 0, y: 0 }, pctx)[3]).toMatchObject({ instance: "t#g0f1" });
  });
  it("nests two group levels (outer first) and gives rows the innermost group", () => {
    const rows = [{ A: 1, B: "p" }, { A: 1, B: "q" }, { A: 2, B: "q" }];
    const f = tableFlow(mkTable({ columns: [{ header: "", value: "{{ group.key }}/{{ group.level }}", w: 50 }],
      groups: [{ by: "row.A", header: [{ value: "A{{ group.key }}" }] }, { by: "row.B", header: [{ value: "B{{ group.key }}" }] }] }), { params: {}, items: rows }, opts());
    expect(f.body.map((b) => b.kind)).toEqual(["groupHeader", "groupHeader", "row", "groupHeader", "row", "groupHeader", "groupHeader", "row"]);
    expect(texts(f.body[2].paint({ x: 0, y: 0 }, pctx))).toEqual(["p/1"]);
    expect(f.body[1].keepWithNext && f.body[0].keepWithNext).toBe(true);
  });
  it("paints the page footer with that page's rows and the table footer with all rows", () => {
    const f = tableFlow(mkTable({ pageFooter: [{ value: "페이지 {{ page }}/{{ total }} 소계 {{ sum(pageRows, 'QTY') }}", span: "all" }], footer: [{ value: "합계 {{ sum(rows, 'QTY') }}", span: "all" }] }),
      { params: {}, items }, opts());
    expect(f.pageFooter?.kind).toBe("pageFooter");
    expect(f.footer?.kind).toBe("footer");
    expect(texts(f.pageFooter!.paint({ x: 0, y: 0 }, { ...pctx, page: 2, total: 3, pageRows: items.slice(0, 2) }))).toEqual(["페이지 2/3 소계 3"]);
    expect(texts(f.footer!.paint({ x: 0, y: 0 }, pctx))).toEqual(["합계 6"]);
    expect(f.pageFooter!.paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ instance: "t#pf" });
  });
  it("isolates a cell expression error to that cell in blank mode and throws in fail mode", () => {
    const bad = mkTable({ columns: [{ header: "", value: "{{ row. }}", w: 30 }, { header: "", value: "{{ row.NAME }}", w: 30 }] });
    const painted = tableFlow(bad, { params: {}, items }, opts()).body[0].paint({ x: 0, y: 0 }, pctx);
    expect(painted[1]).toMatchObject({ lines: ["#ERR"], error: expect.stringContaining("Expression") });
    expect(painted[3]).toMatchObject({ lines: ["A"] });
    expect(painted[3].error).toBeUndefined();
    expect(() => tableFlow(bad, { params: {}, items }, { ...opts(), onExpressionError: "fail" })).toThrow();
  });
  it("throws an ExpressionError for a non-array source (the caller renders #ERR)", () => {
    expect(() => tableFlow(mkTable({ source: "items[0].NAME" }), { params: {}, items }, opts())).toThrow(/source is not an array/);
    expect(tableFlow(mkTable({ source: "missing" }), { params: {}, items }, opts()).body).toEqual([]);
  });
  it("uses the instance prefix for nested tables", () => {
    const f = tableFlow(mkTable(), { params: {}, items }, { ...opts(), instancePrefix: "cards#3/" });
    expect(f.body[0].paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ instance: "cards#3/t#0" });
  });
  it("works end to end with paginate: 500 rows over several pages with repeated header", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ NAME: `n${i}`, QTY: i, CAT: i % 2 ? "a" : "b" }));
    const el = mkTable();
    const f = tableFlow(el, { params: {}, items: many }, opts());
    const pages = paginate(f, { first: { x: el.x, y: el.y, w: el.w, h: el.h }, next: { x: el.x, y: el.y, w: el.w, h: 297 - 10 - el.y }, repeatHeader: true, clip: false });
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.every((p) => p.placements[0].block.kind === "header")).toBe(true);
    expect(pages.flatMap((p) => p.pageRows)).toEqual(many);
  });
  it("lays out 10k rows in under 1 second (3 seconds on CI)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ NAME: `품목 ${i}`, QTY: i * 3, CAT: `c${i % 7}` }));
    const el = mkTable({ groups: [{ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }] }] });
    const t0 = performance.now();
    const f = tableFlow(el, { params: {}, items: many }, opts());
    const pages = paginate(f, { first: { x: el.x, y: el.y, w: el.w, h: el.h }, next: { x: el.x, y: el.y, w: el.w, h: 267 }, repeatHeader: true, clip: false });
    for (const p of pages) for (const pl of p.placements) pl.block.paint({ x: 0, y: pl.y }, { ...pctx, pageRows: p.pageRows });
    expect(performance.now() - t0).toBeLessThan(process.env.CI ? 3000 : 1000);
  });
});
