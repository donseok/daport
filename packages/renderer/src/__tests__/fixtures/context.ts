import { resolveParams, rowsProxy, type Report, type DataContext } from "@daport/core";

/** studio의 sampleContext와 같은 규칙: sample.params, sample.data 우선, 없으면 static 행 */
export function fixtureContext(report: Report): DataContext {
  const ctx: DataContext = { params: resolveParams(report, report.sample?.params ?? {}, { checkRequired: false }) };
  const data = report.sample?.data ?? {};
  for (const ds of report.datasets) ctx[ds.name] = rowsProxy(((data[ds.name] as Record<string, unknown>[] | undefined) ?? (ds.type === "static" ? ds.rows : [])));
  return ctx;
}
