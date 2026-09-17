import { evaluate, evaluateSource, ExpressionError, StyleSchema, type DataContext, type RepeaterBand, type RepeaterElement, type Style } from "@daport/core";
import type { PlacedItem, PlacedRect } from "../layout/types";
import { paintChildren } from "./children";
import { computeGroupRuns, runsByRow, groupContext, type GroupRun } from "./groups";
import type { Block, FlowInput, FlowOptions } from "./types";

const DEFAULT_STYLE: Style = StyleSchema.parse({});

/** list는 1, grid는 한 줄에 들어가는 항목 수(최소 1) */
export function itemsPerRow(el: RepeaterElement): number {
  if (el.layout === "list") return 1;
  return Math.max(1, Math.floor((el.w + el.gap[0]) / (el.item.w + el.gap[0])));
}

function groupKey(by: string, ctx: DataContext, opts: FlowOptions): unknown {
  try { return evaluate(by, ctx); }
  catch (e) { if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e; return null; }
}

/**
 * 반복 영역을 조각으로 바꾼다 (스펙 5.1). list는 항목마다, grid는 한 줄마다 row 조각. 그룹 경계에서 줄을 끊는다(R7).
 * 소스 오류는 ExpressionError로 던진다
 */
export function repeaterFlow(el: RepeaterElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] } {
  const rows = evaluateSource(el.source, ctx);
  const prefix = `${opts.instancePrefix ?? ""}${el.id}#`;
  const base: DataContext = { ...ctx, rows, pageRows: [] };
  const perRow = itemsPerRow(el);
  const stepX = el.item.w + el.gap[0];

  const levels = el.groups.length;
  const keys = el.groups.map((g) => rows.map((item, i) => groupKey(g.by, { ...base, item, index: i }, opts)));
  const runs = computeGroupRuns(keys, rows.length);
  const byRow = runsByRow(runs, rows.length);
  const gctx = (run: GroupRun) => groupContext(run, rows);

  const rowBlock = (indices: number[]): Block => ({
    kind: "row", height: el.item.h + el.gap[1], keepWithNext: false, rows: indices.map((i) => rows[i]),
    paint(origin, pageCtx) {
      const items: PlacedItem[] = [];
      indices.forEach((i, k) => {
        const x = origin.x + k * stepX, y = origin.y;
        const instance = `${prefix}${i}`;
        // 첫 항목 자리는 캔버스의 템플릿 편집 영역이다 (파란 점선은 캔버스가 role로 그린다)
        if (i === 0) items.push({ kind: "rect", elementId: el.id, role: "template", instance, x, y, w: el.item.w, h: el.item.h, style: DEFAULT_STYLE } satisfies PlacedRect);
        const group = levels ? gctx(byRow[levels - 1][i]) : undefined;
        items.push(...paintChildren(el.item.children, { x, y }, { ...base, item: rows[i], index: i, group }, { ...opts, instance, pageCtx }));
      });
      return items;
    },
  });
  const bandBlock = (kind: "groupHeader" | "groupFooter", band: RepeaterBand, run: GroupRun, instance: string): Block => ({
    kind, height: band.h, keepWithNext: kind === "groupHeader", rows: [],
    paint(origin, pageCtx) {
      return paintChildren(band.children, origin, { ...base, item: rows[run.start], index: run.start, group: gctx(run) }, { ...opts, instance, pageCtx });
    },
  });

  const body: Block[] = [];
  let buffer: number[] = [];
  const flush = () => { if (buffer.length) { body.push(rowBlock(buffer)); buffer = []; } };
  for (let i = 0; i < rows.length; i++) {
    for (let L = 0; L < levels; L++) {
      const run = byRow[L][i];
      const header = el.groups[L].header;
      if (run.start === i) { flush(); if (header) body.push(bandBlock("groupHeader", header, run, `${prefix}g${L}h${run.index}`)); }
    }
    buffer.push(i);
    if (buffer.length === perRow) flush();
    for (let L = levels - 1; L >= 0; L--) {
      const run = byRow[L][i];
      const footer = el.groups[L].footer;
      if (run.end === i + 1) { flush(); if (footer) body.push(bandBlock("groupFooter", footer, run, `${prefix}g${L}f${run.index}`)); }
    }
  }
  flush();
  return { body, rows };
}
