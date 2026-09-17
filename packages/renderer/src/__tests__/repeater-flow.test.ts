import { describe, it, expect } from "vitest";
import { parseReport, type RepeaterElement } from "@daport/core";
import { repeaterFlow, itemsPerRow } from "../flow/repeater";
import { paintChildren } from "../flow/children";
import { paginate } from "../flow/paginate";
import { createMeasureCache } from "../text/cache";
import type { PageFlowContext } from "../flow/types";

const page = { width: 210, height: 297 };
const mk = (extra: Record<string, unknown> = {}): RepeaterElement => parseReport({ id: "r", version: 1, page, elements: [
  { id: "cards", type: "repeater", x: 10, y: 40, w: 190, h: 240, source: "lots",
    item: { w: 60, h: 35, children: [{ id: "nm", type: "text", x: 2, y: 2, w: 50, h: 6, value: "{{ item.NAME }} #{{ index }}" }] }, ...extra }] }).elements[0] as RepeaterElement;
const lots = [{ NAME: "L1", LINE: "A" }, { NAME: "L2", LINE: "A" }, { NAME: "L3", LINE: "B" }, { NAME: "L4", LINE: "B" }, { NAME: "L5", LINE: "B" }];
const opts = () => ({ measure: createMeasureCache(), onExpressionError: "blank" as const });
const pctx: PageFlowContext = { page: 1, total: 1, sheet: 1, sheets: 1, copy: 1, copies: 1, pageRows: [] };
const texts = (its: { kind: string; lines?: string[] }[]) => its.filter((i) => i.kind === "text").map((i) => (i as { lines: string[] }).lines.join(""));

describe("repeaterFlow", () => {
  it("list: one row block per item, item height + vertical gap, children at item origin with instances", () => {
    const f = repeaterFlow(mk({ gap: [0, 2] }), { params: {}, lots }, opts());
    expect(f.rows).toBe(lots);
    expect(f.body.map((b) => [b.kind, b.height, b.rows.length])).toEqual(Array(5).fill(["row", 37, 1]));
    const items = f.body[1].paint({ x: 10, y: 100 }, pctx);
    expect(items.map((i) => [i.kind, i.role])).toEqual([["text", undefined]]);
    expect(items[0]).toMatchObject({ elementId: "nm", instance: "cards#1", x: 12, y: 102, lines: ["L2 #1"] });
    const first = f.body[0].paint({ x: 10, y: 40 }, pctx);
    expect(first[0]).toMatchObject({ kind: "rect", role: "template", elementId: "cards", instance: "cards#0", x: 10, y: 40, w: 60, h: 35 });
    expect(first[1]).toMatchObject({ elementId: "nm", instance: "cards#0" });
  });
  it("grid: floor((w + gap) / (item.w + gap)) items per row block, left to right", () => {
    const el = mk({ layout: "grid", gap: [5, 5] });
    expect(itemsPerRow(el)).toBe(3);                                  // (190 + 5) / (60 + 5) = 3
    expect(itemsPerRow(mk({ layout: "grid", item: { w: 500, h: 10, children: [] } }))).toBe(1);
    const f = repeaterFlow(el, { params: {}, lots }, opts());
    expect(f.body.map((b) => b.rows.length)).toEqual([3, 2]);
    const xs = f.body[0].paint({ x: 10, y: 40 }, pctx).filter((i) => i.kind === "text").map((i) => i.x);
    expect(xs).toEqual([12, 77, 142]);
    expect(f.body[0].height).toBe(40);
  });
  it("groups: header/footer bands with group context, rows restart at group boundaries, header keepWithNext", () => {
    const f = repeaterFlow(mk({ layout: "grid", groups: [{ by: "item.LINE",
      header: { h: 8, children: [{ id: "gh", type: "text", x: 0, y: 0, w: 100, h: 6, value: "라인 {{ group.key }} ({{ count(group.rows) }})" }] },
      footer: { h: 6, children: [{ id: "gf", type: "text", x: 0, y: 0, w: 100, h: 6, value: "끝 {{ group.index }}" }] } }] }), { params: {}, lots }, opts());
    expect(f.body.map((b) => [b.kind, b.rows.length])).toEqual([["groupHeader", 0], ["row", 2], ["groupFooter", 0], ["groupHeader", 0], ["row", 3], ["groupFooter", 0]]);
    expect(f.body[0].keepWithNext).toBe(true);
    expect(f.body[0].height).toBe(8);
    expect(texts(f.body[0].paint({ x: 0, y: 0 }, pctx))).toEqual(["라인 A (2)"]);
    expect(f.body[0].paint({ x: 0, y: 0 }, pctx)[0]).toMatchObject({ elementId: "gh", instance: "cards#g0h0" });
    expect(texts(f.body[5].paint({ x: 0, y: 0 }, pctx))).toEqual(["끝 1"]);
  });
  it("isolates an item expression error to that child and throws for a non-array source", () => {
    const f = repeaterFlow(mk({ item: { w: 60, h: 20, children: [
      { id: "bad", type: "text", x: 0, y: 0, w: 10, h: 5, value: "{{ item. }}" }, { id: "ok", type: "text", x: 0, y: 5, w: 10, h: 5, value: "{{ item.NAME }}" }] } }), { params: {}, lots }, opts());
    const [, bad, ok] = f.body[0].paint({ x: 0, y: 0 }, pctx);
    expect(bad).toMatchObject({ elementId: "bad", lines: ["#ERR"] });
    expect(ok).toMatchObject({ elementId: "ok", lines: ["L1"] });
    expect(() => repeaterFlow(mk({ source: "lots[0]" }), { params: {}, lots }, opts())).toThrow(/source is not an array/);
  });
  it("paints a clip table inside an item with a nested instance prefix and a flowBox", () => {
    const f = repeaterFlow(mk({ item: { w: 100, h: 30, children: [
      { id: "t2", type: "table", x: 0, y: 0, w: 80, h: 20, source: "item.lines", overflow: "clip", columns: [{ header: "N", value: "{{ row.n }}", w: 40 }] }] } }),
      { params: {}, lots: [{ lines: [{ n: 1 }, { n: 2 }] }] }, opts());
    const items = f.body[0].paint({ x: 10, y: 40 }, pctx);
    expect(items[1]).toMatchObject({ kind: "rect", role: "flowBox", elementId: "t2", instance: "cards#0", x: 10, y: 40, w: 80, h: 20 });
    expect(items.filter((i) => i.role === "cell").map((i) => i.instance)).toEqual(["cards#0/t2#h", "cards#0/t2#0", "cards#0/t2#1"]);
  });
  it("works with paginate over several pages", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ NAME: `L${i}`, LINE: "A" }));
    const el = mk({ layout: "grid" });
    const pages = paginate(repeaterFlow(el, { params: {}, lots: many }, opts()), { first: { x: el.x, y: el.y, w: el.w, h: el.h }, next: { x: el.x, y: el.y, w: el.w, h: 247 }, repeatHeader: false, clip: false });
    expect(pages.length).toBe(3);                                       // 14 줄 × 35mm: 6 + 7 + 1
    expect(pages.flatMap((p) => p.pageRows)).toEqual(many);
  });
});

describe("paintChildren", () => {
  it("merges page context into the child context and offsets groups", () => {
    const el = mk({ item: { w: 60, h: 20, children: [{ id: "g", type: "group", x: 5, y: 5, w: 20, h: 10, children: [{ id: "pn", type: "pageNumber", x: 1, y: 1, w: 10, h: 5 }] }] } });
    const items = paintChildren(el.item.children, { x: 100, y: 200 }, { params: {} }, { ...opts(), instance: "cards#0", pageCtx: { ...pctx, page: 3, total: 9 } });
    expect(items[0]).toMatchObject({ elementId: "pn", instance: "cards#0", x: 106, y: 206, lines: ["3 / 9"] });
  });
});
