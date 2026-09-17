import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { sampleParams, sampleContext, requestBody } from "../data";

const base = { id: "r", version: 1, page: { width: 10, height: 10 } };
const report = parseReport({ ...base, params: [
  { name: "lot", type: "string", required: true },
  { name: "qty", type: "number" },
  { name: "dt", type: "date", default: "2026-09-16" },
]});

describe("sampleParams", () => {
  it("uses the default, 0 for numbers and {name} otherwise", () => {
    expect(sampleParams(report)).toEqual({ lot: "{lot}", qty: 0, dt: "2026-09-16" });
  });
});

describe("sampleContext", () => {
  it("falls back to sampleParams and static rows without a sample", () => {
    const r = parseReport({ ...base, params: [{ name: "qty", type: "number", default: "5" }], datasets: [
      { name: "s", type: "static", rows: [{ A: 1 }] }, { name: "h", type: "http", url: "https://x" }] });
    const ctx = sampleContext(r);
    expect(ctx.params).toEqual({ qty: 5 });
    expect((ctx.s as { A: number }).A).toBe(1);
    expect(ctx.h).toEqual([]);
  });
  it("prefers sample params (merged over placeholders) and sample data, and includes data-only names", () => {
    const r = parseReport({ ...base, params: [{ name: "lot" }, { name: "qty", type: "number" }], datasets: [{ name: "s", type: "static", rows: [{ A: 1 }] }],
      sample: { params: { lot: "L9" }, data: { s: [{ A: 2 }], extra: { X: 1 }, junk: "x" }, capturedAt: "2026-09-17T00:00:00.000Z" } });
    const ctx = sampleContext(r);
    expect(ctx.params).toEqual({ lot: "L9", qty: 0 });
    expect((ctx.s as { A: number }).A).toBe(2);
    expect(ctx.extra).toEqual([{ X: 1 }]);
    expect(ctx.junk).toEqual([]);
  });
  it("skips __proto__/constructor/prototype in sample data and never touches the context's own prototype, while an identifier like toString is included", () => {
    const r = parseReport({ ...base, params: [{ name: "lot" }], datasets: [{ name: "s", type: "static", rows: [{ A: 1 }] }],
      // JSON.parse(문자열)로 만들어야 진짜 own key "__proto__"가 생긴다
      sample: { params: {}, data: JSON.parse('{"__proto__": [{"x": 1}], "toString": [{"y": 1}]}'), capturedAt: "2026-09-17T00:00:00.000Z" } });
    const ctx = sampleContext(r);
    expect(Object.getPrototypeOf(ctx)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(ctx, "__proto__")).toBe(false);
    expect((ctx.toString as unknown as { y: number }[])[0].y).toBe(1);
  });
});

describe("requestBody", () => {
  it("sends merged params and sample.data unless live data is on or there is no sample", () => {
    const r = parseReport({ ...base, params: [{ name: "lot" }], sample: { params: { lot: "L1" }, data: { s: [{ A: 1 }] }, capturedAt: "2026-09-17T00:00:00.000Z" } });
    expect(requestBody(r, false)).toEqual({ report: r, params: { lot: "L1" }, data: { s: [{ A: 1 }] } });
    expect(requestBody(r, true)).toEqual({ report: r, params: { lot: "L1" } });
    const plain = parseReport({ ...base, params: [{ name: "lot" }] });
    expect(requestBody(plain, false)).toEqual({ report: plain, params: { lot: "{lot}" } });
  });
});

describe("sample props (컴포넌트 모드)", () => {
  it("puts props into the canvas context and does not let sample data override it", () => {
    const r = parseReport({ ...base, sample: { params: {}, data: { props: [{ title: "data" }] }, capturedAt: "2026-09-17T00:00:00.000Z" } });
    const ctx = sampleContext(r, { title: "샘플" });
    expect(ctx.props).toEqual({ title: "샘플" });
    expect(Object.hasOwn(sampleContext(r), "props")).toBe(false);
  });
  it("adds props to the request body only when given", () => {
    const r = parseReport(base);
    expect(requestBody(r, false, { title: "샘플" })).toEqual({ report: r, params: {}, props: { title: "샘플" } });
    expect("props" in requestBody(r, false)).toBe(false);
  });
});
