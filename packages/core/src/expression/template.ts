import { evaluate, type DataContext } from "./engine";

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export function hasTemplate(s: string): boolean { return /\{\{[\s\S]+?\}\}/.test(s); }

export function interpolate(template: string, context: DataContext): string {
  if (!hasTemplate(template)) return template;
  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const v = evaluate(expr, context);
    return v === null || v === undefined ? "" : String(v);
  });
}

/** 전체가 하나의 {{ }}이면 문자열화하지 않고 원래 타입을 돌려준다 (visible 조건 등에 사용) */
export function evaluateTemplateValue(template: string, context: DataContext): unknown {
  const m = template.trim().match(/^\{\{\s*([\s\S]+?)\s*\}\}$/);
  if (m) return evaluate(m[1], context);
  return hasTemplate(template) ? interpolate(template, context) : template;
}
