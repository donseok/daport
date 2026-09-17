import { describe, it, expect } from "vitest";
import { parseReport, type ComponentBody } from "@daport/core";
import { flatten } from "../layout/flatten";
import { layout } from "../layout/layout";
import { resolveRefProps, withProps } from "../layout/props";

const page = { width: 100, height: 100, margin: [5, 5, 5, 5] as [number, number, number, number] };
const hdr: ComponentBody = { name: "헤더", w: 60, h: 20, props: [
  { name: "title", type: "string", default: "기본 제목" },
  { name: "show", type: "boolean", default: true },
], elements: [
  { id: "box", type: "group", x: 2, y: 3, w: 50, h: 15, visible: "{{ props.show }}", children: [
    { id: "logo", type: "text", x: 1, y: 1, w: 40, h: 6, value: "{{ props.title }}", flow: "every" },
  ] },
  { id: "rule", type: "line", x: 0, y: 19, w: 60, h: 0, x2: 60, y2: 19 },
] as unknown as ComponentBody["elements"] };
const std: ComponentBody = { name: "표", w: 80, h: 30, props: [{ name: "label", type: "string", default: "" }], elements: [
  { id: "cap", type: "text", x: 0, y: 0, w: 80, h: 6, value: "{{ props.label }}" },
  { id: "t", type: "table", x: 0, y: 6, w: 80, h: 24, source: "items", columns: [{ header: "N", value: "{{ props.label }}{{ row.N }}", w: 40 }] },
] as unknown as ComponentBody["elements"] };
const components = { "hdr@1": hdr, "std@2": std };
const ref = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "ref", ref: "hdr", version: 1, x: 10, y: 20, w: 60, h: 20, ...extra });
const mk = (elements: unknown[], extra: Record<string, unknown> = {}) => parseReport({ id: "r", version: 1, page, components, elements, ...extra });
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const lines = (item: unknown) => (item as { lines: string[] }).lines.join("");

describe("flatten: ref", () => {
  it("expands a ref like a group: offsets (line x2/y2 too), owner with path, refFlow, visible chain", () => {
    const r = mk([ref("h1", { visible: "{{ params.on }}", flow: "every", props: { title: "A", extra: 1 } })]);
    const flat = flatten(r.elements, 0, 0, [], { components: r.components });
    expect(flat.map((e) => e.id)).toEqual(["logo", "rule"]);
    expect(flat[0]).toMatchObject({ x: 13, y: 24, refFlow: "every", ancestorsVisible: ["{{ params.on }}", "{{ props.show }}"] });
    expect(flat[1]).toMatchObject({ x: 10, y: 39, x2: 70, y2: 39, refFlow: "every", ancestorsVisible: ["{{ params.on }}"] });
    expect(flat[0].owner).toEqual({ refId: "h1", path: "box/logo", box: { x: 10, y: 20, w: 60, h: 20 }, decls: hdr.props, values: { title: "A", extra: 1 } });
    expect(flat[1].owner?.path).toBe("rule");
  });
  it("keeps the ref (missing: true) when the component is not in the map", () => {
    const r = mk([ref("h1")]);
    const flat = flatten(r.elements, 5, 5, [], { components: {} });
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ id: "h1", type: "ref", missing: true, x: 15, y: 25 });
  });
  it("expands a ref inside a group with the group offset and visible", () => {
    const r = mk([{ id: "g", type: "group", x: 1, y: 2, w: 90, h: 50, visible: "{{ params.g }}", children: [ref("h1", { x: 0, y: 0 })] }]);
    const flat = flatten(r.elements, 0, 0, [], { components: r.components });
    expect(flat[0]).toMatchObject({ id: "logo", x: 4, y: 6, ancestorsVisible: ["{{ params.g }}", "{{ props.show }}"] });
    expect(flat[0].owner?.refId).toBe("h1");
  });
});

describe("props context", () => {
  const owner = { refId: "h1", path: "box/logo", box: { x: 0, y: 0, w: 60, h: 20 }, decls: hdr.props, values: { title: "{{ record.T }} {{ page }}", show: "{{ params.on }}", nope: "x" } as Record<string, string | number | boolean> };
  it("resolveRefProps: defaults + evaluated values keeping whole-template types, undeclared names dropped", () => {
    expect(resolveRefProps(owner, { params: { on: false }, record: { T: "보증서" }, page: 2 })).toEqual({ title: "보증서 2", show: false });
    expect(resolveRefProps({ ...owner, values: {} }, { params: {} })).toEqual({ title: "기본 제목", show: true });
    expect(resolveRefProps({ ...owner, values: { title: 7 } }, { params: {} })).toEqual({ title: 7, show: true });
  });
  it("resolveRefProps throws ExpressionError for a bad template", () => {
    expect(() => resolveRefProps({ ...owner, values: { title: "{{ record. }}" } }, { params: {} })).toThrow(/Expression error/);
  });
  it("withProps: returns ctx without owner, caches per refId|page|copy", () => {
    const ctx = { params: { on: true }, record: { T: "A" }, page: 1, copy: 1 };
    expect(withProps(ctx, undefined, new Map())).toBe(ctx);
    const cache = new Map<string, Record<string, unknown>>();
    const a = withProps(ctx, owner, cache);
    expect(a.props).toEqual({ title: "A 1", show: true });
    expect(a.params).toBe(ctx.params);
    expect(withProps({ ...ctx, record: { T: "B" } }, owner, cache).props).toBe(a.props);   // 같은 페이지·부: 캐시
    expect(withProps({ ...ctx, page: 2 }, owner, cache).props).toEqual({ title: "A 2", show: true });
    expect([...cache.keys()]).toEqual(["h1|1|1", "h1|2|1"]);
  });
});

describe("layout: component instances", () => {
  const t = { id: "t", type: "table", x: 5, y: 80, w: 60, h: 15, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] };
  const noCells = <T extends { role?: string }>(items: T[]) => items.filter((i) => i.role !== "cell" && i.role !== "border" && i.role !== "flowBox");
  it("elementId = ref id, instance = refId/path, refBox first, ref.flow decides pages (inner flow ignored), props per instance", () => {
    const r = mk([ref("h1", { props: { title: "첫째" } }), ref("h2", { y: 50, flow: "every", props: { title: "{{ params.name }}-{{ page }}" } }), t]);
    const pages = layout(r, { params: { name: "N" }, items: rows(2) });
    expect(pages).toHaveLength(2);
    expect(noCells(pages[0].items).map((i) => [i.kind, i.role, i.elementId, i.instance])).toEqual([
      ["rect", "refBox", "h1", undefined], ["text", undefined, "h1", "h1/box/logo"], ["line", undefined, "h1", "h1/rule"],
      ["rect", "refBox", "h2", undefined], ["text", undefined, "h2", "h2/box/logo"], ["line", undefined, "h2", "h2/rule"],
    ]);
    expect(pages[0].items[0]).toMatchObject({ x: 10, y: 20, w: 60, h: 20 });
    expect(pages[0].items[1]).toMatchObject({ x: 13, y: 24, lines: ["첫째"] });
    expect(lines(pages[0].items[4])).toBe("N-1");
    expect(noCells(pages[1].items).map((i) => [i.elementId, i.instance])).toEqual([["h2", undefined], ["h2", "h2/box/logo"], ["h2", "h2/rule"]]);
    expect(lines(pages[1].items[1])).toBe("N-2");
    for (const p of pages) {
      const keys = p.items.filter((i) => i.role === undefined || i.role === "refBox").map((i) => `${i.elementId}|${i.instance}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it("uses defaults, ignores undeclared values and applies props-based visibility", () => {
    const r = mk([ref("h1", { props: { show: false, nope: "x" } }), ref("h2", { y: 50 })]);
    const items = layout(r, { params: {} })[0].items;
    expect(items.map((i) => i.instance)).toEqual([undefined, "h1/rule", undefined, "h2/box/logo", "h2/rule"]);
    expect(lines(items[3])).toBe("기본 제목");
  });
  it("ref.visible hides the whole instance's children", () => {
    const r = mk([ref("h1", { visible: "{{ params.on }}" })]);
    expect(layout(r, { params: { on: false } })[0].items.map((i) => i.role)).toEqual(["refBox"]);
    expect(layout(r, { params: { on: true } })[0].items).toHaveLength(3);
  });
  it("a missing component becomes one #ERR at the ref box", () => {
    const r = mk([ref("h1")]);
    const items = layout({ ...r, components: {} }, { params: {} })[0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "text", elementId: "h1", x: 10, y: 20, w: 60, h: 20, lines: ["#ERR"], error: "component hdr@1 not found" });
  });
  it("a props evaluation error draws no children and one #ERR at the ref box; fail mode throws", () => {
    const bad = mk([ref("h1", { props: { title: "{{ params. }}" } }), ref("h2", { y: 50 })]);
    const items = layout(bad, { params: {} })[0].items;
    expect(items.map((i) => [i.elementId, i.instance, i.role])).toEqual([["h1", undefined, undefined], ["h2", undefined, "refBox"], ["h2", "h2/box/logo", undefined], ["h2", "h2/rule", undefined]]);
    expect(items[0]).toMatchObject({ x: 10, y: 20, w: 60, h: 20, lines: ["#ERR"], error: expect.stringContaining("Expression error") });
    expect(() => layout(mk([ref("h1", { props: { title: "{{ params. }}" } })], { onExpressionError: "fail" }), { params: {} })).toThrow(/Expression error/);
  });
});

describe("layout: flow elements inside a component", () => {
  const sref = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "ref", ref: "std", version: 2, x: 10, y: 30, w: 80, h: 30, ...extra });
  it("a continue table in a component splits pages with the instance prefix, props in cells, flowBox owned by the ref", () => {
    const pages = layout(mk([sref("s1", { props: { label: "L" } })]), { params: {}, items: rows(10) });
    expect(pages).toHaveLength(2);                                            // 첫 영역 24mm: 머리 7 + 2행, 다음 영역 95-36=59mm: 머리 + 8행
    const cells = (i: number) => pages[i].items.filter((it) => it.role === "cell");
    expect(cells(0).map((c) => c.instance)).toEqual(["s1/t/t#h", "s1/t/t#0", "s1/t/t#1"]);
    expect(cells(1).map((c) => c.instance)).toEqual(["s1/t/t#h", ...Array.from({ length: 8 }, (_, k) => `s1/t/t#${k + 2}`)]);
    expect(pages.flatMap((p) => p.items).every((it) => it.elementId === "s1")).toBe(true);
    expect(lines(cells(0)[1])).toBe("L0");
    expect(pages[0].items.slice(0, 3).map((i) => [i.role, i.instance])).toEqual([["refBox", undefined], [undefined, "s1/cap"], ["flowBox", "s1/t"]]);
    expect(pages[0].items[2]).toMatchObject({ x: 10, y: 36, w: 80, h: 24 });
    expect(pages[1].items.slice(0, 2).map((i) => [i.role, i.instance])).toEqual([["refBox", undefined], ["flowBox", "s1/t"]]);   // cap은 ref.flow once
  });
  it("the same component twice keeps (elementId, instance) unique and props separate", () => {
    const pages = layout(mk([sref("s1", { props: { label: "A" } }), sref("s2", { x: 10, y: 62, h: 30, props: { label: "B" } })]), { params: {}, items: rows(1) });
    expect(pages).toHaveLength(1);
    const items = pages[0].items;
    const keys = items.filter((i) => i.role !== "border").map((i) => `${i.elementId}|${i.instance}|${i.role}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.filter((i) => i.role === "cell" && i.instance?.endsWith("t#0")).map((i) => [i.elementId, lines(i)])).toEqual([["s1", "A0"], ["s2", "B0"]]);
  });
  it("a props error on a component with a continue table gives one #ERR on the first page only", () => {
    const pages = layout(mk([sref("s1", { props: { label: "{{ params. }}" } })]), { params: {}, items: rows(10) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ elementId: "s1", x: 10, y: 30, w: 80, h: 30, lines: ["#ERR"] });
  });
});

describe("repeater templates and bands with refs", () => {
  it("expands refs in item templates with the instance after the item path and props from the item", () => {
    const r = mk([{ id: "cards", type: "repeater", x: 5, y: 5, w: 90, h: 90, source: "lots",
      item: { w: 90, h: 25, children: [ref("hd", { x: 0, y: 0, props: { title: "{{ item.NAME }}" } })] },
      groups: [{ by: "item.G", header: { h: 22, children: [ref("gh", { x: 0, y: 1, props: { title: "G{{ group.key }}" } })] } }] }]);
    const items = layout(r, { params: {}, lots: [{ NAME: "L1", G: 1 }, { NAME: "L2", G: 1 }] })[0].items;
    const own = items.filter((i) => i.elementId === "hd" || i.elementId === "gh");
    expect(own.map((i) => [i.elementId, i.role, i.instance])).toEqual([
      ["gh", "refBox", "cards#g0h0"], ["gh", undefined, "cards#g0h0/gh/box/logo"], ["gh", undefined, "cards#g0h0/gh/rule"],
      ["hd", "refBox", "cards#0"], ["hd", undefined, "cards#0/hd/box/logo"], ["hd", undefined, "cards#0/hd/rule"],
      ["hd", "refBox", "cards#1"], ["hd", undefined, "cards#1/hd/box/logo"], ["hd", undefined, "cards#1/hd/rule"],
    ]);
    expect(own.filter((i) => i.kind === "text").map(lines)).toEqual(["G1", "L1", "L2"]);
    expect(own.find((i) => i.instance === "cards#1")).toMatchObject({ x: 5, y: 52, w: 60, h: 20 });   // 5 + 머리 22 + 항목 25
  });
});
