import { describe, it, expect } from "vitest";
import { paginate } from "../flow/paginate";
import type { Block, BlockKind } from "../flow/types";

const blk = (kind: BlockKind, height: number, extra: Partial<Block> = {}): Block =>
  ({ kind, height, keepWithNext: false, rows: kind === "row" ? [{ h: height }] : [], paint: () => [], ...extra });
const rows = (...hs: number[]) => hs.map((h) => blk("row", h));
const first = { x: 0, y: 50, w: 100, h: 40 }, next = { x: 0, y: 50, w: 100, h: 60 };
const kinds = (p: { placements: { block: Block }[] }) => p.placements.map((x) => x.block.kind);

describe("paginate", () => {
  it("stacks rows and moves to the next region when the remaining height is short", () => {
    const pages = paginate({ body: rows(10, 10, 10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: false });
    expect(pages).toHaveLength(2);
    expect(pages[0].placements.map((p) => p.y)).toEqual([0, 10, 20, 30]);
    expect(pages[1].placements.map((p) => p.y)).toEqual([0, 10]);
    expect(pages[0].pageRows).toEqual([{ h: 10 }, { h: 10 }, { h: 10 }, { h: 10 }]);
  });
  it("puts the header first on page 1 and, with repeatHeader, on every page", () => {
    const header = blk("header", 7);
    const pages = paginate({ header, body: rows(10, 10, 10, 10, 10) }, { first, next, repeatHeader: true, clip: false });
    expect(pages.map(kinds)).toEqual([["header", "row", "row", "row"], ["header", "row", "row"]]);
    const once = paginate({ header, body: rows(10, 10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: false });
    expect(kinds(once[1])[0]).toBe("row");
  });
  it("reserves the page footer at the bottom of each page and paints it with that page's rows", () => {
    const pageFooter = blk("pageFooter", 8);
    const pages = paginate({ pageFooter, body: rows(10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: false });
    expect(pages).toHaveLength(2);                                   // 40 - 8 = 32 → 3행
    expect(pages[0].placements.at(-1)).toMatchObject({ block: pageFooter, y: 32 });
    expect(pages[0].pageRows).toHaveLength(3);
    expect(pages[1].placements.at(-1)).toMatchObject({ block: pageFooter, y: 52 });
  });
  it("keeps a keepWithNext block with the following block, moving both to the next page", () => {
    const gh = blk("groupHeader", 8, { keepWithNext: true });
    const pages = paginate({ body: [...rows(10, 10, 10), gh, ...rows(10)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["row", "row", "row"], ["groupHeader", "row"]]);
  });
  it("keeps a chain of nested group headers together", () => {
    const outer = blk("groupHeader", 8, { keepWithNext: true }), inner = blk("groupHeader", 8, { keepWithNext: true });
    const pages = paginate({ body: [...rows(10, 10), outer, inner, ...rows(10)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["row", "row"], ["groupHeader", "groupHeader", "row"]]);
  });
  it("unbundles a chain that cannot fit even an empty page", () => {
    const gh = blk("groupHeader", 30, { keepWithNext: true });
    const pages = paginate({ body: [gh, blk("row", 40)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["groupHeader"], ["row"]]);
    expect(pages[0].placements[0].overflow).toBe(false);
  });
  it("places a block taller than an empty page alone and marks overflow", () => {
    const pages = paginate({ body: [...rows(10), blk("row", 100), ...rows(10)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["row"], ["row"], ["row"]]);
    expect(pages[1].placements[0].overflow).toBe(true);
    expect(pages[1].overflow).toBe(true);
    expect(pages[0].overflow).toBe(false);
  });
  it("puts the footer after the last row, on a new page when there is no room", () => {
    const footer = blk("footer", 10);
    const fits = paginate({ body: rows(10, 10), footer }, { first, next, repeatHeader: false, clip: false });
    expect(fits.map(kinds)).toEqual([["row", "row", "footer"]]);
    const spills = paginate({ body: rows(10, 10, 10, 10), footer }, { first, next, repeatHeader: false, clip: false });
    expect(spills.map(kinds)).toEqual([["row", "row", "row", "row"], ["footer"]]);
  });
  it("clip keeps only the first region's blocks and marks truncated", () => {
    const pages = paginate({ body: rows(10, 10, 10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: true });
    expect(pages).toHaveLength(1);
    expect(pages[0].placements).toHaveLength(4);
    expect(pages[0].truncated).toBe(true);
    expect(paginate({ body: rows(10) }, { first, next, repeatHeader: false, clip: true })[0].truncated).toBe(false);
  });
  it("produces one page for an empty body (header and page footer only)", () => {
    const pages = paginate({ header: blk("header", 7), pageFooter: blk("pageFooter", 5), body: [] }, { first, next, repeatHeader: true, clip: false });
    expect(pages).toHaveLength(1);
    expect(kinds(pages[0])).toEqual(["header", "pageFooter"]);
    expect(paginate({ body: [] }, { first, next, repeatHeader: false, clip: false })).toHaveLength(1);
  });
});
