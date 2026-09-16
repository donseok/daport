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

export async function resolveData(report: Report, params: Params): Promise<DataContext> {
  const resolvedParams: Params = {};
  for (const p of report.params) {
    const v = params[p.name] ?? p.default;
    if (p.required && (v === undefined || v === null || v === "")) throw new Error(`missing required param: ${p.name}`);
    resolvedParams[p.name] = p.type === "number" && v !== undefined ? Number(v) : v;
  }
  const ctx: DataContext = { params: resolvedParams };
  for (const ds of report.datasets) {
    if (ds.type !== "static") throw new Error(`dataset type "${ds.type}" is not supported in this phase`);
    ctx[ds.name] = rowsProxy(ds.rows);
  }
  return ctx;
}
