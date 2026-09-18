/// <reference path="./oracledb.d.ts" /> 소비자 tsconfig의 include와 무관하게 앰비언트 선언을 끌어들인다
import oracledb from "oracledb";
import { guardSql, DatasetFailure, type DirectConnection, type SqlColumn } from "@daport/datasource";
import { convertColumnType, convertRow, mapOracleError, type OracleMeta } from "./convert";
import { poolFor, closeConnector } from "./pool";
import type { ManagedConnector } from "./index";

/** NUMBER·CLOB은 문자열로 받아 정밀도를 지키고, 지원하지 않는 타입은 메타데이터 단계에서 거른다 */
function fetchTypeHandler(meta: { name: string; dbTypeName?: string }): { type: number } | undefined {
  const t = (meta.dbTypeName ?? "").toUpperCase();
  if (convertColumnType(t) === null) throw new DatasetFailure("SQL_ERROR", `지원하지 않는 컬럼 타입: ${meta.name} (${meta.dbTypeName ?? "?"})`);
  if (/^(NUMBER|FLOAT|N?CLOB|LONG)$/.test(t)) return { type: oracledb.STRING };
  return undefined;
}

export function createDirectConnector(conn: DirectConnection, password: string): ManagedConnector {
  const run = async <T>(timeoutMs: number, fn: (c: oracledb.Connection) => Promise<T>): Promise<T> => {
    let c: oracledb.Connection | undefined;
    try {
      const pool = await poolFor(conn, password);
      c = await pool.getConnection();
      c.callTimeout = timeoutMs;
      return await fn(c);
    } catch (e) {
      throw mapOracleError(e, [password]);
    } finally {
      if (c) {
        try { await c.execute("ROLLBACK"); } catch { /* 읽기 전용 트랜잭션 정리 실패는 무시 */ }
        await c.close().catch(() => {});
      }
    }
  };
  return {
    async query(sql, binds, opts) {
      guardSql(sql);   // 풀을 만지기 전에
      return run(opts.timeoutMs, async (c) => {
        await c.execute("SET TRANSACTION READ ONLY");
        const res = await c.execute<Record<string, unknown>>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: opts.maxRows + 1, fetchTypeHandler });
        const rows = res.rows ?? [];
        if (rows.length > opts.maxRows) throw new DatasetFailure("TOO_MANY_ROWS", `${opts.maxRows}행을 넘었습니다`);
        const meta: OracleMeta[] = (res.metaData ?? []).map((m) => ({ name: m.name, dbTypeName: m.dbTypeName }));
        const columns: SqlColumn[] = meta.map((m) => ({ name: m.name, type: convertColumnType(m.dbTypeName ?? "") ?? "string" }));
        return { rows: rows.map((r) => convertRow(r, meta)), columns };
      });
    },
    async ping() { await run(5_000, async (c) => { await c.execute("SELECT 1 FROM DUAL"); }); },
    async close() { await closeConnector(conn.name); },
  };
}
