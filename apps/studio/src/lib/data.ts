import { resolveParams, rowsProxy, FORBIDDEN_CONTEXT_KEYS, type Report, type DataContext } from "@daport/core";

/** 편집용 파라미터 값: 기본값, 없으면 숫자는 0, 그 밖은 `{이름}` */
export function sampleParams(report: Report): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of report.params) params[p.name] = p.default ?? (p.type === "number" ? 0 : `{${p.name}}`);
  return params;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const asRows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : isObject(v) ? [v] : []);
// sample.data의 이름도 데이터셋 이름과 같은 식별자 규칙을 따라야 한다 (프로토타입 오염 방지)
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 어떤 setter도 타지 않도록 own data property로만 컨텍스트에 심는다 */
const setContext = (ctx: DataContext, name: string, value: unknown) =>
  Object.defineProperty(ctx, name, { value, enumerable: true, writable: true, configurable: true });

/**
 * 캔버스가 그리는 컨텍스트 (스펙 7.4). sample.params를 자리표시 값 위에 얹고, sample.data가 있으면 그 행, 없으면 static 행,
 * 그 밖은 빈 배열. sample.data에만 있는 이름도 넣는다. 필수 파라미터가 비어도 캔버스는 그려야 하므로 검사하지 않는다
 */
export function sampleContext(report: Report): DataContext {
  const params = resolveParams(report, { ...sampleParams(report), ...report.sample?.params }, { checkRequired: false });
  const ctx: DataContext = { params };
  const data = report.sample?.data ?? {};
  for (const ds of report.datasets) ctx[ds.name] = rowsProxy(Object.hasOwn(data, ds.name) ? asRows(data[ds.name]) : ds.type === "static" ? ds.rows : []);
  for (const [name, v] of Object.entries(data)) {
    // Object.hasOwn (in이 아니라) — "toString"처럼 Object.prototype에 있는 식별자 이름도 own 여부만 본다 (Finding 6)
    if (Object.hasOwn(ctx, name)) continue;
    // __proto__/constructor/prototype과 식별자가 아닌 이름은 조용히 건너뛴다 (편집기 캔버스용이라 오류로 막지 않는다)
    if ((FORBIDDEN_CONTEXT_KEYS as readonly string[]).includes(name) || !IDENTIFIER_RE.test(name)) continue;
    setContext(ctx, name, rowsProxy(asRows(v)));
  }
  return ctx;
}

/** 미리보기·PDF 요청 본문 (스펙 7.5). 편집 중에는 sample.data를 보내 서버 데이터셋을 실행하지 않는다. 실데이터 토글이 켜지면 data를 빼고 보낸다 */
export function requestBody(report: Report, liveData: boolean): { report: Report; params: Record<string, unknown>; data?: Record<string, unknown> } {
  const body = { report, params: { ...sampleParams(report), ...report.sample?.params } };
  return liveData || !report.sample ? body : { ...body, data: report.sample.data };
}
