import type { Report } from "../schema/report";
import type { DataContext } from "../expression/engine";

export type Params = Record<string, unknown>;

/** 행 배열에 첫 행의 필드를 얹어 `ds.FIELD`와 `ds[0].FIELD` 둘 다 되게 한다 */
export function rowsProxy(rows: Record<string, unknown>[]): unknown {
  const arr = rows.slice();
  const first = rows[0] ?? {};
  for (const k of Object.keys(first)) {
    if (!(k in arr)) Object.defineProperty(arr, k, { value: first[k], enumerable: false });
  }
  return arr;
}

/**
 * 넘긴 값, 없으면 기본값으로 파라미터를 정하고 number 파라미터는 숫자로 바꾼다. 미리보기·PDF(resolveData)와
 * 캔버스가 같은 값을 쓰도록 동기로 둔다. 캔버스는 필수 값이 비어도 그려야 하므로 checkRequired를 끌 수 있다
 */
export function resolveParams(report: Report, params: Params, { checkRequired = true }: { checkRequired?: boolean } = {}): Params {
  const resolvedParams: Params = {};
  for (const p of report.params) {
    const v = params[p.name] ?? p.default;
    if (checkRequired && p.required && (v === undefined || v === null || v === "")) throw new Error(`missing required param: ${p.name}`);
    resolvedParams[p.name] = p.type === "number" && v !== undefined ? Number(v) : v;
  }
  return resolvedParams;
}

export async function resolveData(report: Report, params: Params): Promise<DataContext> {
  const ctx: DataContext = { params: resolveParams(report, params) };
  for (const ds of report.datasets) {
    if (ds.type !== "static") throw new Error(`dataset type "${ds.type}" is not supported in this phase`);
    ctx[ds.name] = rowsProxy(ds.rows);
  }
  return ctx;
}
