import { rowsProxy, type Report, type DataContext } from "@daport/core";

export function resolveDataSync(report: Report): DataContext {
  const params: Record<string, unknown> = {};
  for (const p of report.params) params[p.name] = p.default ?? (p.type === "number" ? 0 : `{${p.name}}`);
  const ctx: DataContext = { params };
  for (const ds of report.datasets) ctx[ds.name] = ds.type === "static" ? rowsProxy(ds.rows) : rowsProxy([]);
  return ctx;
}
