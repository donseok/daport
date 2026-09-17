import type { ComponentBody } from "@daport/core";
import type { RefPaint } from "../layout/props";
import type { PlacedItem } from "../layout/types";
import type { MeasureCache } from "../text/cache";

export type Region = { x: number; y: number; w: number; h: number };
export type BlockKind = "header" | "row" | "groupHeader" | "groupFooter" | "pageFooter" | "footer";
/** 페이지 조립 시점에 정해지는 값. paint가 받는다 */
export type PageFlowContext = { page: number; total: number; sheet: number; sheets: number; copy: number; copies: number; pageRows: unknown[] };
export type Block = {
  kind: BlockKind;
  height: number;                 // mm. 조각 생성 시 확정
  keepWithNext: boolean;          // 그룹 머리: 다음 조각과 같은 페이지에 둔다
  rows: unknown[];                // 이 조각이 담은 데이터 행(pageRows 계산용). 머리·소계는 []
  paint(origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[];
};
export type FlowInput = { header?: Block; pageFooter?: Block; body: Block[]; footer?: Block };
export type FlowPlacement = { block: Block; y: number; overflow: boolean };   // y는 영역 상단 기준
export type FlowPage = { placements: FlowPlacement[]; pageRows: unknown[]; overflow: boolean; truncated: boolean };
/**
 * components: 레포트가 품은 컴포넌트 내용. 반복 영역 항목·밴드의 ref를 펼칠 때 쓴다.
 * ref: 이 흐름 요소가 컴포넌트 인스턴스 안이면 그 인스턴스. 조각을 그릴 때 그 페이지 값으로 입력값을 다시 평가한다(3b 스펙 5.2)
 */
export type FlowOptions = { measure: MeasureCache; onExpressionError: "blank" | "fail"; instancePrefix?: string;
  components?: Record<string, ComponentBody>; ref?: RefPaint };
