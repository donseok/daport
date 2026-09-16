import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { flatten } from "../layout/flatten";

const page = { width: 100, height: 50, margin: [5, 5, 5, 5] as [number, number, number, number] };
const ctx = { params: {}, order: { NAME: "ACME", HIDE: false } };

describe("flatten", () => {
  it("offsets group children to absolute coordinates", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "g", type: "group", x: 10, y: 20, w: 50, h: 20, children: [
        { id: "t", type: "text", x: 1, y: 2, w: 10, h: 5, value: "a" },
        { id: "l", type: "line", x: 0, y: 0, w: 50, h: 0, x2: 50, y2: 0 },
      ]},
    ]});
    const flat = flatten(r.elements);
    expect(flat.map((e) => e.id)).toEqual(["t", "l"]);
    expect(flat[0]).toMatchObject({ x: 11, y: 22 });
    expect(flat[1]).toMatchObject({ x: 10, y: 20, x2: 60, y2: 20 });
  });
});

describe("layout", () => {
  it("produces one page with page size and evaluated text", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "t", type: "text", x: 5, y: 5, w: 40, h: 10, value: "고객: {{ order.NAME }}" },
    ]});
    const pages = layout(r, ctx);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ index: 0, width: 100, height: 50 });
    const t = pages[0].items[0];
    expect(t.kind).toBe("text");
    if (t.kind === "text") expect(t.lines).toEqual(["고객: ACME"]);
  });
  it("wraps long text into multiple lines and reports overflow", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "t", type: "text", x: 5, y: 5, w: 15, h: 4, value: "가나다라마바사아자차", style: { fontSize: 10 } },
    ]});
    const t = layout(r, ctx)[0].items[0];
    if (t.kind === "text") { expect(t.lines.length).toBeGreaterThan(1); expect(t.overflow).toBe(true); }
  });
  it("omits element whose visible expression is false", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "{{ order.HIDE }}" },
      { id: "b", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "{{ !order.HIDE }}" },
    ]});
    expect(layout(r, ctx)[0].items.map((i) => i.elementId)).toEqual(["b"]);
  });
  it("marks expression error on the element only (blank mode)", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "bad", type: "text", x: 0, y: 0, w: 10, h: 5, value: "{{ order. }}" },
      { id: "ok", type: "text", x: 0, y: 0, w: 10, h: 5, value: "fine" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items[0]).toMatchObject({ elementId: "bad", error: expect.stringContaining("Expression") });
    // toMatchObject는 키 존재를 요구하므로 error 부재는 직접 확인한다
    expect(items[1]).toMatchObject({ elementId: "ok" });
    expect(items[1].error).toBeUndefined();
  });
  it("throws in fail mode", () => {
    const r = parseReport({ id: "r", version: 1, page, onExpressionError: "fail", elements: [
      { id: "bad", type: "text", x: 0, y: 0, w: 10, h: 5, value: "{{ order. }}" },
    ]});
    expect(() => layout(r, ctx)).toThrow();
  });
  it("renders pageNumber with page/total and image src interpolation", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "p", type: "pageNumber", x: 0, y: 0, w: 10, h: 5 },
      { id: "i", type: "image", x: 0, y: 0, w: 10, h: 5, src: "asset://{{ order.NAME }}" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items[0]).toMatchObject({ kind: "text", lines: ["1 / 1"] });
    expect(items[1]).toMatchObject({ kind: "image", src: "asset://ACME" });
  });
  it("keeps declared-only types as placeholders", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
      { id: "c", type: "ref", x: 0, y: 0, w: 10, h: 5, ref: "hdr" },
    ]});
    const kinds = layout(r, ctx)[0].items.map((i) => i.kind);
    expect(kinds).toEqual(["placeholder", "placeholder", "placeholder"]);
  });
});
