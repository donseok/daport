import type { Page, PlacedItem } from "@daport/renderer";
import type { View } from "../store";

/** 편집으로 페이지 수가 줄면 마지막 부·페이지로 당긴다 */
export function clampView(view: View, pages: Page[]): View {
  if (pages.length === 0) return { copyIndex: 0, pageInCopy: 0 };
  const copies = pages[pages.length - 1].copyIndex + 1;
  const copyIndex = Math.min(Math.max(0, view.copyIndex), copies - 1);
  const inCopy = pages.filter((p) => p.copyIndex === copyIndex);
  const pageInCopy = Math.min(Math.max(0, view.pageInCopy), inCopy.length - 1);
  return { copyIndex, pageInCopy };
}

export function currentPage(pages: Page[], view: View): Page {
  const v = clampView(view, pages);
  return pages.find((p) => p.copyIndex === v.copyIndex && p.pageInCopy === v.pageInCopy) ?? pages[0];
}

/** 선택 상자로 쓰는 항목: 문서 순서 첫 항목, 표 셀·테두리는 제외 (표·반복 영역은 flowBox, 반복 자식은 첫 인스턴스) */
export function primaryItem(page: Page, elementId: string): PlacedItem | undefined {
  return page.items.find((i) => i.elementId === elementId && i.role !== "cell" && i.role !== "border");
}

/** 반복 인스턴스가 첫 항목(템플릿)이 아닌가. "cards#3", "cards#3/t2#0" → true, "cards#0", 없음 → false */
export function isOtherInstance(instance: string | undefined): boolean {
  if (!instance) return false;
  const first = instance.split("/")[0];
  return !/#0$/.test(first);
}
