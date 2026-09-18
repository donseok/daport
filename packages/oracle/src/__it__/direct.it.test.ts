import { describe, it, expect, beforeAll, afterAll } from "vitest";
// 실제 설치된 @testcontainers/oraclefree@11.14.0의 export는 OracleDbContainer/StartedOracleDbContainer
// (브리프의 OracleFreeContainer/StartedOracleFreeContainer는 이 버전에서 이름이 바뀌었다)
import { OracleDbContainer, type StartedOracleDbContainer } from "@testcontainers/oraclefree";
import { createDirectConnector, closeConnector, type ManagedConnector } from "../index";

const enabled = process.env.ORACLE_IT === "1";
let container: StartedOracleDbContainer; let c: ManagedConnector;
const opts = { timeoutMs: 30_000, maxRows: 10_000 };

beforeAll(async () => {
  if (!enabled) return;
  container = await new OracleDbContainer("gvenzl/oracle-free:23.26.3-slim-faststart").withUsername("rpt").withPassword("rptpw").start();
  c = createDirectConnector({ name: "it", via: "direct", host: container.getHost(), port: container.getPort(), service: container.getDatabase(), user: container.getUsername(), secretRef: "IT" }, container.getPassword());
}, 600_000);
afterAll(async () => { if (!enabled) return; await closeConnector("it"); await container.stop(); });

describe.skipIf(!enabled)("direct connector against Oracle Free", () => {
  it("converts DATE/TIMESTAMP/NUMBER/CLOB/NULL to pure JSON", async () => {
    const res = await c.query(`SELECT DATE '2026-09-18' AS D, TIMESTAMP '2026-09-18 01:02:03.456' AS T,
      TIMESTAMP '2026-09-18 01:02:03 +09:00' AS TZ, 12345678901234567890 AS BIG, 3.5 AS F, TO_CLOB('hello') AS C, CAST(NULL AS VARCHAR2(10)) AS N FROM DUAL`, {}, opts);
    expect(res.rows[0]).toEqual({ D: "2026-09-18T00:00:00.000Z", T: "2026-09-18T01:02:03.456Z", TZ: "2026-09-17T16:02:03.000Z", BIG: "12345678901234567890", F: 3.5, C: "hello", N: null });
    expect(res.columns.map((x) => x.type)).toEqual(["date", "date", "date", "number", "number", "string", "string"]);
  });
  it("binds by name and rejects writes/locks at the guard before the driver sees them", async () => {
    expect((await c.query("SELECT :a + :b AS S FROM DUAL", { a: 1, b: 2 }, opts)).rows[0]).toEqual({ S: 3 });
    await expect(c.query("INSERT INTO DUAL VALUES ('Y')", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    await expect(c.query("SELECT * FROM DUAL FOR UPDATE", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
  });
  it("enforces the row limit and the timeout, and ping works", async () => {
    await expect(c.query("SELECT LEVEL AS N FROM DUAL CONNECT BY LEVEL <= 20000", {}, opts)).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
    await expect(c.query("SELECT COUNT(*) AS N FROM (SELECT LEVEL FROM DUAL CONNECT BY LEVEL <= 3000000) a, (SELECT LEVEL FROM DUAL CONNECT BY LEVEL <= 3000) b", {}, { ...opts, timeoutMs: 1_000 })).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(c.ping()).resolves.toBeUndefined();
  });
  it("reports unsupported column types", async () => {
    await expect(c.query("SELECT HEXTORAW('FF') AS R FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR", message: /지원하지 않는 컬럼 타입: R/ });
  });
});
