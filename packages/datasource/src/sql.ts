import type { SqlDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type Limits, type SqlColumn } from "./types";
import { maskSqlNoise } from "./sql-lexer";

const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$#]/.test(c);

/** 바인드 자리의 이름을 문서 순서대로. 노이즈는 maskSqlNoise가 지웠으므로 `::`(캐스트)와 식별자 바로 뒤의 `:`만 거른다 */
export function bindNames(sql: string): string[] {
  const s = maskSqlNoise(sql);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ":") continue;
    if (s[i + 1] === ":") { i++; continue; }
    if (isWord(s[i - 1]) || s[i + 1] === undefined || !/[A-Za-z_]/.test(s[i + 1])) continue;
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
    out.push(s.slice(i + 1, j));
    i = j - 1;
  }
  return out;
}

/** 쿼리의 바인드 이름 중 params에 있는 값만 이름으로 넘긴다. 문자열 결합은 하지 않는다 */
export function extractBinds(sql: string, params: Record<string, unknown>): Record<string, unknown> {
  const binds: Record<string, unknown> = {};
  for (const name of bindNames(sql)) if (Object.hasOwn(params, name)) binds[name] = params[name];
  return binds;
}

export async function runSql(ds: SqlDataset, params: Record<string, unknown>, connectors: Connectors, limits: Limits): Promise<{ rows: Record<string, unknown>[]; columns: SqlColumn[] }> {
  const conn = connectors.sql?.[ds.connection];
  if (!conn) throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  const res = await conn.query(ds.query, extractBinds(ds.query, params), { timeoutMs: limits.timeoutMs, maxRows: limits.maxRows, signal: AbortSignal.timeout(limits.timeoutMs) });
  return { rows: res.rows, columns: res.columns };
}
