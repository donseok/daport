import { describe, it, expect, vi } from "vitest";
import { createAgentConnector } from "../index";

const conn = { name: "factory", via: "agent" as const, url: "https://agent.local:8433/", secretRef: "AGENT" };
const opts = { timeoutMs: 1000, maxRows: 10 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createAgentConnector", () => {
  it("POSTs /query with bearer token, manual redirect and a timeout margin, returns rows/columns", async () => {
    const fetchImpl = vi.fn(async () => json({ rows: [{ NO: "A" }], columns: [{ name: "NO", type: "string" }] }));
    const c = createAgentConnector(conn, "tok", fetchImpl as unknown as typeof fetch);
    const res = await c.query("SELECT NO FROM T WHERE NO = :no", { no: "A" }, opts);
    expect(res.rows).toEqual([{ NO: "A" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agent.local:8433/query");
    expect(init.method).toBe("POST"); expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ sql: "SELECT NO FROM T WHERE NO = :no", binds: { no: "A" }, timeoutMs: 1000, maxRows: 10 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("maps agent statuses and error codes", async () => {
    const c = (r: Response) => createAgentConnector(conn, "tok", (async () => r) as unknown as typeof fetch);
    await expect(c(json({ error: { code: "UNAUTHORIZED" } }, 401)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_CONFIGURED" });
    await expect(c(json({ error: { code: "BUSY" } }, 429)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR", message: /과부하/ });
    await expect(c(json({ error: { code: "TIMEOUT", message: "t" } }, 504)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(c(json({ error: { code: "SQL_NOT_ALLOWED", message: "x" } }, 400)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    await expect(c(new Response("boom", { status: 500 })).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
    await expect(c(new Response(null, { status: 302, headers: { location: "https://x" } })).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
    await expect(c(new Response("not json", { status: 200 })).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
  });
  it("guards before sending, maps network failures/timeouts, and rejects oversized bodies", async () => {
    const fetchImpl = vi.fn();
    const c = createAgentConnector(conn, "tok", fetchImpl as unknown as typeof fetch);
    await expect(c.query("DROP TABLE T", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(c.query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "TIMEOUT" });
    fetchImpl.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(c.query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
    const big = new Response(new Blob(["x".repeat(21 * 1024 * 1024)]), { status: 200 });
    fetchImpl.mockResolvedValueOnce(big);
    await expect(c.query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  it("ping GETs /health and refuses plain http except localhost", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    await createAgentConnector(conn, "tok", fetchImpl as unknown as typeof fetch).ping();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://agent.local:8433/health");
    expect(() => createAgentConnector({ ...conn, url: "http://agent.local" }, "tok")).toThrow(/https/);
    expect(() => createAgentConnector({ ...conn, url: "http://localhost:8433" }, "tok")).not.toThrow();
    const bad = createAgentConnector(conn, "tok", (async () => json({ ok: false }, 503)) as unknown as typeof fetch);
    await expect(bad.ping()).rejects.toMatchObject({ code: "SQL_ERROR" });
  });
});
