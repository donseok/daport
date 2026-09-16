import { interpolate, evaluate, evaluateTemplateValue, hasTemplate, ExpressionError, type Report, type DataContext, type Style } from "@daport/core";
import { flatten, type FlatElement } from "./flatten";
import { wrapText, lineHeightMm } from "../text/measure";
import type { Page, PlacedItem, PlacedText } from "./types";

function textItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, text: string): PlacedText {
  const inner = Math.max(0, el.w - el.style.padding * 2);
  const lines = el.style.wrap ? wrapText(text, el.style.fontSize, el.style.bold, inner) : text.split(/\r?\n/);
  const lh = lineHeightMm(el.style.fontSize, el.style.lineHeight);
  const overflow = lines.length * lh > el.h - el.style.padding * 2 + 1e-6;
  return { kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style, lines, lineHeight: lh, overflow };
}

/** visible 표현식: "{{ }}"가 있으면 템플릿 값, 없으면 맨 표현식으로 평가한다. 미지정·빈 문자열은 항상 표시 */
function isVisible(visible: string | undefined, ctx: DataContext): boolean {
  if (visible === undefined || visible.trim() === "") return true;
  return Boolean(hasTemplate(visible) ? evaluateTemplateValue(visible, ctx) : evaluate(visible, ctx));
}

function place(el: FlatElement, ctx: DataContext): PlacedItem | null {
  // 조상 그룹(바깥부터) → 요소 자신 순서의 AND. 그룹 visible 오류는 자손마다 각자의 #ERR 항목이 된다
  if (!el.ancestorsVisible.every((v) => isVisible(v, ctx)) || !isVisible(el.visible, ctx)) return null;
  const base = { elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style };
  switch (el.type) {
    case "text": return textItem(el, interpolate(el.value, ctx));
    case "pageNumber": return textItem(el, interpolate(el.format, ctx));
    case "image": return { ...base, kind: "image", src: interpolate(el.src, ctx), fit: el.fit };
    case "line": return { ...base, kind: "line", x2: el.x2, y2: el.y2 };
    case "rect": return { ...base, kind: "rect" };
    case "barcode": return { ...base, kind: "placeholder", label: `barcode:${el.format}` };
    case "table": return { ...base, kind: "placeholder", label: `table:${el.source}` };
    case "ref": return { ...base, kind: "placeholder", label: `ref:${el.ref}` };
  }
}

export function layout(report: Report, data: DataContext): Page[] {
  const ctx: DataContext = { ...data, page: 1, total: 1 };
  const items: PlacedItem[] = [];
  for (const el of flatten(report.elements)) {
    try {
      const item = place(el, ctx);
      if (item) items.push(item);
    } catch (e) {
      // 표현식 오류만 요소 단위로 격리한다. 렌더러 자체 오류는 모드와 무관하게 그대로 던진다
      if (!(e instanceof ExpressionError) || report.onExpressionError === "fail") throw e;
      const msg = e.message;
      items.push({ kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style,
        lines: ["#ERR"], lineHeight: lineHeightMm(el.style.fontSize, el.style.lineHeight), overflow: false, error: msg });
    }
  }
  return [{ index: 0, width: report.page.width, height: report.page.height, items }];
}
