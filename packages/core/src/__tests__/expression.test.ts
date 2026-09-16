import { describe, it, expect } from "vitest";
import { evaluate, ExpressionError } from "../expression/engine";
import { interpolate, hasTemplate } from "../expression/template";

const ctx = {
  params: { orderNo: "A-1" },
  order: { CUSTOMER_NAME: "ACME", QTY: 3, PRICE: 1000, DT: new Date("2026-09-16T00:00:00Z") },
  items: [{ QTY: 1 }, { QTY: 2 }],
};

describe("evaluate", () => {
  it("reads fields and does math", () => {
    expect(evaluate("order.QTY * order.PRICE", ctx)).toBe(3000);
    expect(evaluate("params.orderNo", ctx)).toBe("A-1");
  });
  it("supports ternary and comparison", () => {
    expect(evaluate("order.QTY > 2 ? 'many' : 'few'", ctx)).toBe("many");
  });
  it("runs registered functions", () => {
    expect(evaluate("sum(items, 'QTY')", ctx)).toBe(3);
    expect(evaluate("count(items)", ctx)).toBe(2);
    expect(evaluate("formatNumber(1234567.891, '#,##0.00')", ctx)).toBe("1,234,567.89");
    expect(evaluate("formatDate(order.DT, 'yyyy-MM-dd')", ctx)).toBe("2026-09-16");
    expect(evaluate("pad(7, 3, '0')", ctx)).toBe("007");
    expect(evaluate("upper('ab')", ctx)).toBe("AB");
    expect(evaluate("default(order.MISSING, '-')", ctx)).toBe("-");
  });
  it("blocks prototype and global access", () => {
    expect(() => evaluate("order.constructor", ctx)).toThrow(ExpressionError);
    expect(() => evaluate("order.__proto__", ctx)).toThrow(ExpressionError);
    expect(() => evaluate("globalThis", ctx)).toThrow(ExpressionError);
  });
  it("wraps syntax errors", () => {
    expect(() => evaluate("order.", ctx)).toThrow(ExpressionError);
  });
});

describe("interpolate", () => {
  it("replaces all {{ }} segments", () => {
    expect(interpolate("고객: {{ order.CUSTOMER_NAME }} / {{ order.QTY }}개", ctx)).toBe("고객: ACME / 3개");
  });
  it("returns plain string unchanged", () => {
    expect(interpolate("no template", ctx)).toBe("no template");
    expect(hasTemplate("no template")).toBe(false);
    expect(hasTemplate("{{ a }}")).toBe(true);
  });
  it("renders null/undefined as empty", () => {
    expect(interpolate("[{{ order.MISSING }}]", ctx)).toBe("[]");
  });
  it("throws ExpressionError on bad segment", () => {
    expect(() => interpolate("{{ order. }}", ctx)).toThrow(ExpressionError);
  });
});
