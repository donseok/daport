import { describe, it, expect } from "vitest";
import { evaluate, ExpressionError } from "../expression/engine";
import { evaluateSource, usesPageVars } from "../expression/source";

const rows = [{ Q: 10 }, { Q: "20" }, { Q: null }, { Q: "abc" }, { Q: true }, {}];

describe("avg/min/max", () => {
  it("skip non-numeric values (null, empty, boolean, NaN strings)", () => {
    expect(evaluate("avg(rows, 'Q')", { rows })).toBe(15);
    expect(evaluate("min(rows, 'Q')", { rows })).toBe(10);
    expect(evaluate("max(rows, 'Q')", { rows })).toBe(20);
  });
  it("return null for an empty array or no numeric value, and for a non-array", () => {
    expect(evaluate("avg(rows, 'Q')", { rows: [] })).toBeNull();
    expect(evaluate("max(rows, 'Q')", { rows: [{ Q: "x" }] })).toBeNull();
    expect(evaluate("min(rows, 'Q')", { rows: 5 })).toBeNull();
  });
  it("reject prototype keys as field names", () => {
    expect(() => evaluate("avg(rows, '__proto__')", { rows })).toThrow(ExpressionError);
  });
});

describe("compile cache", () => {
  it("evaluates the same expression many times faster than re-parsing (10k rows under 300ms)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ A: i, B: `n${i}` }));
    const t0 = performance.now();
    for (const row of many) evaluate("row.A * 2 + (row.B == 'n3' ? 1 : 0)", { row });
    expect(performance.now() - t0).toBeLessThan(300);
  });
  it("still rejects forbidden identifiers and syntax errors after caching", () => {
    expect(() => evaluate("a.constructor", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluate("a.constructor", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluate("a +", { a: 1 })).toThrow(ExpressionError);
    expect(() => evaluate("a +", { a: 1 })).toThrow(ExpressionError);
  });
  it("keeps the filter key guard on cached expressions", () => {
    expect(() => evaluate("a['constructor']", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluate("a['constructor']", { a: {} })).toThrow(ExpressionError);
    expect(evaluate("a['b']", { a: { b: 1 } })).toBe(1);
  });
});

describe("evaluateSource", () => {
  const ctx = { items: [{ ORDER_NO: "A", Q: 1 }, { ORDER_NO: "B", Q: 2 }, { ORDER_NO: "A", Q: 3 }], record: { ORDER_NO: "A", lines: [{ n: 1 }] } };
  it("returns the dataset array, a nested array and a jexl-filtered join", () => {
    expect(evaluateSource("items", ctx)).toHaveLength(3);
    expect(evaluateSource("record.lines", ctx)).toEqual([{ n: 1 }]);
    expect(evaluateSource("items[.ORDER_NO == record.ORDER_NO]", ctx).map((r) => (r as { Q: number }).Q)).toEqual([1, 3]);
  });
  it("treats null/undefined as empty and rejects a non-array with a clear message", () => {
    expect(evaluateSource("record.missing", ctx)).toEqual([]);
    expect(() => evaluateSource("record.ORDER_NO", ctx)).toThrow(/source is not an array/);
    expect(() => evaluateSource("record.", ctx)).toThrow(ExpressionError);
  });
});

describe("usesPageVars", () => {
  it("detects page-dependent variables as whole words only", () => {
    expect(usesPageVars("{{ page }} / {{ total }}")).toBe(true);
    expect(usesPageVars("{{ sum(pageRows, 'Q') }}")).toBe(true);
    expect(usesPageVars("{{ row.pages }} {{ copyright }}")).toBe(false);
    expect(usesPageVars("plain")).toBe(false);
  });
});
