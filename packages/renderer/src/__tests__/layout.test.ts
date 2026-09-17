import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { flatten } from "../layout/flatten";

const page = { width: 100, height: 50, margin: [5, 5, 5, 5] as [number, number, number, number] };
const ctx = { params: {}, order: { NAME: "ACME", HIDE: false } };
const hideCtx = { params: {}, order: { NAME: "ACME", HIDE: true } };

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
  it("keeps barcode/ref as placeholders and draws a table as a flowBox", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
      { id: "c", type: "ref", x: 0, y: 0, w: 10, h: 5, ref: "hdr" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items.map((i) => i.kind)).toEqual(["placeholder", "rect", "placeholder"]);
    expect(items[1]).toMatchObject({ role: "flowBox", elementId: "t" });
  });
});

describe("flatten nested groups", () => {
  it("accumulates coordinates including line x2/y2", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "g1", type: "group", x: 10, y: 10, w: 50, h: 20, children: [
        { id: "g2", type: "group", x: 5, y: 5, w: 20, h: 10, children: [
          { id: "l", type: "line", x: 1, y: 1, w: 5, h: 0, x2: 6, y2: 1 },
        ]},
      ]},
    ]});
    expect(flatten(r.elements)[0]).toMatchObject({ id: "l", x: 16, y: 16, x2: 21, y2: 16 });
  });
});

describe("layout visible", () => {
  const ids = (r: ReturnType<typeof parseReport>, c: Record<string, unknown>) =>
    layout(r, c)[0].items.map((i) => i.elementId);

  it("hides every child of a hidden group", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "g", type: "group", x: 0, y: 0, w: 10, h: 10, visible: "{{ !order.HIDE }}", children: [
        { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 },
        { id: "b", type: "rect", x: 1, y: 1, w: 1, h: 1 },
      ]},
      { id: "c", type: "rect", x: 0, y: 0, w: 1, h: 1 },
    ]});
    expect(ids(r, hideCtx)).toEqual(["c"]);
    expect(ids(r, ctx)).toEqual(["a", "b", "c"]);
  });
  it("combines nested group visibility with AND", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "outer", type: "group", x: 0, y: 0, w: 50, h: 20, visible: "true", children: [
        { id: "shown", type: "rect", x: 0, y: 0, w: 1, h: 1 },
        { id: "inner", type: "group", x: 0, y: 0, w: 10, h: 10, visible: "false", children: [
          { id: "hidden", type: "rect", x: 0, y: 0, w: 1, h: 1 },
        ]},
      ]},
    ]});
    expect(ids(r, ctx)).toEqual(["shown"]);
  });
  it("evaluates visible without {{ }} as a bare expression", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "lit", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "false" },
      { id: "expr", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "!order.HIDE" },
      { id: "empty", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "" },
    ]});
    expect(ids(r, hideCtx)).toEqual(["empty"]);
    expect(ids(r, ctx)).toEqual(["expr", "empty"]);
  });
  it("isolates a group visible error to its descendants as #ERR (blank mode)", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "g", type: "group", x: 10, y: 10, w: 20, h: 20, visible: "{{ order. }}", children: [
        { id: "a", type: "text", x: 1, y: 1, w: 5, h: 5, value: "x" },
        { id: "b", type: "rect", x: 2, y: 2, w: 5, h: 5 },
      ]},
      { id: "ok", type: "text", x: 0, y: 0, w: 10, h: 5, value: "fine" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items.map((i) => i.elementId)).toEqual(["a", "b", "ok"]);
    expect(items[0]).toMatchObject({ kind: "text", x: 11, y: 11, lines: ["#ERR"], error: expect.stringContaining("Expression") });
    expect(items[1]).toMatchObject({ kind: "text", x: 12, y: 12, lines: ["#ERR"], error: expect.stringContaining("Expression") });
    expect(items[2].error).toBeUndefined();
  });
  it("throws on a group visible error in fail mode", () => {
    const r = parseReport({ id: "r", version: 1, page, onExpressionError: "fail", elements: [
      { id: "g", type: "group", x: 0, y: 0, w: 20, h: 20, visible: "{{ order. }}", children: [
        { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      ]},
    ]});
    expect(() => layout(r, ctx)).toThrow();
  });
});
