import type { DataContext, Element } from "@daport/core";
import { flatten } from "../layout/flatten";
import { placeStatic } from "../layout/place";
import type { PlacedItem } from "../layout/types";
import { paintClipped } from "./paint";
import type { FlowOptions, PageFlowContext } from "./types";

/**
 * 반복 영역 항목·그룹 밴드의 자식을 origin 기준 절대좌표로 그린다. 페이지 값은 컨텍스트에 합친다.
 * 스키마가 템플릿 안의 repeater와 continue 표를 막으므로 여기서 table은 항상 clip이다
 */
export function paintChildren(children: Element[], origin: { x: number; y: number }, ctx: DataContext,
  opts: FlowOptions & { instance: string; pageCtx: PageFlowContext }): PlacedItem[] {
  const full: DataContext = { ...ctx, ...opts.pageCtx };
  const items: PlacedItem[] = [];
  for (const el of flatten(children, origin.x, origin.y)) {
    if (el.type === "table") items.push(...paintClipped(el, full, opts, opts.pageCtx, opts.instance));
    else if (el.type === "repeater") continue;   // 스키마가 막는다. 방어적으로 건너뛴다
    else items.push(...placeStatic(el, full, { onExpressionError: opts.onExpressionError, instance: opts.instance }));
  }
  return items;
}
