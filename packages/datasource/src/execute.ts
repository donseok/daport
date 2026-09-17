import { resolveParams, rowsProxy, type Report, type DataContext, type Dataset } from "@daport/core";
import { DatasetFailure, DEFAULT_LIMITS, type Connectors, type DatasetError, type Limits, type SecretResolver } from "./types";

export type ExecuteOptions = {
  params: Record<string, unknown>;
  data?: Record<string, unknown>;        // 요청에 함께 온 데이터. 있으면 데이터셋 정의보다 우선
  connectors: Connectors;
  secrets: SecretResolver;
  limits?: Partial<Limits>;
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

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

/** 데이터셋 정의 하나를 실행한다. http·sql은 T12·T9가 채운다 */
async function runDataset(ds: Dataset, params: Record<string, unknown>, opts: ExecuteOptions, limits: Limits): Promise<Record<string, unknown>[]> {
  switch (ds.type) {
    case "static": return ds.rows;
    case "http": throw new DatasetFailure("HOST_NOT_ALLOWED", "http connector not configured");
    case "sql": throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  }
}

/** 실패 → errors 항목. 비밀값 마스킹은 T12가 http 분기에 더한다 */
function toError(dataset: string, e: unknown, fallback: DatasetError["code"]): DatasetError {
  if (e instanceof DatasetFailure) return { dataset, code: e.code, message: e.message };
  return { dataset, code: fallback, message: e instanceof Error ? e.message : String(e) };
}

/**
 * 파라미터를 정규화하고 데이터셋마다 컨텍스트 값을 만든다 (스펙 6.1).
 * 필수 파라미터 누락은 던진다(요청 오류). 데이터셋 실패는 errors에 모으고 나머지는 계속한다
 */
export async function executeDatasets(report: Report, opts: ExecuteOptions): Promise<{ context: DataContext; errors: DatasetError[] }> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const params = resolveParams(report, opts.params);
  const context: DataContext = { params };
  const errors: DatasetError[] = [];
  const data = opts.data ?? {};
  for (const ds of report.datasets) {
    try {
      const rows = Object.hasOwn(data, ds.name) ? toRows(data[ds.name]) : await runDataset(ds, params, opts, limits);
      context[ds.name] = rowsProxy(checkRows(rows, limits));
    } catch (e) {
      errors.push(toError(ds.name, e, ds.type === "sql" ? "SQL_ERROR" : "BAD_DATA"));
    }
  }
  for (const [name, value] of Object.entries(data)) {
    if (report.datasets.some((ds) => ds.name === name)) continue;
    try { context[name] = rowsProxy(checkRows(toRows(value), limits)); }
    catch (e) { errors.push(toError(name, e, "BAD_DATA")); }
  }
  return { context, errors };
}
