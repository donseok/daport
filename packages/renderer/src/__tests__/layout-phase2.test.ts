import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { LayoutLimitError } from "../layout/errors";

const page = { width: 100, height: 100, margin: [5, 5, 5, 5] as [number, number, number, number] };
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const table = (extra: Record<string, unknown> = {}) => ({ id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }], ...extra });
const mk = (elements: unknown[], extra: Record<string, unknown> = {}) => parseReport({ id: "r", version: 1, page, elements, ...extra });
const ids = (items: { elementId: string }[]) => items.map((i) => i.elementId);
const cells = (items: { role?: string; instance?: string }[]) => items.filter((i) => i.role === "cell").map((i) => i.instance);
const textOf = (items: { kind: string; elementId: string; lines?: string[] }[], id: string) => (items.find((i) => i.elementId === id && i.kind === "text") as { lines: string[] }).lines.join("");

describe("layout (phase 2)", () => {
  it("splits a long table across pages: 3 rows in the first region, then page.height - margin.bottom - y", () => {
    const pages = layout(mk([table()]), { params: {}, items: rows(20) });
    expect(pages.map((p) => [p.index, p.copyIndex, p.pageInCopy])).toEqual([[0, 0, 0], [1, 0, 1], [2, 0, 2]]);
    expect(cells(pages[0].items)).toEqual(["t#h", "t#0", "t#1", "t#2"]);
    expect(cells(pages[1].items).length).toBe(12);                       // 머리 + 11행
    expect(cells(pages[2].items)).toEqual(["t#h", "t#14", "t#15", "t#16", "t#17", "t#18", "t#19"]);
    expect(pages[0].items[0]).toMatchObject({ kind: "rect", role: "flowBox", elementId: "t", x: 5, y: 20, w: 60, h: 30 });
    expect(pages[0].items.find((i) => i.instance === "t#0")).toMatchObject({ y: 27 });   // 20 + 머리 7
  });
  it("places fixed elements by flow: once on the first page, every on all, last on the last, with page/total", () => {
    const pages = layout(mk([table(),
      { id: "once", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "every", type: "pageNumber", x: 0, y: 90, w: 30, h: 5, flow: "every" },
      { id: "last", type: "text", x: 0, y: 0, w: 10, h: 5, value: "끝", flow: "last" },
    ]), { params: {}, items: rows(20) });
    expect(ids(pages[0].items).filter((i) => i !== "t")).toEqual(["once", "every"]);
    expect(ids(pages[1].items).filter((i) => i !== "t")).toEqual(["every"]);
    expect(ids(pages[2].items).filter((i) => i !== "t")).toEqual(["every", "last"]);
    expect(textOf(pages[1].items, "every")).toBe("2 / 3");
  });
  it("ignores the flow value of a continue table and omits it on pages beyond its own", () => {
    const pages = layout(mk([table({ flow: "last" }), { id: "cards", type: "repeater", x: 5, y: 60, w: 60, h: 30, source: "lots", layout: "list",
      item: { w: 60, h: 25, children: [{ id: "nm", type: "text", x: 0, y: 0, w: 20, h: 5, value: "{{ item.N }}" }] } }]), { params: {}, items: rows(20), lots: rows(2) });
    expect(pages).toHaveLength(3);
    expect(ids(pages[0].items)).toContain("cards");
    expect(pages[0].items.filter((i) => i.elementId === "nm").map((i) => i.instance)).toEqual(["cards#0"]);   // 30mm 영역에 25mm 항목 하나
    expect(pages[1].items.filter((i) => i.elementId === "nm").map((i) => i.instance)).toEqual(["cards#1"]);
    expect(ids(pages[2].items)).not.toContain("cards");
    expect(ids(pages[2].items)).toContain("t");
  });
  it("repeat: one copy per record with page/total per copy and sheet/sheets/copy/copies overall", () => {
    const r = mk([table({ source: "record.items" }), { id: "pn", type: "pageNumber", x: 0, y: 90, w: 60, h: 5, flow: "every", format: "{{ page }}/{{ total }} {{ sheet }}/{{ sheets }} {{ copy }}/{{ copies }} {{ record.NO }}" }],
      { repeat: { source: "ships" } });
    const pages = layout(r, { params: {}, ships: [{ NO: "A", items: rows(5) }, { NO: "B", items: rows(1) }] });
    expect(pages.map((p) => [p.index, p.copyIndex, p.pageInCopy])).toEqual([[0, 0, 0], [1, 0, 1], [2, 1, 0]]);
    expect(pages.map((p) => textOf(p.items, "pn"))).toEqual(["1/2 1/3 1/2 A", "2/2 2/3 1/2 A", "1/1 3/3 2/2 B"]);
    expect(cells(pages[2].items)).toEqual(["t#h", "t#0"]);
  });
  it("repeat with zero records: one page with #NODATA at the margin corner and record undefined", () => {
    const pages = layout(mk([{ id: "v", type: "text", x: 0, y: 0, w: 10, h: 5, value: "[{{ record.NO }}]" }], { repeat: { source: "ships" } }), { params: {}, ships: [] });
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ kind: "text", elementId: "__nodata", x: 5, y: 5, lines: ["#NODATA"] });
    expect(textOf(pages[0].items, "v")).toBe("[]");
  });
  it("repeat source error: #ERR item in blank mode, throws in fail mode", () => {
    const bad = mk([], { repeat: { source: "ships." } });
    expect(layout(bad, { params: {} })[0].items[0]).toMatchObject({ elementId: "__repeat", lines: ["#ERR"], error: expect.stringContaining("Expression") });
    expect(() => layout({ ...bad, onExpressionError: "fail" }, { params: {} })).toThrow();
  });
  it("source error or non-array on a flow element becomes one #ERR item in its place (blank) or throws (fail)", () => {
    const pages = layout(mk([table({ source: "items[0]" }), { id: "ok", type: "rect", x: 0, y: 0, w: 1, h: 1 }]), { params: {}, items: rows(2) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ elementId: "t", lines: ["#ERR"], x: 5, y: 20, error: expect.stringContaining("not an array") });
    expect(ids(pages[0].items)).toEqual(["t", "ok"]);
    expect(() => layout(mk([table({ source: "items[0]" })], { onExpressionError: "fail" }), { params: {}, items: rows(2) })).toThrow();
  });
  it("skips a hidden flow element and one whose ancestor group is hidden", () => {
    const pages = layout(mk([table({ visible: "false" }), { id: "g", type: "group", x: 0, y: 0, w: 100, h: 100, visible: "{{ 1 == 2 }}", children: [table({ id: "t2" })] }]), { params: {}, items: rows(20) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toEqual([]);
  });
  it("clip table: fixed element following flow rules, first region only, flowBox clipped", () => {
    const pages = layout(mk([table({ overflow: "clip", flow: "every" }), table({ id: "t2", overflow: "clip", source: "items[.N < 2]" })]), { params: {}, items: rows(20) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ role: "flowBox", elementId: "t", clipped: true });
    expect(cells(pages[0].items).filter((i) => i!.startsWith("t#"))).toEqual(["t#h", "t#0", "t#1", "t#2"]);
    expect(pages[0].items.find((i) => i.elementId === "t2" && i.role === "flowBox")?.clipped).toBeUndefined();
  });
  it("marks overflow on the flowBox when one block is taller than an empty page and the rest fit", () => {
    const pages = layout(mk([table()]), { params: {}, items: [{ N: "가".repeat(400) }, { N: 1 }] });
    expect(pages).toHaveLength(2);
    expect(pages[0].items[0]).toMatchObject({ role: "flowBox", overflow: true });
    expect(pages[1].items[0]).toMatchObject({ role: "flowBox" });
    expect(pages[1].items[0].overflow).toBeFalsy();
  });
  it("renders #ERR instead of one cut page per row when no remaining block fits a continuation page", () => {
    const pages = layout(mk([table({ rowHeight: 200 })]), { params: {}, items: rows(2) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items.find((i) => i.elementId === "t" && i.error)).toMatchObject({ lines: ["#ERR"] });
  });
  it("throws LayoutLimitError above maxPages (default 2000) before painting", () => {
    expect(() => layout(mk([table()], {}), { params: {}, items: rows(100) }, { maxPages: 2 })).toThrow(LayoutLimitError);
    const many = mk([], { repeat: { source: "ships" } });
    expect(() => layout(many, { params: {}, ships: Array.from({ length: 2001 }, () => ({})) })).toThrow(LayoutLimitError);
    expect(layout(many, { params: {}, ships: Array.from({ length: 2000 }, () => ({})) })).toHaveLength(2000);
  });
  it("keeps a report without flow elements identical to phase 1 except copyIndex/pageInCopy", () => {
    const pages = layout(mk([{ id: "t", type: "text", x: 5, y: 5, w: 40, h: 10, value: "고객: {{ order.NAME }}" }]), { params: {}, order: { NAME: "ACME" } });
    expect(pages).toEqual([{ index: 0, width: 100, height: 100, copyIndex: 0, pageInCopy: 0, items: [expect.objectContaining({ kind: "text", lines: ["고객: ACME"] })] }]);
  });
});
