import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FakeSqlConnector } from "@daport/oracle/testing";
import { createAgentServer } from "../server";

const TOKEN = "t".repeat(32);
let base: string; let server: ReturnType<typeof createAgentServer>; const logs: string[] = [];
const fake = new FakeSqlConnector().when("FROM SLOW", { delayMs: 2_000 }).when("FROM BAD", { fail: "SQL_ERROR" }).when("FROM LATE", { fail: "TIMEOUT" });
/** fake.calls에 n개가 쌓일 때까지 짧게 폴링한다. 고정 sleep보다 느린 CI에서도 결정적이다 */
const waitForCalls = async (n: number, maxMs = 1_000) => {
  const start = Date.now();
  while (fake.calls.length < n) {
    if (Date.now() - start > maxMs) throw new Error(`calls did not reach ${n} within ${maxMs}ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const post = (body: unknown, token: string | null = TOKEN, raw = false) => fetch(`${base}/query`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });

beforeAll(async () => {
  server = createAgentServer({ connector: fake, token: TOKEN, version: "test", maxConcurrency: 2, maxBodyBytes: 1024, log: (l) => logs.push(l) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe("agent server", () => {
  it("health and query with a valid token", async () => {
    const h = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(h.status).toBe(200); expect(await h.json()).toEqual({ ok: true, version: "test" });
    const q = await post({ sql: "SELECT NO FROM LINES WHERE NO = :no", binds: { no: "A" }, timeoutMs: 999_999, maxRows: 999_999 });
    expect(q.status).toBe(200);
    expect(await q.json()).toEqual({ rows: [{ NO: "A-1", QTY: 3, DT: "2026-09-18T00:00:00.000Z" }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }, { name: "DT", type: "date" }] });
    const last = fake.calls.at(-1)!;
    expect(last.opts).toEqual({ timeoutMs: 30_000, maxRows: 10_000 });   // 상한으로 클램프
    expect(last.binds).toEqual({ no: "A" });
  });
  it("401 without or with a wrong token, 404 elsewhere, 413 over the body limit, 400 on bad JSON", async () => {
    expect((await post({ sql: "SELECT 1 FROM DUAL" }, null)).status).toBe(401);
    expect((await post({ sql: "SELECT 1 FROM DUAL" }, "x".repeat(32))).status).toBe(401);
    expect((await (await post({ sql: "SELECT 1 FROM DUAL" }, null)).json()).error.code).toBe("UNAUTHORIZED");
    expect((await fetch(`${base}/nope`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    expect((await post(JSON.stringify({ sql: "SELECT '" + "x".repeat(2000) + "' FROM DUAL" }), TOKEN, true)).status).toBe(413);
    expect((await post("{not json", TOKEN, true)).status).toBe(400);
    expect((await post({ sql: 5 })).status).toBe(400);
  });
  it("closes the request socket after a 413 so the connection cannot hang open", async () => {
    const { hostname, port } = new URL(base);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("소켓이 1초 내에 닫히지 않았습니다")), 1000);
      const req = http.request({ hostname, port: Number(port), path: "/query", method: "POST", agent: false, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });
      req.on("response", (res) => {
        expect(res.statusCode).toBe(413);
        res.resume();
        res.socket?.once("close", () => { clearTimeout(timer); resolve(); });
      });
      req.on("error", () => {});   // 소켓이 닫히며 나는 에러는 이미 응답을 받은 뒤라 무시한다
      req.write(JSON.stringify({ sql: "SELECT '" + "x".repeat(2000) + "' FROM DUAL" }));
      req.end();
    });
  });
  it("maps connector failures to statuses and codes", async () => {
    const guard = await post({ sql: "DELETE FROM T" });
    expect(guard.status).toBe(400); expect((await guard.json()).error.code).toBe("SQL_NOT_ALLOWED");
    const bad = await post({ sql: "SELECT 1 FROM BAD" });
    expect(bad.status).toBe(502); expect((await bad.json()).error.code).toBe("SQL_ERROR");
    const late = await post({ sql: "SELECT 1 FROM LATE" });
    expect(late.status).toBe(504); expect((await late.json()).error.code).toBe("TIMEOUT");
  });
  it("returns 429 beyond maxConcurrency", async () => {
    const before = fake.calls.length;
    const slow = [post({ sql: "SELECT 1 FROM SLOW" }), post({ sql: "SELECT 1 FROM SLOW" })];
    await waitForCalls(before + 2);   // 두 느린 요청이 커넥터에 들어갈 때까지만 기다린다 — 고정 sleep이 아니라 결정적 신호
    const third = await post({ sql: "SELECT 1 FROM DUAL" });
    expect(third.status).toBe(429); expect((await third.json()).error.code).toBe("BUSY");
    expect((await Promise.all(slow)).map((r) => r.status)).toEqual([200, 200]);
  });
  it("access log has method/path/status/ms but never the SQL, binds or token", () => {
    expect(logs.some((l) => /POST \/query 200 \d+ms/.test(l))).toBe(true);
    expect(logs.join("\n")).not.toMatch(/SELECT|LINES|A-1|t{32}/);
  });
});
