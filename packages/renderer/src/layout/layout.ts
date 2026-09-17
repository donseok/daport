import { evaluateSource, ExpressionError, StyleSchema, type Report, type DataContext, type Style } from "@daport/core";
import { flatten, type FlatElement, type RefOwner } from "./flatten";
import { placeStatic, isVisible, errorItem, refBoxItem, refErrorItem, ownedInstance, ownItems } from "./place";
import { withProps } from "./props";
import { LayoutLimitError, MAX_PAGES, RegionTooSmallError } from "./errors";
import type { Page, PlacedItem, PlacedText } from "./types";
import { lineHeightMm } from "../text/measure";
import { createMeasureCache } from "../text/cache";
import { paginate } from "../flow/paginate";
import { tableFlow } from "../flow/table";
import { repeaterFlow } from "../flow/repeater";
import { flowBoxItem, paintFlowPage, paintClipped } from "../flow/paint";
import type { FlowOptions, FlowPage, PageFlowContext, Region } from "../flow/types";

type FlowEl = Extract<FlatElement, { type: "table" | "repeater" }>;
/** 부(copy) 하나의 계획. flows는 흐름 요소 → 나눠진 페이지들 또는 #ERR 항목. propErr는 입력값 평가 오류로 #ERR가 된 인스턴스 흐름 요소 */
type CopyPlan = { ctx: DataContext; flows: Map<FlatElement, FlowPage[] | PlacedItem>; propErr: Set<FlatElement>; nPages: number; extra: PlacedItem[] };
type PropsCache = Map<string, Record<string, unknown>>;

const DEFAULT_STYLE: Style = StyleSchema.parse({});
const isContinueFlow = (el: FlatElement): el is FlowEl => (el.type === "table" || el.type === "repeater") && el.overflow === "continue";
/** 고정 요소가 나오는 페이지 규칙. 펼친 요소는 ref의 flow를 따른다(컴포넌트 내부 flow는 무시, 스펙 5.1) */
const flowOf = (el: FlatElement) => el.refFlow ?? el.flow;

function flowVisible(flow: "once" | "every" | "last", p: number, n: number): boolean {
  return flow === "every" || (flow === "once" ? p === 0 : p === n - 1);
}

/**
 * 인스턴스 요소의 흐름 옵션: 인스턴스 접두사 `<refId>/<path>/`와, 조각을 그릴 때 입력값을 그 페이지 값으로 다시 평가할 ref.
 * 캐시는 2단계(칠하기) 캐시다 — 조각은 1단계에서 만들지만 paint는 2단계에 페이지마다 불린다
 */
function ownedOpts(fopts: FlowOptions, owner: RefOwner | undefined, paintCache: PropsCache): FlowOptions {
  return owner ? { ...fopts, instancePrefix: `${ownedInstance(owner)}/`, ref: { owner, cache: paintCache } } : fopts;
}
/** 인스턴스 요소의 항목을 id 규칙으로 바꾼다. owner가 없으면 그대로 */
function own(items: PlacedItem[], el: FlatElement): PlacedItem[] {
  return el.owner ? ownItems(items, el.owner, el.id, ownedInstance(el.owner)) : items;
}

/**
 * 첫 영역은 템플릿 상자 그대로. 이어지는 페이지 영역은 원래 x·y·w를 유지하고 아랫단 B까지 쓴다.
 * B = min(하단 여백선, 템플릿 하단 아래에 있고 가로로 겹치는 every·last 고정 요소들의 윗변). 마지막 페이지를 미리 모르므로 last 자리도
 * 모든 이어지는 페이지에서 비운다. 다른 continue 흐름 요소는 넣지 않는다(겹침 허용, pushDown은 이후 단계).
 * 펼친 고정 요소의 flow는 ref의 flow다
 */
function regions(el: FlowEl, report: Report, flat: FlatElement[]): { first: Region; next: Region } {
  const first = { x: el.x, y: el.y, w: el.w, h: el.h };
  const EPS = 1e-6;
  let bottom = report.page.height - report.page.margin[2];
  for (const s of flat) {
    if (s === el || isContinueFlow(s) || flowOf(s) === "once") continue;
    const top = s.type === "line" ? Math.min(s.y, s.y2) : s.y;
    const left = s.type === "line" ? Math.min(s.x, s.x2) : s.x;
    const width = s.type === "line" ? Math.abs(s.x2 - s.x) : s.w;
    const overlaps = left < el.x + el.w - EPS && left + Math.max(width, EPS) > el.x + EPS;
    if (top >= el.y + el.h - EPS && overlaps) bottom = Math.min(bottom, top);
  }
  return { first, next: { ...first, h: bottom - el.y } };
}

/** 여백 좌상단의 안내 항목 (#NODATA, repeat 소스 #ERR) */
function marginItem(report: Report, id: string, text: string, error?: string): PlacedText {
  const item: PlacedText = { kind: "text", elementId: id, x: report.page.margin[3], y: report.page.margin[0], w: 60, h: 8, style: DEFAULT_STYLE,
    lines: [text], lineHeight: lineHeightMm(DEFAULT_STYLE.fontSize, DEFAULT_STYLE.lineHeight), overflow: false };
  if (error) item.error = error;
  return item;
}

/** 요소와 조상 그룹·ref의 visible. 오류는 blank 모드에서 #ERR 항목, fail 모드에서 던진다 */
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
 * 페이지 상한을 넘으면 LayoutLimitError. 표현식 오류 격리는 1단계 규칙(onExpressionError)과 같다.
 * 컴포넌트 인스턴스(3b 스펙 5장): report.components로 ref를 펼치고, 인스턴스 요소는 props 컨텍스트로 평가하며
 * 항목 elementId = ref id, instance = refId/path(+자기 경로), 인스턴스가 그려지는 페이지마다 refBox를 첫 항목으로 둔다
 */
export function layout(report: Report, data: DataContext, opts: { maxPages?: number } = {}): Page[] {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const mode = report.onExpressionError;
  const fopts: FlowOptions = { measure: createMeasureCache(), onExpressionError: mode, components: report.components };
  const flat = flatten(report.elements, 0, 0, [], { components: report.components });
  const paintCache: PropsCache = new Map();   // 2단계(칠하기) 입력값 캐시. 키에 페이지·부가 들어간다. 1단계에서 만든 조각의 paint도 이걸 쓴다

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
    const propErr = new Set<FlatElement>();
    const cache: PropsCache = new Map();   // 부마다: 이 단계의 컨텍스트에는 page·copy가 없어 키가 부를 가리지 못한다
    let nPages = 1;
    for (const el of flat) {
      if (!isContinueFlow(el)) continue;
      let ectx: DataContext;
      try { ectx = withProps(ctx, el.owner, cache); }
      catch (e) {
        if (!(e instanceof ExpressionError) || mode === "fail") throw e;
        flows.set(el, refErrorItem(el.owner!, e.message)); propErr.add(el); continue;   // 인스턴스 #ERR는 첫 페이지에 하나
      }
      const vis = visibility(el, ectx, mode);
      if (vis === false) continue;
      if (vis !== true) { flows.set(el, own([vis], el)[0]); continue; }
      try {
        const eopts = ownedOpts(fopts, el.owner, paintCache);
        const input = el.type === "table" ? tableFlow(el, ectx, eopts) : repeaterFlow(el, ectx, eopts);
        const pages = paginate(input, { ...regions(el, report, flat), repeatHeader: el.type === "table" ? el.repeatHeader : false, clip: false });
        if (total + pages.length > maxPages) throw new LayoutLimitError(total + pages.length, maxPages);
        flows.set(el, pages);
        nPages = Math.max(nPages, pages.length);
      } catch (e) {
        if (!(e instanceof ExpressionError || e instanceof RegionTooSmallError) || mode === "fail") throw e;
        flows.set(el, own([errorItem(el, e.message)], el)[0]);   // 소스 오류·배열 아님·영역 부족: 흐름 요소 전체를 #ERR 한 칸
      }
    }
    total += nPages;
    if (total > maxPages) throw new LayoutLimitError(total, maxPages);
    const extra: PlacedItem[] = [];
    if (c.nodata) extra.push(marginItem(report, "__nodata", "#NODATA"));
    if (repeatError && ci === 0) extra.push(repeatError);
    plans.push({ ctx, flows, propErr, nPages, extra });
  });

  // 2단계: sheets가 정해졌으니 칠한다
  const pages: Page[] = [];
  plans.forEach((plan, ci) => {
    for (let p = 0; p < plan.nPages; p++) {
      const pageCtx: PageFlowContext = { page: p + 1, total: plan.nPages, sheet: pages.length + 1, sheets: total, copy: ci + 1, copies: plans.length, pageRows: [] };
      const ctx: DataContext = { ...plan.ctx, ...pageCtx };
      const items: PlacedItem[] = p === 0 ? [...plan.extra] : [];
      const boxed = new Set<string>();    // 이 페이지에 refBox를 둔 인스턴스
      const broken = new Set<string>();   // 이 페이지에서 입력값 평가가 실패한 인스턴스 (#ERR 하나만)
      /** 인스턴스 요소를 이 페이지에 그리기 직전: 입력값 컨텍스트를 만들고 첫 번째면 refBox를 둔다. 실패면 null */
      const enter = (el: FlatElement): DataContext | null => {
        const owner = el.owner;
        if (!owner) return ctx;
        if (broken.has(owner.refId)) return null;
        let ectx: DataContext;
        try { ectx = withProps(ctx, owner, paintCache); }
        catch (e) {
          if (!(e instanceof ExpressionError) || mode === "fail") throw e;
          broken.add(owner.refId);
          if (!boxed.has(owner.refId)) items.push(refErrorItem(owner, e.message));
          return null;
        }
        if (!boxed.has(owner.refId)) { boxed.add(owner.refId); items.push(refBoxItem(owner)); }
        return ectx;
      };
      for (const el of flat) {
        const flow = plan.flows.get(el);
        if (flow) {
          if (!Array.isArray(flow)) {                                              // #ERR 항목은 첫 페이지에만
            if (p !== 0) continue;
            if (plan.propErr.has(el)) {
              const refId = el.owner!.refId;
              if (!broken.has(refId) && !boxed.has(refId)) items.push(flow);
              broken.add(refId);
              continue;
            }
            if (enter(el)) items.push(flow);
            continue;
          }
          const fp = flow[p];
          if (!fp) continue;                                                       // 이 요소의 페이지가 더 짧으면 그 뒤 페이지에는 없다
          if (!enter(el)) continue;
          items.push(...own([flowBoxItem(el, { overflow: fp.overflow }), ...paintFlowPage(fp, { x: el.x, y: el.y }, pageCtx)], el));
          continue;
        }
        // isContinueFlow(el)를 그대로 쓰면 "el is FlowEl" 타입가드의 부정 분기에서 clip 표·반복 영역까지
        // 타입에서 제거돼(false여도 table/repeater일 수 있으므로) 아래 el.type 비교가 타입 오류가 된다. 조건만 그대로 풀어 쓴다
        if ((el.type === "table" || el.type === "repeater") && el.overflow === "continue") continue;   // 숨긴 흐름 요소
        if (!flowVisible(flowOf(el), p, plan.nPages)) continue;
        const ectx = enter(el);
        if (!ectx) continue;
        if (el.type === "table" || el.type === "repeater") {                       // clip: 고정 요소처럼 flow 규칙, 첫 영역만
          const vis = visibility(el, ectx, mode);
          if (vis === false) continue;
          if (vis !== true) { items.push(...own([vis], el)); continue; }
          const eopts = ownedOpts(fopts, el.owner, paintCache);
          items.push(...own(el.type === "table" ? paintClipped(el, ectx, eopts, pageCtx) : paintClippedRepeater(el, ectx, eopts, pageCtx), el));
          continue;
        }
        items.push(...own(placeStatic(el, ectx, { onExpressionError: mode, instance: el.owner ? ownedInstance(el.owner) : undefined }), el));
      }
      pages.push({ index: pages.length, width: report.page.width, height: report.page.height, items, copyIndex: ci, pageInCopy: p });
    }
  });
  return pages;
}
