import type { Style } from "@daport/core";

type PlacedBase = {
  elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string;
  /** 반복으로 생긴 항목의 인스턴스 경로. 예 "cards#3", "t1#12", 중첩 "cards#3/t2#0". 템플릿 요소 id는 elementId에 남는다 */
  instance?: string;
  /** clip으로 잘린 흐름 요소의 flowBox에 표시 */
  clipped?: boolean;
  /** flowBox: 표·반복 영역 전체 영역(선택·히트용). cell: 표 셀 텍스트. border: 표 테두리. template: 반복 영역 첫 항목 자리 */
  role?: "flowBox" | "cell" | "border" | "template";
  /** 빈 페이지보다 큰 조각을 잘라 단독 배치했을 때 flowBox에 표시 */
  overflow?: boolean;
};

export type PlacedText = PlacedBase & { kind: "text"; lines: string[]; lineHeight: number; overflow: boolean };
export type PlacedImage = PlacedBase & { kind: "image"; src: string; fit: "contain" | "cover" | "stretch" };
export type PlacedLine = PlacedBase & { kind: "line"; x2: number; y2: number };
export type PlacedRect = PlacedBase & { kind: "rect" };
export type PlacedPlaceholder = PlacedBase & { kind: "placeholder"; label: string };
export type PlacedSvg = PlacedBase & { kind: "svg"; svg: string };

export type PlacedItem = PlacedText | PlacedImage | PlacedLine | PlacedRect | PlacedPlaceholder | PlacedSvg;

/** index는 전체 문서 기준(0부터). copyIndex는 몇 번째 부(0부터, repeat 없으면 0), pageInCopy는 부 안의 페이지(0부터) */
export type Page = { index: number; width: number; height: number; items: PlacedItem[]; copyIndex: number; pageInCopy: number };
