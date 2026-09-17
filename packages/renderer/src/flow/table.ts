import { interpolate, evaluate, evaluateSource, usesPageVars, mergeStyle, StyleSchema, ExpressionError,
  type DataContext, type Style, type TableElement, type TableCell } from "@daport/core";
import { lineHeightMm } from "../text/measure";
import type { PlacedItem, PlacedLine, PlacedRect, PlacedText } from "../layout/types";
import type { Block, BlockKind, FlowInput, FlowOptions } from "./types";
import { computeGroupRuns, runsByRow, groupContext, type GroupRun } from "./groups";

/** 한 조각(행)의 셀. x는 표 왼쪽 기준, value는 템플릿 원문 */
type Cell = { x: number; w: number; value: string; style: Style };
type Measured = { lines: string[]; error?: string };

const DEFAULT_STYLE = StyleSchema.parse({});

export function tableWidth(el: TableElement): number { return el.columns.reduce((a, c) => a + c.w, 0); }

function columnOffsets(el: TableElement): number[] {
  const xs: number[] = []; let x = 0;
  for (const c of el.columns) { xs.push(x); x += c.w; }
  return xs;
}

/** 열 하나에 셀 하나인 행(머리행·데이터 행). 정렬은 열 align, 없으면 열 style.align */
function columnCells(el: TableElement, kind: "header" | "row"): Cell[] {
  const xs = columnOffsets(el);
  return el.columns.map((c, i) => ({
    x: xs[i], w: c.w, value: kind === "header" ? c.header : c.value,
    style: mergeStyle(c.style, kind === "header" ? el.headerStyle : undefined, c.align ? { align: c.align } : undefined),
  }));
}

/** span이 있는 셀 배열(그룹 머리·소계·페이지 소계·합계). span 합이 열 수보다 적으면 남은 열은 빈 셀. 넘치는 셀은 버린다 */
function spanCells(el: TableElement, cells: TableCell[]): Cell[] {
  const xs = columnOffsets(el);
  const out: Cell[] = [];
  let c = 0;
  for (const cell of cells) {
    if (c >= el.columns.length) break;
    const span = cell.span === "all" ? el.columns.length - c : Math.min(cell.span, el.columns.length - c);
    const col = el.columns[c];
    const align = cell.align ?? col.align;
    out.push({ x: xs[c], w: el.columns.slice(c, c + span).reduce((a, k) => a + k.w, 0), value: cell.value,
      style: mergeStyle(col.style, cell.style, align ? { align } : undefined) });
    c += span;
  }
  for (; c < el.columns.length; c++) out.push({ x: xs[c], w: el.columns[c].w, value: "", style: el.columns[c].style });
  return out;
}

function measureCell(cell: Cell, ctx: DataContext, opts: FlowOptions): Measured {
  let text: string;
  try {
    text = interpolate(cell.value, ctx);
  } catch (e) {
    if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
    return { lines: ["#ERR"], error: e.message };
  }
  const inner = Math.max(0, cell.w - cell.style.padding * 2);
  return { lines: cell.style.wrap ? opts.measure.wrap(text, cell.style.fontSize, cell.style.bold, inner) : text.split(/\r?\n/) };
}

const borderStyle = (el: TableElement): Style => ({ ...DEFAULT_STYLE, stroke: el.borderStyle.stroke, strokeWidth: el.borderStyle.strokeWidth });

/**
 * 셀 행 하나를 조각으로 만든다. 높이 = max(minHeight, 셀별 줄 수 × 줄 높이 + padding × 2)로 생성 시 확정한다.
 * 페이지 의존 변수를 쓰지 않는 셀은 여기서 잰 줄을 paint에서 그대로 쓴다(스펙 R6)
 */
function makeBlock(el: TableElement, kind: BlockKind, cells: Cell[], ctx: DataContext, minHeight: number, keepWithNext: boolean,
  rows: unknown[], opts: FlowOptions, instance: string): Block {
  const measured = cells.map((c) => measureCell(c, ctx, opts));
  const dynamic = cells.map((c) => usesPageVars(c.value));
  let height = minHeight;
  cells.forEach((c, i) => { height = Math.max(height, measured[i].lines.length * lineHeightMm(c.style.fontSize, c.style.lineHeight) + c.style.padding * 2); });
  const width = tableWidth(el);
  const bstyle = borderStyle(el);
  return {
    kind, height, keepWithNext, rows,
    paint(origin, pageCtx) {
      const items: PlacedItem[] = [];
      const pctx = dynamic.some(Boolean) ? { ...ctx, ...pageCtx } : null;
      cells.forEach((c, i) => {
        const m = pctx && dynamic[i] ? measureCell(c, pctx, opts) : measured[i];
        const x = origin.x + c.x, y = origin.y;
        if (el.border === "all") items.push({ kind: "rect", elementId: el.id, role: "border", instance, x, y, w: c.w, h: height, style: bstyle } satisfies PlacedRect);
        const text: PlacedText = { kind: "text", elementId: el.id, role: "cell", instance, x, y, w: c.w, h: height, style: c.style,
          lines: m.lines, lineHeight: lineHeightMm(c.style.fontSize, c.style.lineHeight), overflow: false };
        if (m.error) text.error = m.error;
        items.push(text);
      });
      if (el.border === "rows") {
        const y = origin.y + height;
        items.push({ kind: "line", elementId: el.id, role: "border", instance, x: origin.x, y, w: width, h: 0, x2: origin.x + width, y2: y, style: bstyle } satisfies PlacedLine);
      }
      return items;
    },
  };
}

/** 그룹 키. blank 모드의 표현식 오류는 키 null(한 그룹)로 둔다. 셀이 아니라 #ERR를 보일 곳이 없다 */
function groupKey(by: string, ctx: DataContext, opts: FlowOptions): unknown {
  try { return evaluate(by, ctx); }
  catch (e) { if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e; return null; }
}

/**
 * 표를 조각으로 바꾼다 (스펙 5.1). el은 페이지 절대좌표.
 * 소스 오류는 ExpressionError로 던진다(호출자가 #ERR 한 칸으로 바꾼다). 셀 표현식 오류는 그 셀만 #ERR
 */
export function tableFlow(el: TableElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] } {
  const rows = evaluateSource(el.source, ctx);
  const prefix = `${opts.instancePrefix ?? ""}${el.id}#`;
  const base: DataContext = { ...ctx, rows, pageRows: [] };
  const header = el.columns.length ? makeBlock(el, "header", columnCells(el, "header"), base, el.headerHeight, false, [], opts, `${prefix}h`) : undefined;

  const levels = el.groups.length;
  const keys = el.groups.map((g) => rows.map((row, i) => groupKey(g.by, { ...base, row, index: i }, opts)));
  const runs = computeGroupRuns(keys, rows.length);
  const byRow = runsByRow(runs, rows.length);
  const gctx = (run: GroupRun) => groupContext(run, rows);
  const headerCells = el.groups.map((g) => spanCells(el, g.header));
  const footerCells = el.groups.map((g) => spanCells(el, g.footer));
  const rowCells = columnCells(el, "row");

  const body: Block[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let L = 0; L < levels; L++) {
      const run = byRow[L][i];
      if (run.start === i && el.groups[L].header.length) {
        body.push(makeBlock(el, "groupHeader", headerCells[L], { ...base, row: rows[i], index: i, group: gctx(run) }, el.rowHeight,
          el.groups[L].keepHeaderWithRows, [], opts, `${prefix}g${L}h${run.index}`));
      }
    }
    const group = levels ? gctx(byRow[levels - 1][i]) : undefined;
    body.push(makeBlock(el, "row", rowCells, { ...base, row: rows[i], index: i, group }, el.rowHeight, false, [rows[i]], opts, `${prefix}${i}`));
    for (let L = levels - 1; L >= 0; L--) {
      const run = byRow[L][i];
      if (run.end === i + 1 && el.groups[L].footer.length) {
        body.push(makeBlock(el, "groupFooter", footerCells[L], { ...base, row: rows[i], index: i, group: gctx(run) }, el.rowHeight, false, [], opts, `${prefix}g${L}f${run.index}`));
      }
    }
  }
  // 페이지 소계는 페이지마다 pageRows로 다시 그린다. 높이는 전체 행으로 잰다(페이지 값이 높이를 바꾸지 않는다)
  const pageFooter = el.pageFooter.length ? makeBlock(el, "pageFooter", spanCells(el, el.pageFooter), { ...base, pageRows: rows }, el.rowHeight, false, [], opts, `${prefix}pf`) : undefined;
  const footer = el.footer.length ? makeBlock(el, "footer", spanCells(el, el.footer), base, el.rowHeight, false, [], opts, `${prefix}f`) : undefined;
  return { header, pageFooter, body, footer, rows };
}
