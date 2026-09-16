import type { Element } from "@daport/core";

export type FlatElement = Exclude<Element, { type: "group" }>;

/** 그룹을 풀어 모든 요소를 페이지 절대좌표로 만든다. 순서는 문서 순서 유지 */
export function flatten(elements: Element[], dx = 0, dy = 0): FlatElement[] {
  const out: FlatElement[] = [];
  for (const el of elements) {
    if (el.type === "group") { out.push(...flatten(el.children, dx + el.x, dy + el.y)); continue; }
    const moved = { ...el, x: el.x + dx, y: el.y + dy } as FlatElement;
    if (moved.type === "line") { moved.x2 += dx; moved.y2 += dy; }
    out.push(moved);
  }
  return out;
}
