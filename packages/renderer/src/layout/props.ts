import { evaluateTemplateValue, type DataContext } from "@daport/core";
import type { RefOwner } from "./flatten";

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
