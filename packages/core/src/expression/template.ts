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
  const trimmed = template.trim();
  const segments = [...trimmed.matchAll(TEMPLATE_RE)];
  // 세그먼트가 정확히 하나이고 앞뒤 텍스트가 없을 때만 원래 타입. "{{ a }}/{{ b }}"는 보간 문자열
  if (segments.length === 1 && segments[0][0] === trimmed) return evaluate(segments[0][1], context);
  return hasTemplate(template) ? interpolate(template, context) : template;
}
