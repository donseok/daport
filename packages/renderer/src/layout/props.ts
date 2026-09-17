import { evaluateTemplateValue, usesPageVars, ExpressionError, type DataContext } from "@daport/core";
import type { RefOwner } from "./flatten";

/** 인스턴스 흐름 요소(컴포넌트 안 넘기는 표·반복 영역)가 그리는 시점에 입력값을 다시 평가하는 데 쓰는 것 */
export type RefPaint = { owner: RefOwner; cache: Map<string, Record<string, unknown>> };

/**
 * 인스턴스 입력값 (스펙 5.2): 선언 기본값 위에 인스턴스 값을 덮는다. 문자열 값은 템플릿으로 평가하고(값 전체가 {{ }} 하나면 원래 타입),
 * 선언에 없는 이름은 버린다. ExpressionError는 그대로 던진다(호출자가 인스턴스 #ERR로 바꾼다)
 */
export function resolveRefProps(owner: RefOwner, ctx: DataContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of owner.decls) {
    const v = Object.prototype.hasOwnProperty.call(owner.values, d.name) ? owner.values[d.name] : undefined;
    out[d.name] = v === undefined ? d.default : typeof v === "string" ? evaluateTemplateValue(v, ctx) : v;
  }
  return out;
}

/**
 * owner가 있으면 ctx에 props를 더한 새 컨텍스트. 같은 인스턴스는 페이지·부마다 한 번만 평가한다(키 `${refId}|${page}|${copy}`).
 * 캐시는 호출자가 범위를 정한다: layout 2단계는 layout 호출 하나, 1단계(조각 생성)는 부마다, 반복 영역 자식은 항목 칠하기마다 새로 만든다
 */
export function withProps(ctx: DataContext, owner: RefOwner | undefined, cache: Map<string, Record<string, unknown>>): DataContext {
  if (!owner) return ctx;
  const key = `${owner.refId}|${String(ctx.page)}|${String(ctx.copy)}`;
  let props = cache.get(key);
  if (!props) { props = resolveRefProps(owner, ctx); cache.set(key, props); }
  return { ...ctx, props };
}

/** 인스턴스 입력값이 페이지 값을 쓰는가. 쓰면 그리는 시점마다 다시 평가해야 한다 */
export function refPropsUsePageVars(ref: RefPaint | undefined): boolean {
  return ref !== undefined && ref.owner.decls.some((d) => {
    const v = ref.owner.values[d.name];
    return typeof v === "string" && usesPageVars(v);
  });
}

/**
 * 조각을 그리는 시점의 인스턴스 컨텍스트 (3b 스펙 5.2): 조각 높이는 만들 때 값으로 굳고, 칠할 때는 그 페이지의 실제 값으로
 * 입력값을 다시 평가한다. 캐시 키에 페이지·부가 들어가므로 페이지마다 한 번만 평가한다.
 * ctx에는 이미 PageFlowContext가 합쳐져 있어야 한다. blank 모드에서 재평가가 실패하면 만들 때 값을 그대로 쓴다
 */
export function repaintProps(ctx: DataContext, ref: RefPaint | undefined, mode: "blank" | "fail"): DataContext {
  if (!ref) return ctx;
  try { return withProps(ctx, ref.owner, ref.cache); }
  catch (e) { if (!(e instanceof ExpressionError) || mode === "fail") throw e; return ctx; }
}
