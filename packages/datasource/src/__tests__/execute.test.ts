import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { executeDatasets, toRows, DatasetFailure } from "../index";

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 },
  params: [{ name: "no", type: "string", required: true }, { name: "qty", type: "number", default: "3" }],
  datasets: [
    { name: "cert", type: "static", rows: [{ A: 1 }] },
    { name: "items", type: "static", rows: [{ A: 2 }, { A: 3 }] },
    { name: "orders", type: "http", url: "https://mes.example.com/x" },
    { name: "lines", type: "sql", connection: "mes", query: "SELECT 1" },
  ]});
const run = (opts: Partial<Parameters<typeof executeDatasets>[1]> = {}) =>
  executeDatasets(report, { params: { no: "A" }, connectors: {}, secrets: () => undefined, ...opts });

describe("executeDatasets", () => {
  it("normalizes params, loads static rows as rowsProxy arrays and reports unconfigured http/sql as errors", async () => {
    const { context, errors } = await run();
    expect(context.params).toEqual({ no: "A", qty: 3 });
    expect((context.cert as { A: number }).A).toBe(1);               // ds.FIELD
    expect((context.items as unknown[]).length).toBe(2);
    expect(errors.map((e) => [e.dataset, e.code])).toEqual([["orders", "HOST_NOT_ALLOWED"], ["lines", "SQL_NOT_CONFIGURED"]]);
    expect(context.orders).toBeUndefined();
  });
  it("prefers request data over dataset definitions and includes data-only names", async () => {
    const { context, errors } = await run({ data: { items: [{ A: 9 }], orders: { id: 1 }, lines: [], extra: [{ X: 1 }] } });
    expect(errors).toEqual([]);
    expect((context.items as { A: number }[]).map((r) => r.A)).toEqual([9]);
    expect(context.orders).toEqual([{ id: 1 }]);                      // 객체는 [객체]
    expect((context.extra as { X: number }).X).toBe(1);
  });
  it("throws on a missing required param (the caller answers 400)", async () => {
    await expect(run({ params: {} })).rejects.toThrow(/missing required param: no/);
  });
  it("rejects data whose rows are not objects with BAD_DATA and keeps going", async () => {
    const { context, errors } = await run({ data: { items: [1, 2], orders: "x", lines: [] } });
    expect(errors.map((e) => [e.dataset, e.code])).toEqual([["items", "BAD_DATA"], ["orders", "BAD_DATA"]]);
    expect(context.items).toBeUndefined();
    expect(context.lines).toEqual([]);
  });
  it("applies limits.maxRows to request data too", async () => {
    const { errors } = await run({ data: { items: [{ A: 1 }, { A: 2 }], orders: [], lines: [] }, limits: { maxRows: 1 } });
    expect(errors).toEqual([{ dataset: "items", code: "TOO_MANY_ROWS", message: "2 rows, more than the limit of 1" }]);
  });
  it("refuses request data whose name is a reserved context name and keeps params intact", async () => {
    const { context, errors } = await run({ data: { params: [{ hack: 1 }], page: { x: 1 }, orders: [], lines: [] } });
    expect(context.params).toEqual({ no: "A", qty: 3 });
    expect(context.page).toBeUndefined();
    expect(errors.map((e) => [e.dataset, e.code, e.message])).toEqual([["params", "BAD_DATA", "reserved name: params"], ["page", "BAD_DATA", "reserved name: page"]]);
  });
});

describe("toRows", () => {
  it("wraps an object, keeps an object array, rejects the rest", () => {
    expect(toRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    for (const bad of [null, 1, "s", [1], [{ a: 1 }, null], undefined]) expect(() => toRows(bad)).toThrow(DatasetFailure);
  });
});
