import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { FakeSqlConnector } from "@daport/oracle/testing";
import { createAgentConnector } from "@daport/oracle";
import { createAgentServer } from "../server";

const TOKEN = "r".repeat(32);
let server: ReturnType<typeof createAgentServer>; let url: string;
beforeAll(async () => {
  server = createAgentServer({ connector: new FakeSqlConnector().when("FROM BAD", { fail: "SQL_ERROR" }), token: TOKEN, version: "rt" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe("AgentConnector ↔ agent server", () => {
  it("round-trips a query, a failure and a ping through real HTTP", async () => {
    const c = createAgentConnector({ name: "rt", via: "agent", url, secretRef: "X" }, TOKEN);
    const res = await c.query("SELECT NO FROM LINES", { no: 1 }, { timeoutMs: 1000, maxRows: 10 });
    expect(res.rows[0]).toMatchObject({ NO: "A-1" });
    await expect(c.query("SELECT 1 FROM BAD", {}, { timeoutMs: 1000, maxRows: 10 })).rejects.toMatchObject({ code: "SQL_ERROR" });
    await expect(c.ping()).resolves.toBeUndefined();
    await expect(createAgentConnector({ name: "rt", via: "agent", url, secretRef: "X" }, "wrong".repeat(7)).ping()).rejects.toMatchObject({ code: "SQL_NOT_CONFIGURED" });
  });
});
