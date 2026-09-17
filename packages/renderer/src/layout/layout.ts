import { evaluateSource, ExpressionError, StyleSchema, type Report, type DataContext, type Style } from "@daport/core";
import { flatten, type FlatElement } from "./flatten";
import { placeStatic, isVisible, errorItem } from "./place";
import { LayoutLimitError, MAX_PAGES } from "./errors";
import type { Page, PlacedItem, PlacedText } from "./types";
import { lineHeightMm } from "../text/measure";
import { createMeasureCache } from "../text/cache";
import { paginate } from "../flow/paginate";
import { tableFlow } from "../flow/table";
import { repeaterFlow } from "../flow/repeater";
import { flowBoxItem, paintFlowPage, paintClipped } from "../flow/paint";
import type { FlowOptions, FlowPage, PageFlowContext, Region } from "../flow/types";

type FlowEl = Extract<FlatElement, { type: "table" | "repeater" }>;
/** 부(copy) 하나의 계획. flows는 흐름 요소 → 나눠진 페이지들 또는 #ERR 항목 */
type CopyPlan = { ctx: DataContext; flows: Map<FlatElement, FlowPage[] | PlacedItem>; nPages: number; extra: PlacedItem[] };

const DEFAULT_STYLE: Style = StyleSchema.parse({});
const isContinueFlow = (el: FlatElement): el is FlowEl => (el.type === "table" || el.type === "repeater") && el.overflow === "continue";

function flowVisible(flow: "once" | "every" | "last", p: number, n: number): boolean {
  return flow === "every" || (flow === "once" ? p === 0 : p === n - 1);
}

function regions(el: FlowEl, report: Report): { first: Region; next: Region } {
  const first = { x: el.x, y: el.y, w: el.w, h: el.h };
  return { first, next: { ...first, h: report.page.height - report.page.margin[2] - el.y } };
}

/** 여백 좌상단의 안내 항목 (#NODATA, repeat 소스 #ERR) */
function marginItem(report: Report, id: string, text: string, error?: string): PlacedText {
  const item: PlacedText = { kind: "text", elementId: id, x: report.page.margin[3], y: report.page.margin[0], w: 60, h: 8, style: DEFAULT_STYLE,
    lines: [text], lineHeight: lineHeightMm(DEFAULT_STYLE.fontSize, DEFAULT_STYLE.lineHeight), overflow: false };
  if (error) item.error = error;
  return item;
}

/** 요소와 조상 그룹의 visible. 오류는 blank 모드에서 #ERR 항목, fail 모드에서 던진다 */
function visibility(el: FlatElement, ctx: DataContext, mode: "blank" | "fail"): boolean | PlacedItem {
  try { return el.ancestorsVisible.every((v) => isVisible(v, ctx)) && isVisible(el.visible, ctx); }
  catch (e) { if (!(e instanceof ExpressionError) || mode === "fail") throw e; return errorItem(el, e.message); }
}

/** overflow "clip" 반복 영역: 첫 영역에 들어가는 조각까지만 */
function paintClippedRepeater(el: Extract<FlatElement, { type: "repeater" }>, ctx: DataContext, opts: FlowOptions, pageCtx: PageFlowContext): PlacedItem[] {
  let input: ReturnType<typeof repeaterFlow>;
  try { input = repeaterFlow(el, ctx, opts); }
  catch (e) { if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e; return [errorItem(el, e.message)]; }
  const region = { x: el.x, y: el.y, w: el.w, h: el.h };
  const [page] = paginate(input, { first: region, next: region, repeatHeader: false, clip: true });
  return [flowBoxItem(el, { clipped: page.truncated, overflow: page.overflow }), ...paintFlowPage(page, { x: el.x, y: el.y }, pageCtx)];
}

/**
 * 순수 레이아웃 (스펙 5.3).
 * 1단계: 부마다 흐름 요소(continue 표·반복 영역)를 paginate하고 부의 페이지 수 = max(요소별 페이지 수, 1)을 정한다.
 * 2단계: 전체 페이지 수(sheets)가 정해진 뒤 페이지마다 고정 요소(flow 규칙)와 흐름 조각을 칠한다.
 * 페이지 상한을 넘으면 LayoutLimitError. 표현식 오류 격리는 1단계 규칙(onExpressionError)과 같다
 */
export function layout(report: Report, data: DataContext, opts: { maxPages?: number } = {}): Page[] {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const mode = report.onExpressionError;
  const fopts: FlowOptions = { measure: createMeasureCache(), onExpressionError: mode };
  const flat = flatten(report.elements);

  // 부 목록: repeat 없으면 1부(record 없음), 0건이면 #NODATA 1부
  let records: unknown[] | undefined;
  let repeatError: PlacedItem | undefined;
  if (report.repeat) {
    try { records = evaluateSource(report.repeat.source, data); }
    catch (e) { if (!(e instanceof ExpressionError) || mode === "fail") throw e; repeatError = marginItem(report, "__repeat", "#ERR", e.message); }
  }
  const copies: { record?: unknown; nodata?: boolean }[] =
    records === undefined ? [{}] : records.length === 0 ? [{ nodata: true }] : records.map((record) => ({ record }));

  // 1단계: 흐름 요소를 나누고 부의 페이지 수를 정한다
  const plans: CopyPlan[] = [];
  let total = 0;
  copies.forEach((c, ci) => {
    const ctx: DataContext = report.repeat ? { ...data, [report.repeat.as]: c.record } : data;
    const flows = new Map<FlatElement, FlowPage[] | PlacedItem>();
    let nPages = 1;
    for (const el of flat) {
      if (!isContinueFlow(el)) continue;
      const vis = visibility(el, ctx, mode);
      if (vis === false) continue;
      if (vis !== true) { flows.set(el, vis); continue; }
      try {
        const input = el.type === "table" ? tableFlow(el, ctx, fopts) : repeaterFlow(el, ctx, fopts);
        const pages = paginate(input, { ...regions(el, report), repeatHeader: el.type === "table" ? el.repeatHeader : false, clip: false });
        if (total + pages.length > maxPages) throw new LayoutLimitError(total + pages.length, maxPages);
        flows.set(el, pages);
        nPages = Math.max(nPages, pages.length);
      } catch (e) {
        if (!(e instanceof ExpressionError) || mode === "fail") throw e;
        flows.set(el, errorItem(el, e.message));   // 소스 오류·배열 아님: 흐름 요소 전체를 #ERR 한 칸
      }
    }
    total += nPages;
    if (total > maxPages) throw new LayoutLimitError(total, maxPages);
    const extra: PlacedItem[] = [];
    if (c.nodata) extra.push(marginItem(report, "__nodata", "#NODATA"));
    if (repeatError && ci === 0) extra.push(repeatError);
    plans.push({ ctx, flows, nPages, extra });
  });

  // 2단계: sheets가 정해졌으니 칠한다
  const pages: Page[] = [];
  plans.forEach((plan, ci) => {
    for (let p = 0; p < plan.nPages; p++) {
      const pageCtx: PageFlowContext = { page: p + 1, total: plan.nPages, sheet: pages.length + 1, sheets: total, copy: ci + 1, copies: plans.length, pageRows: [] };
      const ctx: DataContext = { ...plan.ctx, ...pageCtx };
      const items: PlacedItem[] = p === 0 ? [...plan.extra] : [];
      for (const el of flat) {
        const flow = plan.flows.get(el);
        if (flow) {
          if (!Array.isArray(flow)) { if (p === 0) items.push(flow); continue; }   // #ERR 항목은 첫 페이지에만
          const fp = flow[p];
          if (!fp) continue;                                                       // 이 요소의 페이지가 더 짧으면 그 뒤 페이지에는 없다
          items.push(flowBoxItem(el, { overflow: fp.overflow }), ...paintFlowPage(fp, { x: el.x, y: el.y }, pageCtx));
          continue;
        }
        // isContinueFlow(el)를 그대로 쓰면 "el is FlowEl" 타입가드의 부정 분기에서 clip 표·반복 영역까지
        // 타입에서 제거돼(false여도 table/repeater일 수 있으므로) 아래 el.type 비교가 타입 오류가 된다. 조건만 그대로 풀어 쓴다
        if ((el.type === "table" || el.type === "repeater") && el.overflow === "continue") continue;   // 숨긴 흐름 요소
        if (!flowVisible(el.flow, p, plan.nPages)) continue;
        if (el.type === "table" || el.type === "repeater") {                       // clip: 고정 요소처럼 flow 규칙, 첫 영역만
          const vis = visibility(el, ctx, mode);
          if (vis === false) continue;
          if (vis !== true) { items.push(vis); continue; }
          items.push(...(el.type === "table" ? paintClipped(el, ctx, fopts, pageCtx) : paintClippedRepeater(el, ctx, fopts, pageCtx)));
          continue;
        }
        items.push(...placeStatic(el, ctx, { onExpressionError: mode }));
      }
      pages.push({ index: pages.length, width: report.page.width, height: report.page.height, items, copyIndex: ci, pageInCopy: p });
    }
  });
  return pages;
}
