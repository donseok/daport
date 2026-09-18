import { describe, it, expect, beforeEach, vi } from "vitest";

// oracledb를 통째로 가짜로 바꾼다. 풀·커넥션의 호출 순서와 옵션만 검증한다 (실제 DB는 __it__ 통합 테스트)
const execute = vi.fn();
const connection = { execute, close: vi.fn().mockResolvedValue(undefined), callTimeout: 0 };
const pool = { getConnection: vi.fn().mockResolvedValue(connection), close: vi.fn().mockResolvedValue(undefined) };
const createPool = vi.fn().mockResolvedValue(pool);
vi.mock("oracledb", () => ({ default: { createPool, OUT_FORMAT_OBJECT: 4002, STRING: 2001, DB_TYPE_NUMBER: 2010, DB_TYPE_CLOB: 2017 } }));
const { createDirectConnector, closeConnector } = await import("../index");

const conn = { name: "mes", via: "direct" as const, host: "db.local", port: 1521, service: "ORCL", user: "rpt", secretRef: "MES_DB" };
const opts = { timeoutMs: 5000, maxRows: 2 };

beforeEach(async () => {
  await closeConnector("mes");
  execute.mockReset(); createPool.mockClear(); pool.getConnection.mockClear(); connection.close.mockClear();
  execute.mockImplementation(async (sql: string) => sql.startsWith("SELECT") ? { rows: [{ NO: "A", QTY: "3" }], metaData: [{ name: "NO", dbTypeName: "VARCHAR2" }, { name: "QTY", dbTypeName: "NUMBER" }] } : {});
});

describe("createDirectConnector", () => {
  it("creates one pool per connection name with thin-mode options and reuses it", async () => {
    const c = createDirectConnector(conn, "pw");
    await c.query("SELECT NO, QTY FROM T", {}, opts);
    await c.query("SELECT NO, QTY FROM T", {}, opts);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool.mock.calls[0][0]).toMatchObject({ user: "rpt", password: "pw", connectString: "db.local:1521/ORCL", poolMin: 0, poolMax: 4, poolTimeout: 60 });
    expect(typeof createPool.mock.calls[0][0].sessionCallback).toBe("function");
  });
  it("runs guard → READ ONLY → execute with maxRows+1 and fetchTypeHandler → rollback+close, converting rows", async () => {
    const c = createDirectConnector(conn, "pw");
    const res = await c.query("SELECT NO, QTY FROM T WHERE NO = :no", { no: "A" }, opts);
    const sqls = execute.mock.calls.map((x) => x[0]);
    expect(sqls).toEqual(["SET TRANSACTION READ ONLY", "SELECT NO, QTY FROM T WHERE NO = :no", "ROLLBACK"]);
    expect(execute.mock.calls[1][1]).toEqual({ no: "A" });
    expect(execute.mock.calls[1][2]).toMatchObject({ outFormat: 4002, maxRows: 3 });
    expect(typeof execute.mock.calls[1][2].fetchTypeHandler).toBe("function");
    expect(connection.callTimeout).toBe(5000);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ rows: [{ NO: "A", QTY: 3 }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }] });
  });
  it("fetchTypeHandler forces strings for NUMBER and CLOB and rejects unsupported types", async () => {
    const c = createDirectConnector(conn, "pw");
    await c.query("SELECT 1 FROM DUAL", {}, opts);
    const handler = execute.mock.calls[1][2].fetchTypeHandler as (m: { name: string; dbTypeName: string }) => unknown;
    expect(handler({ name: "QTY", dbTypeName: "NUMBER" })).toEqual({ type: 2001 });
    expect(handler({ name: "NOTE", dbTypeName: "CLOB" })).toEqual({ type: 2001 });
    expect(handler({ name: "DT", dbTypeName: "DATE" })).toBeUndefined();
    expect(() => handler({ name: "B", dbTypeName: "BLOB" })).toThrow(/지원하지 않는 컬럼 타입: B/);
  });
  it("rejects non-SELECT before touching the pool, maps TOO_MANY_ROWS, timeouts and driver errors, masks the password", async () => {
    const c = createDirectConnector(conn, "pw");
    await expect(c.query("DELETE FROM T", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    expect(pool.getConnection).not.toHaveBeenCalled();
    execute.mockImplementation(async (sql: string) => sql.startsWith("SELECT") ? { rows: [{ A: 1 }, { A: 2 }, { A: 3 }], metaData: [{ name: "A", dbTypeName: "NUMBER" }] } : {});
    await expect(c.query("SELECT A FROM T", {}, opts)).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
    execute.mockImplementation(async (sql: string) => { if (sql.startsWith("SELECT")) throw new Error("NJS-123: call timeout of 5000 ms exceeded"); return {}; });
    await expect(c.query("SELECT A FROM T", {}, opts)).rejects.toMatchObject({ code: "TIMEOUT" });
    execute.mockImplementation(async (sql: string) => { if (sql.startsWith("SELECT")) throw new Error("ORA-01017: invalid username/password; logon denied (pw)"); return {}; });
    const err = await c.query("SELECT A FROM T", {}, opts).catch((e) => e);
    expect(err.code).toBe("SQL_ERROR"); expect(err.message).not.toContain("(pw)"); expect(err.message).toContain("***");
    expect(connection.close).toHaveBeenCalled();   // 실패해도 반납
  });
  it("maps pool-creation failures too, masking the password", async () => {
    createPool.mockRejectedValueOnce(new Error("NJS-503: connect failed pw=pw"));
    const c = createDirectConnector(conn, "pw");
    const err = await c.query("SELECT 1 FROM DUAL", {}, opts).catch((e) => e);
    expect(err.code).toBe("SQL_ERROR");
    expect(err.message).toMatch(/^연결 실패: /);
    expect(err.message).not.toContain("pw=pw");
  });
  it("ping runs SELECT 1 FROM DUAL and close shuts the pool", async () => {
    const c = createDirectConnector(conn, "pw");
    await c.ping();
    expect(execute.mock.calls.some((x) => x[0] === "SELECT 1 FROM DUAL")).toBe(true);
    await c.close();
    expect(pool.close).toHaveBeenCalled();
    await c.query("SELECT 1 FROM DUAL", {}, opts);
    expect(createPool).toHaveBeenCalledTimes(2);   // 닫힌 뒤 다시 만든다
  });
});
