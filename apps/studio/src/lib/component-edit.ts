import { parseReport, type ComponentBody, type ComponentProp, type Report } from "@daport/core";

/** 스토어 componentMode와 같은 모양 (store.ts를 import하면 lib가 React·zustand에 묶이므로 구조 타입으로 받는다) */
export type ComponentModeLike = { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> };

/** 스펙 7.5: 컴포넌트 상자 크기의 여백 없는 페이지, 데이터셋 없음. 요소는 복제한다 */
export function componentToEditReport(id: string, body: ComponentBody): Report {
  return parseReport({
    id: `component-${id}`, name: body.name, version: 1,
    page: { width: body.w, height: body.h, margin: [0, 0, 0, 0] },
    elements: structuredClone(body.elements),
  });
}

/** 편집용 레포트 → 저장할 내용. 이름·크기·요소는 레포트에서, 입력값 선언은 componentMode에서. 검증은 서버(ComponentBodySchema)가 한다 */
export function editReportToComponent(report: Report, props: ComponentProp[]): ComponentBody {
  return { name: report.name, w: report.page.width, h: report.page.height, props: structuredClone(props), elements: structuredClone(report.elements) };
}

/** 편집 화면을 열 때의 샘플 값: 선언마다 기본값 */
export function defaultSampleProps(props: ComponentProp[]): Record<string, unknown> {
  return Object.fromEntries(props.map((p) => [p.name, p.default]));
}

const fitsType = (p: ComponentProp, v: unknown) =>
  p.type === "number" ? typeof v === "number" && Number.isFinite(v) : p.type === "boolean" ? typeof v === "boolean" : typeof v === "string";

const contextMemo = new WeakMap<ComponentModeLike, Record<string, unknown>>();

/**
 * 캔버스·미리보기 컨텍스트의 props: 기본값 위에 타입이 맞는 샘플 값을 얹고, 선언에 없는 이름은 버린다 (렌더러 5.2와 같은 규칙).
 * 같은 componentMode 객체에는 같은 결과 객체를 돌려준다 — 캔버스 레이아웃 캐시가 참조로 비교한다
 */
export function samplePropsContext(mode: ComponentModeLike): Record<string, unknown> {
  let out = contextMemo.get(mode);
  if (!out) {
    out = {};
    for (const p of mode.props) out[p.name] = Object.hasOwn(mode.sampleProps, p.name) && fitsType(p, mode.sampleProps[p.name]) ? mode.sampleProps[p.name] : p.default;
    contextMemo.set(mode, out);
  }
  return out;
}
