import type { Element } from "@daport/core";

/** 평탄화된 요소. ancestorsVisible은 바깥 그룹부터 차례로 모은 조상 그룹의 visible 표현식 */
export type FlatElement = Exclude<Element, { type: "group" }> & { ancestorsVisible: string[] };

/**
 * 그룹을 풀어 모든 요소를 페이지 절대좌표로 만든다. 순서는 문서 순서 유지.
 * 그룹의 visible은 평가하지 않고 자손에게 넘긴다(순수 함수 유지).
 */
export function flatten(elements: Element[], dx = 0, dy = 0, ancestorsVisible: string[] = []): FlatElement[] {
  const out: FlatElement[] = [];
  for (const el of elements) {
    if (el.type === "group") {
      const chain = el.visible === undefined ? ancestorsVisible : [...ancestorsVisible, el.visible];
      out.push(...flatten(el.children, dx + el.x, dy + el.y, chain));
      continue;
    }
    const moved = { ...el, x: el.x + dx, y: el.y + dy, ancestorsVisible } as FlatElement;
    if (moved.type === "line") { moved.x2 += dx; moved.y2 += dy; }
    out.push(moved);
  }
  return out;
}
