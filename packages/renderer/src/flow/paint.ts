import { ExpressionError, StyleSchema, type DataContext, type Style, type TableElement } from "@daport/core";
import type { PlacedItem, PlacedRect } from "../layout/types";
import { errorItem } from "../layout/place";
import { paginate } from "./paginate";
import { tableFlow } from "./table";
import type { FlowOptions, FlowPage, PageFlowContext } from "./types";

const DEFAULT_STYLE: Style = StyleSchema.parse({});

/** 표·반복 영역 전체 영역의 선택·히트용 항목. 채움·선 없음 */
export function flowBoxItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, flags: { clipped?: boolean; overflow?: boolean; instance?: string }): PlacedRect {
  const item: PlacedRect = { kind: "rect", elementId: el.id, role: "flowBox", x: el.x, y: el.y, w: el.w, h: el.h, style: { ...DEFAULT_STYLE, fill: undefined, stroke: undefined } };
  if (flags.clipped) item.clipped = true;
  if (flags.overflow) item.overflow = true;
  if (flags.instance !== undefined) item.instance = flags.instance;
  return item;
}

/** 나눠진 한 페이지의 조각들을 origin(영역 좌상단 절대좌표) 기준으로 칠한다 */
export function paintFlowPage(page: FlowPage, origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[] {
  const ctx = { ...pageCtx, pageRows: page.pageRows };
  return page.placements.flatMap((pl) => pl.block.paint({ x: origin.x, y: origin.y + pl.y }, ctx));
}

/** overflow "clip" 표: 첫 영역에 들어가는 조각까지만 그린다. 소스 오류는 #ERR 한 칸 */
export function paintClipped(el: TableElement, ctx: DataContext, opts: FlowOptions, pageCtx: PageFlowContext, instance?: string): PlacedItem[] {
  let input: ReturnType<typeof tableFlow>;
  try {
    input = tableFlow(el, ctx, { ...opts, instancePrefix: instance !== undefined ? `${instance}/` : opts.instancePrefix });
  } catch (e) {
    if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
    return [errorItem(el, e.message, instance)];
  }
  const region = { x: el.x, y: el.y, w: el.w, h: el.h };
  const [page] = paginate(input, { first: region, next: region, repeatHeader: el.repeatHeader, clip: true });
  return [flowBoxItem(el, { clipped: page.truncated, overflow: page.overflow, instance }), ...paintFlowPage(page, { x: el.x, y: el.y }, pageCtx)];
}
