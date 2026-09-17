import { describe, it, expect } from "vitest";
import { parseReport } from "../schema/report";
import { StyleSchema, StyleOverrideSchema, mergeStyle } from "../schema/style";
import { TableElementSchema } from "../schema/elements";

const base = { id: "r", version: 1, page: { width: 210, height: 297 } };
const table = { id: "t", type: "table", x: 0, y: 0, w: 100, h: 50, source: "items", columns: [{ header: "A", value: "{{ row.A }}", w: 50 }] };

describe("StyleOverrideSchema / mergeStyle", () => {
  it("accepts a partial style without filling defaults", () => {
    expect(StyleOverrideSchema.parse({ bold: true })).toEqual({ bold: true });
    expect(StyleOverrideSchema.parse({})).toEqual({});
  });
  it("rejects unsafe colors like the full schema", () => {
    expect(StyleOverrideSchema.safeParse({ color: "red;background:url(x)" }).success).toBe(false);
  });
  it("mergeStyle overlays defined values only, later overrides win", () => {
    const s = mergeStyle(StyleSchema.parse({ fontSize: 8 }), { bold: true, fontSize: undefined }, undefined, { align: "right" });
    expect(s).toMatchObject({ fontSize: 8, bold: true, align: "right", color: "#000000" });
  });
});

describe("table schema (phase 2)", () => {
  it("fills new defaults: border all, borderStyle, headerStyle, groups, pageFooter, footer", () => {
    const r = parseReport({ ...base, elements: [table] });
    const t = r.elements[0];
    expect(t.type).toBe("table");
    if (t.type !== "table") return;
    expect(t.border).toBe("all");
    expect(t.borderStyle).toEqual({ stroke: "#000000", strokeWidth: 0.2 });
    expect(t.headerStyle).toEqual({});
    expect(t.groups).toEqual([]);
    expect(t.pageFooter).toEqual([]);
    expect(t.footer).toEqual([]);
    expect(t.columns[0].align).toBeUndefined();
    expect(t.columns[0].style.fontSize).toBe(10);   // 1단계 열 스타일은 그대로 기본값이 채워진다
  });
  it("parses cells with span, align and a style override", () => {
    const t = TableElementSchema.parse({ ...table, footer: [{ value: "합계", span: "all", align: "right", style: { bold: true } }, { value: "" }] });
    expect(t.footer[0]).toEqual({ value: "합계", span: "all", align: "right", style: { bold: true } });
    expect(t.footer[1]).toEqual({ value: "", span: 1 });
  });
  it("parses groups with by/header/footer and keepHeaderWithRows default true", () => {
    const t = TableElementSchema.parse({ ...table, groups: [{ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }] }] });
    expect(t.groups[0]).toEqual({ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }], footer: [], keepHeaderWithRows: true });
  });
  it("rejects a zero span, an unknown border and an unsafe border color", () => {
    expect(TableElementSchema.safeParse({ ...table, footer: [{ value: "x", span: 0 }] }).success).toBe(false);
    expect(TableElementSchema.safeParse({ ...table, border: "dotted" }).success).toBe(false);
    expect(TableElementSchema.safeParse({ ...table, borderStyle: { stroke: "url(x)" } }).success).toBe(false);
  });
  it("keeps 1단계 table JSON valid (keepTogether none is accepted)", () => {
    expect(TableElementSchema.safeParse({ ...table, keepTogether: "none", overflow: "clip" }).success).toBe(true);
  });
});
