import { rowsProxy, type Report, type DataContext } from "@daport/core";

/** 캔버스·미리보기·PDF가 함께 쓰는 편집용 파라미터 값: 기본값, 없으면 숫자는 0, 그 밖은 `{이름}` */
export function sampleParams(report: Report): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of report.params) params[p.name] = p.default ?? (p.type === "number" ? 0 : `{${p.name}}`);
  return params;
}

export function resolveDataSync(report: Report): DataContext {
  const ctx: DataContext = { params: sampleParams(report) };
  for (const ds of report.datasets) ctx[ds.name] = ds.type === "static" ? rowsProxy(ds.rows) : rowsProxy([]);
  return ctx;
}
