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

/**
 * 선택 상자로 쓰는 항목. 컴포넌트 인스턴스는 refBox(인스턴스 전체 상자, 스펙 5.3)를 먼저 고른다.
 * 그 밖에는 문서 순서 첫 항목이며 표 셀·테두리는 제외한다 (표·반복 영역은 flowBox, 반복 자식은 첫 인스턴스)
 */
export function primaryItem(page: Page, elementId: string): PlacedItem | undefined {
  return page.items.find((i) => i.elementId === elementId && i.role === "refBox")
    ?? page.items.find((i) => i.elementId === elementId && i.role !== "cell" && i.role !== "border");
}

/**
 * 흐리게 그릴 반복 인스턴스인가. 인스턴스 경로의 첫 마디(`cards#3`, `cards#g0h1`, `t#2`)에서 요소 id와 순번을 읽는다.
 * 그 요소가 repeater일 때만 해당하며(표 셀의 `t#2`는 아니다), 그룹 밴드(`#g…`)와 첫 항목(`#0`)은 흐리지 않는다.
 * 템플릿 안 clip 표의 셀(`cards#2/t2#1`)은 첫 마디로 같은 항목에 속하므로 함께 흐려진다. 중첩 repeater는 스키마가 막는다
 */
export function isOtherInstance(instance: string | undefined, isRepeater: (id: string) => boolean): boolean {
  if (!instance) return false;
  const first = instance.split("/")[0];
  const hash = first.indexOf("#");
  if (hash < 0) return false;
  const id = first.slice(0, hash), tail = first.slice(hash + 1);
  if (!isRepeater(id) || tail.startsWith("g")) return false;
  return tail !== "0";
}
