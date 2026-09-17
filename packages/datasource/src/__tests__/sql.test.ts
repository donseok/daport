import { describe, it, expect, vi } from "vitest";
import { parseReport } from "@daport/core";
import { executeDatasets, extractBinds, type SqlConnector } from "../index";

describe("extractBinds", () => {
  it("returns only :names present in params, ignoring string literals and ::casts", () => {
    const sql = "SELECT * FROM T WHERE NO = :orderNo AND DT >= :from AND X = ':notABind' AND Y = :missing";
    expect(extractBinds(sql, { orderNo: "A", from: "2026-01-01", extra: 1 })).toEqual({ orderNo: "A", from: "2026-01-01" });
    expect(extractBinds("SELECT CAST(a AS b) FROM T", { a: 1 })).toEqual({});
  });
});

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 },
  params: [{ name: "orderNo", type: "string" }],
  datasets: [{ name: "lines", type: "sql", connection: "mes", query: "SELECT NO, QTY FROM LINES WHERE NO = :orderNo" }] });

describe("executeDatasets sql", () => {
  it("passes sql, binds and limits to the named connector and wraps the rows", async () => {
    const query = vi.fn<SqlConnector["query"]>().mockResolvedValue({ rows: [{ NO: "A", QTY: 2 }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }] });
    const { context, errors } = await executeDatasets(report, { params: { orderNo: "A" }, connectors: { sql: { mes: { query } } }, secrets: () => undefined, limits: { timeoutMs: 5 } });
    expect(errors).toEqual([]);
    expect(query).toHaveBeenCalledWith("SELECT NO, QTY FROM LINES WHERE NO = :orderNo", { orderNo: "A" }, expect.objectContaining({ timeoutMs: 5, maxRows: 10_000 }));
    expect((context.lines as { QTY: number }).QTY).toBe(2);
  });
  it("reports SQL_NOT_CONFIGURED without a connector for that connection", async () => {
    const { errors } = await executeDatasets(report, { params: {}, connectors: { sql: { other: { query: vi.fn() } } }, secrets: () => undefined });
    expect(errors).toEqual([{ dataset: "lines", code: "SQL_NOT_CONFIGURED", message: 'sql connection "mes" is not configured' }]);
  });
  it("reports SQL_ERROR for a connector failure and TOO_MANY_ROWS for oversized results", async () => {
    const failing: SqlConnector = { query: async () => { throw new Error("ORA-00942: table or view does not exist"); } };
    expect((await executeDatasets(report, { params: {}, connectors: { sql: { mes: failing } }, secrets: () => undefined })).errors[0])
      .toEqual({ dataset: "lines", code: "SQL_ERROR", message: "ORA-00942: table or view does not exist" });
    const big: SqlConnector = { query: async () => ({ rows: [{ a: 1 }, { a: 2 }], columns: [] }) };
    expect((await executeDatasets(report, { params: {}, connectors: { sql: { mes: big } }, secrets: () => undefined, limits: { maxRows: 1 } })).errors[0].code).toBe("TOO_MANY_ROWS");
  });
});
