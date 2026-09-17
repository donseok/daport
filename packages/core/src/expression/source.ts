import { evaluate, ExpressionError, type DataContext } from "./engine";

/** 소스 표현식(table.source, repeater.source, repeat.source)을 평가해 배열로 돌려준다. null·undefined → []. 배열이 아니면 오류 */
export function evaluateSource(expr: string, ctx: DataContext): unknown[] {
  const v = evaluate(expr, ctx);
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new ExpressionError(expr, "source is not an array");
  return v;
}

/** 페이지 조립 시점에만 정해지는 변수. 이를 참조하지 않는 셀·항목은 조각 생성 시 값을 캐시할 수 있다 */
export const PAGE_VARS_RE = /\b(page|total|sheet|sheets|copy|copies|pageRows)\b/;
export function usesPageVars(template: string): boolean { return PAGE_VARS_RE.test(template); }
