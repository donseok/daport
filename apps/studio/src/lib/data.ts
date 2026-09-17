import { resolveParams, rowsProxy, type Report, type DataContext } from "@daport/core";

/** 편집용 파라미터 값: 기본값, 없으면 숫자는 0, 그 밖은 `{이름}` */
export function sampleParams(report: Report): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of report.params) params[p.name] = p.default ?? (p.type === "number" ? 0 : `{${p.name}}`);
  return params;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const asRows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : isObject(v) ? [v] : []);

/**
 * 캔버스가 그리는 컨텍스트 (스펙 7.4). sample.params를 자리표시 값 위에 얹고, sample.data가 있으면 그 행, 없으면 static 행,
 * 그 밖은 빈 배열. sample.data에만 있는 이름도 넣는다. 필수 파라미터가 비어도 캔버스는 그려야 하므로 검사하지 않는다
 */
export function sampleContext(report: Report): DataContext {
  const params = resolveParams(report, { ...sampleParams(report), ...report.sample?.params }, { checkRequired: false });
  const ctx: DataContext = { params };
  const data = report.sample?.data ?? {};
  for (const ds of report.datasets) ctx[ds.name] = rowsProxy(Object.hasOwn(data, ds.name) ? asRows(data[ds.name]) : ds.type === "static" ? ds.rows : []);
  for (const [name, v] of Object.entries(data)) if (!(name in ctx)) ctx[name] = rowsProxy(asRows(v));
  return ctx;
}

/** 미리보기·PDF 요청 본문 (스펙 7.5). 편집 중에는 sample.data를 보내 서버 데이터셋을 실행하지 않는다. 실데이터 토글이 켜지면 data를 빼고 보낸다 */
export function requestBody(report: Report, liveData: boolean): { report: Report; params: Record<string, unknown>; data?: Record<string, unknown> } {
  const body = { report, params: { ...sampleParams(report), ...report.sample?.params } };
  return liveData || !report.sample ? body : { ...body, data: report.sample.data };
}
