// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";
import { FakeSqlConnector } from "@daport/oracle/testing";

const fake = new FakeSqlConnector();
vi.mock("@daport/oracle", async (orig) => ({ ...(await orig<typeof import("@daport/oracle")>()), connectorFor: vi.fn(() => fake) }));
const { runDatasets } = await import("../datasets");
const { getConnectionStore } = await import("../connection-store");
const { connectorFor } = await import("@daport/oracle");

afterEach(() => { vi.unstubAllEnvs(); (connectorFor as unknown as ReturnType<typeof vi.fn>).mockClear(); });

const staticHttpReport = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, datasets: [
  { name: "s", type: "static", rows: [{ A: 1 }] }, { name: "h", type: "http", url: "https://mes.example.com/x" }] });

describe("runDatasets", () => {
  it("runs static datasets and blocks http hosts not in DAPORT_HTTP_ALLOW", async () => {
    vi.stubEnv("DAPORT_HTTP_ALLOW", "");
    const { context, errors } = await runDatasets(staticHttpReport, {});
    expect((context.s as { A: number }).A).toBe(1);
    expect(errors).toEqual([{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: mes.example.com" }]);
  });
  it("prefers request data", async () => {
    const { context, errors } = await runDatasets(staticHttpReport, { data: { h: [{ B: 2 }] } });
    expect(errors).toEqual([]);
    expect((context.h as { B: number }).B).toBe(2);
  });
});

const sqlReport = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "lines", type: "sql", connection: "mes", query: "SELECT NO FROM LINES" }] });

describe("runDatasets sql assembly", () => {
  it("builds a connector per referenced connection and returns rows and columns", async () => {
    await getConnectionStore().upsert({ name: "mes", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" });
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const { context, errors, columns } = await runDatasets(sqlReport, { params: {} });
    expect(errors).toEqual([]);
    expect((context.lines as { NO: string }).NO).toBe("A-1");
    expect(columns).toEqual({ lines: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }, { name: "DT", type: "date" }] });
    expect(connectorFor).toHaveBeenCalledTimes(1);
  });
  it("reports SQL_NOT_CONFIGURED when the connection is missing or its secret is unset", async () => {
    await getConnectionStore().delete("mes");
    expect((await runDatasets(sqlReport, { params: {} })).errors).toEqual([expect.objectContaining({ dataset: "lines", code: "SQL_NOT_CONFIGURED" })]);
    await getConnectionStore().upsert({ name: "mes", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" });
    (connectorFor as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw Object.assign(new Error("no secret"), { code: "SQL_NOT_CONFIGURED" }); });
    expect((await runDatasets(sqlReport, { params: {} })).errors[0].code).toBe("SQL_NOT_CONFIGURED");
  });
});
