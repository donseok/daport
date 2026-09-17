import { interpolate, evaluate, evaluateTemplateValue, hasTemplate, ExpressionError, type DataContext, type Style } from "@daport/core";
import type { FlatElement } from "./flatten";
import { wrapText, lineHeightMm } from "../text/measure";
import type { PlacedItem, PlacedText } from "./types";

type Box = { id: string; x: number; y: number; w: number; h: number; style: Style };

function textItem(el: Box, text: string, instance?: string): PlacedText {
  const inner = Math.max(0, el.w - el.style.padding * 2);
  const lines = el.style.wrap ? wrapText(text, el.style.fontSize, el.style.bold, inner) : text.split(/\r?\n/);
  const lh = lineHeightMm(el.style.fontSize, el.style.lineHeight);
  const overflow = lines.length * lh > el.h - el.style.padding * 2 + 1e-6;
  const item: PlacedText = { kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style, lines, lineHeight: lh, overflow };
  if (instance !== undefined) item.instance = instance;
  return item;
}

/** 표현식 오류를 그 요소 자리의 #ERR 텍스트로 바꾼다 */
export function errorItem(el: Box, message: string, instance?: string): PlacedText {
  const item: PlacedText = { kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style,
    lines: ["#ERR"], lineHeight: lineHeightMm(el.style.fontSize, el.style.lineHeight), overflow: false, error: message };
  if (instance !== undefined) item.instance = instance;
  return item;
}

/** visible 표현식: "{{ }}"가 있으면 템플릿 값, 없으면 맨 표현식으로 평가한다. 미지정·빈 문자열은 항상 표시 */
export function isVisible(visible: string | undefined, ctx: DataContext): boolean {
  if (visible === undefined || visible.trim() === "") return true;
  return Boolean(hasTemplate(visible) ? evaluateTemplateValue(visible, ctx) : evaluate(visible, ctx));
}

/**
 * 고정 요소 하나를 배치한다. 숨김이면 [], 표현식 오류는 blank 모드에서 #ERR 항목, fail 모드에서 던진다.
 * 흐름 요소(table·repeater)는 받지 않는다 — 호출자가 흐름으로 처리한다
 */
export function placeStatic(el: FlatElement, ctx: DataContext, opts: { onExpressionError: "blank" | "fail"; instance?: string }): PlacedItem[] {
  if (el.type === "table" || el.type === "repeater") throw new Error(`flow element ${el.id} cannot be placed statically`);
  try {
    // 조상 그룹(바깥부터) → 요소 자신 순서의 AND. 그룹 visible 오류는 자손마다 각자의 #ERR 항목이 된다
    if (!el.ancestorsVisible.every((v) => isVisible(v, ctx)) || !isVisible(el.visible, ctx)) return [];
    const base: PlacedItem = { kind: "rect", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style };
    if (opts.instance !== undefined) base.instance = opts.instance;
    switch (el.type) {
      case "text": return [textItem(el, interpolate(el.value, ctx), opts.instance)];
      case "pageNumber": return [textItem(el, interpolate(el.format, ctx), opts.instance)];
      case "image": return [{ ...base, kind: "image", src: interpolate(el.src, ctx), fit: el.fit }];
      case "line": return [{ ...base, kind: "line", x2: el.x2, y2: el.y2 }];
      case "rect": return [base];
      case "barcode": return [{ ...base, kind: "placeholder", label: `barcode:${el.format}` }];
      case "ref": return [{ ...base, kind: "placeholder", label: `ref:${el.ref}` }];
    }
  } catch (e) {
    // 표현식 오류만 요소 단위로 격리한다. 렌더러 자체 오류는 모드와 무관하게 그대로 던진다
    if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
    return [errorItem(el, e.message, opts.instance)];
  }
}
