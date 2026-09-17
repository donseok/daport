import type { SqlDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type Limits } from "./types";

const Q_CLOSE: Record<string, string> = { "[": "]", "{": "}", "(": ")", "<": ">" };
const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$#]/.test(c);

/**
 * Oracle SQL에서 바인드 자리의 이름을 문서 순서대로 찾는다. 주석(--, /* *\/), 문자열('...', '' 이스케이프),
 * q-인용 문자열(q'[...]' 등), 큰따옴표 식별자 안은 건너뛴다. 닫히지 않은 주석·문자열은 끝까지 SQL이 아닌 것으로 본다.
 * `::`(캐스트)와 식별자 바로 뒤의 `:`는 바인드가 아니다
 */
export function bindNames(sql: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], next = sql[i + 1];
    if (c === "-" && next === "-") { const e = sql.indexOf("\n", i + 2); i = e < 0 ? n : e + 1; continue; }
    if (c === "/" && next === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    // q'X...X' 또는 국가 문자 nq'X...X'. 앞 글자가 식별자의 일부(seq' 등)면 q-인용이 아니다
    const nPrefix = (sql[i - 1] === "n" || sql[i - 1] === "N") && !isWord(sql[i - 2]);
    if ((c === "q" || c === "Q") && next === "'" && (!isWord(sql[i - 1]) || nPrefix) && i + 2 < n) {
      const open = sql[i + 2], close = Q_CLOSE[open] ?? open;
      const e = sql.indexOf(close + "'", i + 3);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        const e = sql.indexOf("'", j);
        if (e < 0) { j = n; break; }
        if (sql[e + 1] === "'") { j = e + 2; continue; }
        j = e + 1; break;
      }
      i = j;
      continue;
    }
    if (c === '"') { const e = sql.indexOf('"', i + 1); i = e < 0 ? n : e + 1; continue; }
    if (c === ":") {
      if (next === ":") { i += 2; continue; }
      if (!isWord(sql[i - 1]) && next !== undefined && /[A-Za-z_]/.test(next)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
        out.push(sql.slice(i + 1, j));
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** 쿼리의 바인드 이름 중 params에 있는 값만 이름으로 넘긴다. 문자열 결합은 하지 않는다 */
export function extractBinds(sql: string, params: Record<string, unknown>): Record<string, unknown> {
  const binds: Record<string, unknown> = {};
  for (const name of bindNames(sql)) if (Object.hasOwn(params, name)) binds[name] = params[name];
  return binds;
}

export async function runSql(ds: SqlDataset, params: Record<string, unknown>, connectors: Connectors, limits: Limits): Promise<Record<string, unknown>[]> {
  const conn = connectors.sql?.[ds.connection];
  if (!conn) throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  const res = await conn.query(ds.query, extractBinds(ds.query, params), { timeoutMs: limits.timeoutMs, maxRows: limits.maxRows, signal: AbortSignal.timeout(limits.timeoutMs) });
  return res.rows;
}
