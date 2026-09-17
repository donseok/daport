import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { sampleParams, sampleContext } from "../data";

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
});
