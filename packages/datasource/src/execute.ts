import { resolveParams, rowsProxy, RESERVED_CONTEXT_NAMES, FORBIDDEN_CONTEXT_KEYS, type Report, type DataContext, type Dataset } from "@daport/core";
import { DatasetFailure, DEFAULT_LIMITS, type Connectors, type DatasetError, type Limits, type SecretResolver, type SqlColumn } from "./types";
import { runSql } from "./sql";
import { runHttp } from "./http";

export type ExecuteOptions = {
  params: Record<string, unknown>;
  data?: Record<string, unknown>;        // 요청에 함께 온 데이터. 있으면 데이터셋 정의보다 우선
  connectors: Connectors;
  secrets: SecretResolver;
  limits?: Partial<Limits>;
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
// 요청 data의 이름은 식별자여야 한다 (스키마의 데이터셋 이름 규칙과 같다)
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 어떤 setter도 타지 않도록 own data property로만 컨텍스트에 심는다 (프로토타입 오염 방지) */
const setContext = (context: DataContext, name: string, value: unknown) =>
  Object.defineProperty(context, name, { value, enumerable: true, writable: true, configurable: true });

/** 객체 → [객체], 객체 배열 → 그대로. 그 밖은 BAD_DATA (rowsProxy는 객체 행을 전제한다) */
export function toRows(value: unknown): Record<string, unknown>[] {
  if (isObject(value)) return [value];
  if (Array.isArray(value) && value.every(isObject)) return value;
  throw new DatasetFailure("BAD_DATA", "rows must be an object or an array of objects");
}

function checkRows(rows: Record<string, unknown>[], limits: Limits): Record<string, unknown>[] {
  if (rows.length > limits.maxRows) throw new DatasetFailure("TOO_MANY_ROWS", `${rows.length} rows, more than the limit of ${limits.maxRows}`);
  return rows;
}

/** 데이터셋 정의 하나를 실행한다. sql만 컬럼 정보를 함께 돌려준다 */
async function runDataset(ds: Dataset, params: Record<string, unknown>, opts: ExecuteOptions, limits: Limits): Promise<{ rows: Record<string, unknown>[]; columns?: SqlColumn[] }> {
  switch (ds.type) {
    case "static": return { rows: ds.rows };
    case "http": return { rows: await runHttp(ds, params, opts.connectors, opts.secrets, limits) };
    case "sql": return runSql(ds, params, opts.connectors, limits);
  }
}

/** 실패 → errors 항목. http는 runHttp가 비밀값을 이미 마스킹한 메시지를 던진다 */
function toError(dataset: string, e: unknown, fallback: DatasetError["code"]): DatasetError {
  if (e instanceof DatasetFailure) return { dataset, code: e.code, message: e.message };
  return { dataset, code: fallback, message: e instanceof Error ? e.message : String(e) };
}

/**
 * 파라미터를 정규화하고 데이터셋마다 컨텍스트 값을 만든다 (스펙 6.1).
 * 필수 파라미터 누락은 던진다(요청 오류). 데이터셋 실패는 errors에 모으고 나머지는 계속한다
 */
export async function executeDatasets(report: Report, opts: ExecuteOptions): Promise<{ context: DataContext; errors: DatasetError[]; columns: Record<string, SqlColumn[]> }> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const params = resolveParams(report, opts.params);
  const context: DataContext = { params };
  const errors: DatasetError[] = [];
  const columns: Record<string, SqlColumn[]> = {};
  const data = opts.data ?? {};
  for (const ds of report.datasets) {
    try {
      if (Object.hasOwn(data, ds.name)) {
        context[ds.name] = rowsProxy(checkRows(toRows(data[ds.name]), limits));
        continue;
      }
      const { rows, columns: cols } = await runDataset(ds, params, opts, limits);
      context[ds.name] = rowsProxy(checkRows(rows, limits));
      if (cols) columns[ds.name] = cols;
    } catch (e) {
      errors.push(toError(ds.name, e, ds.type === "sql" ? "SQL_ERROR" : "BAD_DATA"));
    }
  }
  for (const [name, value] of Object.entries(data)) {
    if (report.datasets.some((ds) => ds.name === name)) continue;
    // 예약어·프로토타입 오염 키는 거부 — 요청에서 컨텍스트 변수 덮어쓰기·프로토타입 변경 방지
    if (RESERVED_CONTEXT_NAMES.includes(name) || (FORBIDDEN_CONTEXT_KEYS as readonly string[]).includes(name)) {
      errors.push({ dataset: name, code: "BAD_DATA", message: `reserved name: ${name}` });
      continue;
    }
    if (!IDENTIFIER_RE.test(name)) {
      errors.push({ dataset: name, code: "BAD_DATA", message: `invalid name: ${name}` });
      continue;
    }
    try { setContext(context, name, rowsProxy(checkRows(toRows(value), limits))); }
    catch (e) { errors.push(toError(name, e, "BAD_DATA")); }
  }
  return { context, errors, columns };
}
