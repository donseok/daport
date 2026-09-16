import { describe, it, expect } from "vitest";
import { parseReport } from "../schema/report";
import { resolveData } from "../data/resolve";

const report = parseReport({
  id: "r", version: 1, page: { width: 100, height: 100 },
  params: [{ name: "orderNo", type: "string", required: true }, { name: "copies", type: "number", default: 1 }],
  datasets: [
    { name: "order", type: "static", rows: [{ CUSTOMER_NAME: "ACME" }] },
    { name: "items", type: "static", rows: [{ QTY: 1 }, { QTY: 2 }] },
    { name: "empty", type: "static", rows: [] },
  ],
});

describe("resolveData", () => {
  it("exposes params, first row as object, and rows array", async () => {
    const ctx = await resolveData(report, { orderNo: "A" });
    expect(ctx.params).toEqual({ orderNo: "A", copies: 1 });
    expect((ctx.order as any).CUSTOMER_NAME).toBe("ACME");
    expect(ctx.items).toHaveLength(2);
    expect((ctx.items as any).QTY).toBe(1);   // 배열이지만 첫 행 필드도 접근 가능
    expect(ctx.empty).toEqual([]);
  });
  it("throws when required param missing", async () => {
    await expect(resolveData(report, {})).rejects.toThrow(/orderNo/);
  });
  it("rejects sql/http datasets in phase 1", async () => {
    const r = parseReport({ id: "x", version: 1, page: { width: 1, height: 1 },
      datasets: [{ name: "d", type: "sql", connection: "mes", query: "select 1" }] });
    await expect(resolveData(r, {})).rejects.toThrow(/not supported/);
  });
});
