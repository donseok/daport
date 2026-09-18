// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";

const ping = vi.fn(); const closeConnector = vi.fn();
vi.mock("@daport/oracle", async (orig) => ({ ...(await orig<typeof import("@daport/oracle")>()), connectorFor: () => ({ query: vi.fn(), ping, close: vi.fn() }), closeConnector }));
const { GET } = await import("../route");
const { PUT, DELETE } = await import("../[name]/route");
const { POST: TEST } = await import("../[name]/test/route");
const { getStore, ready } = await import("@/lib/report-store");
const { getConnectionStore } = await import("@/lib/connection-store");

const ctx = (name: string) => ({ params: Promise.resolve({ name }) });
const req = (url: string, method: string, body?: unknown) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const mes = { via: "direct", host: "db.local", service: "ORCL", user: "rpt", secretRef: "MES_DB" };

beforeEach(() => { ping.mockReset().mockResolvedValue(undefined); closeConnector.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("connections API", () => {
  it("PUT validates and upserts (url name wins), GET lists with secretConfigured and usedBy, never the secret", async () => {
    await ready();
    expect((await PUT(req("/api/connections/mes", "PUT", { ...mes, name: "other" }), ctx("mes"))).status).toBe(200);
    expect((await PUT(req("/api/connections/mes", "PUT", { via: "agent", url: "http://evil", secretRef: "A" }), ctx("mes"))).status).toBe(400);
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const id = `conn-use-${Date.now()}`;
    await getStore().create({ id, version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "l", type: "sql", connection: "mes", query: "SELECT 1 FROM DUAL" }] });
    const list = await (await GET()).json();
    const row = list.find((c: { name: string }) => c.name === "mes");
    expect(row).toMatchObject({ name: "mes", via: "direct", host: "db.local", port: 1521, secretRef: "MES_DB", secretConfigured: true });
    expect(row.usedBy).toContain(id);
    expect(JSON.stringify(list)).not.toContain("pw");
    expect(closeConnector).toHaveBeenCalledWith("mes");
    // 사용 중이면 삭제 409
    const del = await DELETE(req("/api/connections/mes", "DELETE"), ctx("mes"));
    expect(del.status).toBe(409); expect((await del.json())).toMatchObject({ code: "CONNECTION_IN_USE", reports: [id] });
    await getStore().update(id, parseReport({ id, version: 1, page: { width: 10, height: 10 } }));
    expect((await DELETE(req("/api/connections/mes", "DELETE"), ctx("mes"))).status).toBe(204);
    expect((await DELETE(req("/api/connections/mes", "DELETE"), ctx("mes"))).status).toBe(404);
  });
  it("test route: 404 unknown, 400 SECRET_MISSING, 200 ok, 502 on ping failure", async () => {
    await getConnectionStore().upsert({ name: "t1", ...mes, port: 1521 } as never);
    expect((await TEST(req("/api/connections/nope/test", "POST"), ctx("nope"))).status).toBe(404);
    const missing = await TEST(req("/api/connections/t1/test", "POST"), ctx("t1"));
    expect(missing.status).toBe(400); expect((await missing.json()).code).toBe("SECRET_MISSING");
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const ok = await TEST(req("/api/connections/t1/test", "POST"), ctx("t1"));
    expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ ok: true });
    ping.mockRejectedValueOnce(Object.assign(new Error("연결 실패: NJS-501"), { code: "SQL_ERROR" }));
    const bad = await TEST(req("/api/connections/t1/test", "POST"), ctx("t1"));
    expect(bad.status).toBe(502); expect(await bad.json()).toMatchObject({ ok: false, error: { message: expect.stringContaining("NJS-501") } });
  });
});
