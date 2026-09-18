import { describe, it, expect } from "vitest";
import { FakeSqlConnector } from "../testing";

describe("FakeSqlConnector", () => {
  it("returns defaults, scripted results per query, records calls and can fail", async () => {
    const f = new FakeSqlConnector({ rows: [{ A: 1 }], columns: [{ name: "A", type: "number" }] });
    f.when("FROM LINES", { rows: [{ NO: "x" }], columns: [{ name: "NO", type: "string" }] }).when("FROM BAD", { fail: "SQL_ERROR" });
    expect((await f.query("SELECT 1 FROM DUAL", {}, { timeoutMs: 1, maxRows: 1 })).rows).toEqual([{ A: 1 }]);
    expect((await f.query("SELECT * FROM LINES", { no: 1 }, { timeoutMs: 1, maxRows: 1 })).rows).toEqual([{ NO: "x" }]);
    await expect(f.query("SELECT * FROM BAD", {}, { timeoutMs: 1, maxRows: 1 })).rejects.toMatchObject({ code: "SQL_ERROR" });
    expect(f.calls.map((c) => c.sql)).toHaveLength(3);
    expect(f.calls[1].binds).toEqual({ no: 1 });
    await expect(f.ping()).resolves.toBeUndefined();
    await expect(f.close()).resolves.toBeUndefined();
  });
  it("rejects with the guard like the real connectors", async () => {
    await expect(new FakeSqlConnector().query("DELETE FROM T", {}, { timeoutMs: 1, maxRows: 1 })).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
  });
});
