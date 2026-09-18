import type { FieldType } from "@daport/core";
import { DatasetFailure } from "@daport/datasource";

export type OracleMeta = { name: string; dbTypeName?: string };

/** Oracle 컬럼 타입 → core FieldType. 지원하지 않는 타입은 null (4b 스펙 4.3) */
export function convertColumnType(dbTypeName: string): FieldType | null {
  const t = dbTypeName.toUpperCase();
  if (/^(N?VARCHAR2|N?CHAR|N?CLOB|LONG)$/.test(t)) return "string";
  if (/^(NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE)$/.test(t)) return "number";
  if (t === "DATE" || t.startsWith("TIMESTAMP")) return "date";
  if (t === "BOOLEAN") return "boolean";
  return null;
}
export const isTzType = (dbTypeName: string) => /TIME ZONE/i.test(dbTypeName);

/** DATE·TIMESTAMP는 시간대가 없어 드라이버가 프로세스 로컬 시간대로 Date를 만든다 → 벽시계 성분을 UTC로 읽는다. TZ 타입은 절대 시각이라 그대로 */
export function dateToIso(d: Date, hasTz: boolean): string {
  if (hasTz) return d.toISOString();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())).toISOString();
}

/** NUMBER는 문자열로 받아(정밀도 보존) 안전 범위면 number, 아니면 문자열 그대로 */
export function numberFromString(s: string): number | string {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (/^-?\d+$/.test(s)) return Number.isSafeInteger(n) ? n : s;
  const digits = s.replace(/[^0-9]/g, "").replace(/^0+/, "");
  return digits.length <= 15 ? n : s;   // 유효 숫자 15자리를 넘으면 double로 잃는다
}

export function convertRow(row: Record<string, unknown>, meta: OracleMeta[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of meta) {
    const v = row[m.name];
    const type = convertColumnType(m.dbTypeName ?? "");
    if (type === null) throw new DatasetFailure("SQL_ERROR", `지원하지 않는 컬럼 타입: ${m.name} (${m.dbTypeName ?? "?"})`);
    if (v === null || v === undefined) { out[m.name] = null; continue; }
    if (type === "date") out[m.name] = v instanceof Date ? dateToIso(v, isTzType(m.dbTypeName ?? "")) : String(v);
    else if (type === "number") out[m.name] = typeof v === "string" ? numberFromString(v) : typeof v === "number" && Number.isFinite(v) ? v : String(v);
    else out[m.name] = typeof v === "string" ? v : String(v);
  }
  return out;
}

export function sanitizeError(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out;
}

/** 드라이버·네트워크 오류 → DatasetFailure. DatasetFailure는 그대로 통과 */
export function mapOracleError(e: unknown, secrets: string[]): DatasetFailure {
  if (e instanceof DatasetFailure) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const message = sanitizeError(raw, secrets);
  const name = (e as { name?: string } | null)?.name;
  if (/NJS-123|ORA-01013/.test(raw) || name === "TimeoutError" || name === "AbortError") return new DatasetFailure("TIMEOUT", message);
  if (/ORA-12\d{3}|NJS-5\d{2}|ECONNREFUSED|ENOTFOUND/.test(raw)) return new DatasetFailure("SQL_ERROR", `연결 실패: ${message}`);
  return new DatasetFailure("SQL_ERROR", message);
}
