import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { flatten } from "../layout/flatten";
import { placeStatic, errorItem, isVisible } from "../layout/place";

const page = { width: 100, height: 50 };
const flat = (els: unknown[]) => flatten(parseReport({ id: "r", version: 1, page, elements: els as never }).elements);
const ctx = { params: {}, order: { NAME: "ACME", HIDE: true } };

describe("placeStatic", () => {
  it("places text, pageNumber, image, line, rect and barcode like layout did, with an instance", () => {
    const els = flat([
      { id: "t", type: "text", x: 1, y: 2, w: 40, h: 8, value: "{{ order.NAME }}" },
      { id: "p", type: "pageNumber", x: 0, y: 0, w: 10, h: 5 },
      { id: "i", type: "image", x: 0, y: 0, w: 10, h: 5, src: "asset://{{ order.NAME }}" },
      { id: "l", type: "line", x: 0, y: 0, w: 5, h: 0, x2: 5, y2: 0 },
      { id: "r", type: "rect", x: 0, y: 0, w: 5, h: 5 },
      { id: "b", type: "barcode", x: 0, y: 0, w: 5, h: 5, format: "qr", value: "x" },
    ]);
    const items = els.flatMap((el) => placeStatic(el, { ...ctx, page: 2, total: 3 }, { onExpressionError: "blank", instance: "cards#1" }));
    expect(items.map((i) => i.kind)).toEqual(["text", "text", "image", "line", "rect", "svg"]);
    expect(items[0]).toMatchObject({ lines: ["ACME"], instance: "cards#1", x: 1, y: 2 });
    expect(items[1]).toMatchObject({ lines: ["2 / 3"] });
    expect(items[2]).toMatchObject({ src: "asset://ACME" });
    expect((items[5] as { svg: string }).svg).toContain("<svg");
  });
  it("returns [] for hidden elements and #ERR for expression errors in blank mode, throws in fail mode", () => {
    const [hidden, bad] = flat([
      { id: "h", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "{{ !order.HIDE }}" },
      { id: "bad", type: "text", x: 3, y: 4, w: 10, h: 5, value: "{{ order. }}" },
    ]);
    expect(placeStatic(hidden, ctx, { onExpressionError: "blank" })).toEqual([]);
    expect(placeStatic(bad, ctx, { onExpressionError: "blank" })[0]).toMatchObject({ kind: "text", lines: ["#ERR"], x: 3, y: 4, error: expect.stringContaining("Expression") });
    expect(() => placeStatic(bad, ctx, { onExpressionError: "fail" })).toThrow();
  });
  it("throws for flow elements", () => {
    const [t] = flat([{ id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] }]);
    expect(() => placeStatic(t, ctx, { onExpressionError: "blank" })).toThrow(/flow element/);
  });
  it("errorItem and isVisible behave like phase 1", () => {
    expect(errorItem({ id: "x", x: 1, y: 1, w: 5, h: 5, style: flat([{ id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 }])[0].style }, "boom", "i#0")).toMatchObject({ lines: ["#ERR"], error: "boom", instance: "i#0" });
    expect(isVisible(undefined, ctx)).toBe(true);
    expect(isVisible("", ctx)).toBe(true);
    expect(isVisible("!order.HIDE", ctx)).toBe(false);
    expect(isVisible("{{ order.HIDE }}", ctx)).toBe(true);
  });
});
