import type { SqlDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type Limits } from "./types";

const STRING_LITERAL_RE = /'(?:[^']|'')*'/g;
const BIND_RE = /(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g;   // ::cast는 제외

/** 쿼리의 :이름 중 params에 있는 값만 이름으로 넘긴다. 문자열 결합은 하지 않는다 */
export function extractBinds(sql: string, params: Record<string, unknown>): Record<string, unknown> {
  const binds: Record<string, unknown> = {};
  for (const m of sql.replace(STRING_LITERAL_RE, "''").matchAll(BIND_RE)) {
    const name = m[1];
    if (Object.hasOwn(params, name)) binds[name] = params[name];
  }
  return binds;
}

export async function runSql(ds: SqlDataset, params: Record<string, unknown>, connectors: Connectors, limits: Limits): Promise<Record<string, unknown>[]> {
  const conn = connectors.sql?.[ds.connection];
  if (!conn) throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  const res = await conn.query(ds.query, extractBinds(ds.query, params), { timeoutMs: limits.timeoutMs, maxRows: limits.maxRows, signal: AbortSignal.timeout(limits.timeoutMs) });
  return res.rows;
}
