import { describe, it, expect } from "vitest";
import { guardSql, maskSqlNoise, DatasetFailure } from "../sql-public";

describe("maskSqlNoise", () => {
  it("blanks comments, strings, q-quotes and quoted identifiers while keeping length", () => {
    const sql = `SELECT 'a;b' AS x, q'[for update]' AS y, "FOR UPDATE" AS z -- ; comment\n/* update */ FROM T`;
    const masked = maskSqlNoise(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked).not.toMatch(/a;b|for update|comment|update \*/i);
    expect(masked).toMatch(/SELECT\s+\s+AS x/);
  });
});

describe("guardSql", () => {
  it.each([
    "SELECT * FROM T WHERE NO = :no",
    "  \n-- 앞 주석\nselect 1 from dual",
    "WITH x AS (SELECT 1 FROM DUAL) SELECT * FROM x",
    "SELECT 'insert; for update' FROM DUAL",
    "SELECT q'[;]' FROM DUAL",
    "SELECT \"FOR UPDATE\" FROM T",
    "/* update t */ SELECT 1 FROM DUAL",
  ])("allows %s", (sql) => { expect(() => guardSql(sql)).not.toThrow(); });

  it.each([
    ["INSERT INTO T VALUES (1)", /SELECT/],
    ["UPDATE T SET A = 1", /SELECT/],
    ["DELETE FROM T", /SELECT/],
    ["MERGE INTO T USING D ON (1=1) WHEN MATCHED THEN UPDATE SET A = 1", /SELECT/],
    ["BEGIN NULL; END;", /SELECT/],
    ["DECLARE x NUMBER; BEGIN NULL; END;", /SELECT/],
    ["ALTER SESSION SET X = 1", /SELECT/],
    ["CREATE TABLE T (A NUMBER)", /SELECT/],
    ["DROP TABLE T", /SELECT/],
    ["SELECT 1 FROM DUAL; SELECT 2 FROM DUAL", /;/],
    ["SELECT 1 FROM DUAL;", /;/],
    ["SELECT * FROM T FOR UPDATE", /FOR UPDATE/i],
    ["SELECT * FROM T FOR\n  UPDATE NOWAIT", /FOR UPDATE/i],
    ["", /비어/],
    ["   -- only comment", /비어/],
  ])("rejects %s", (sql, why) => {
    expect(() => guardSql(sql)).toThrow(DatasetFailure);
    try { guardSql(sql); } catch (e) { expect((e as DatasetFailure).code).toBe("SQL_NOT_ALLOWED"); expect((e as Error).message).toMatch(why); }
  });
});
