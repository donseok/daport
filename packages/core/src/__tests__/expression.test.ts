import { describe, it, expect } from "vitest";
import { evaluate, ExpressionError } from "../expression/engine";
import { interpolate, hasTemplate, evaluateTemplateValue } from "../expression/template";
import { rowsProxy } from "../data/resolve";

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

describe("evaluateTemplateValue", () => {
  const vctx = { ...ctx, a: 1, b: 2 };
  it("interpolates multi-segment templates as a string", () => {
    expect(evaluateTemplateValue("{{ a }}/{{ b }}", vctx)).toBe("1/2");
  });
  it("keeps the raw type of a single segment", () => {
    expect(evaluateTemplateValue("{{ order.QTY > 2 }}", vctx)).toBe(true);
    expect(evaluateTemplateValue("  {{ order.QTY }}  ", vctx)).toBe(3);
  });
  it("returns a plain string unchanged", () => {
    expect(evaluateTemplateValue("plain", vctx)).toBe("plain");
  });
});

/** 결과가 undefined이거나 ExpressionError를 던져야 한다. 함수·프로토타입이 나오면 실패 */
function expectBlocked(expression: string, context: Record<string, unknown>) {
  let result: unknown;
  try {
    result = evaluate(expression, context);
  } catch (e) {
    expect(e).toBeInstanceOf(ExpressionError);
    return;
  }
  expect(typeof result).not.toBe("function");
  expect(result).toBeUndefined();
}

describe("forbidden identifier guard", () => {
  it("blocks computed prototype keys", () => {
    expectBlocked("order['con' + 'structor']", ctx);
    expectBlocked("order['__pro' + 'to__']", ctx);
    expectBlocked("items[0]['con' + 'structor']", ctx);
    expectBlocked("order.DT['con' + 'structor']", ctx);
    expectBlocked("order['__pro' + 'to__']['has' + 'OwnProperty']", ctx);
    // 필터 결과 배열은 jexl이 새로 만든 값이라 컨텍스트 Proxy를 거치지 않는다
    expectBlocked("items[.QTY > 1]['con' + 'structor']", ctx);
    expectBlocked("items[.QTY > 1]['__pro' + 'to__']", ctx);
  });
  it("resolves global names used as member names from data", () => {
    expect(evaluate("order.window", { order: { window: "W1" } })).toBe("W1");
    expect(evaluate("order.process", { order: { process: "P" } })).toBe("P");
    expect(evaluate("row.Function", { row: { Function: "F" } })).toBe("F");
  });
  it("rejects global names as root identifiers", () => {
    expect(() => evaluate("window", {})).toThrow(ExpressionError);
    expect(() => evaluate("process", {})).toThrow(ExpressionError);
    expect(() => evaluate("1 + require", {})).toThrow(ExpressionError);
  });
  it("keeps registered functions working on rowsProxy datasets and dates", () => {
    const rctx = { items: rowsProxy([{ QTY: 4, DT: new Date("2026-09-16T00:00:00Z") }, { QTY: 6 }]) };
    expect(evaluate("items.QTY", rctx)).toBe(4);
    expect(evaluate("items[1].QTY", rctx)).toBe(6);
    expect(evaluate("sum(items, 'QTY')", rctx)).toBe(10);
    expect(evaluate("count(items)", rctx)).toBe(2);
    expect(evaluate("formatDate(items.DT, 'yyyy-MM-dd')", rctx)).toBe("2026-09-16");
    expect(evaluate("formatDate(order.DT, 'yyyy-MM-dd')", ctx)).toBe("2026-09-16");
    expect(evaluate("formatNumber(order.PRICE * order.QTY, '#,##0')", ctx)).toBe("3,000");
  });
});
