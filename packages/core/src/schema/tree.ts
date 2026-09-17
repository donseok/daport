import type { Element } from "./elements";

/** 요소가 직접 가진 자식 배열들. group → [children], repeater → [item.children, 그룹마다 header·footer children], 그 밖 → [] */
export function childArrays(el: Element): Element[][] {
  if (el.type === "group") return [el.children];
  if (el.type === "repeater") {
    const out = [el.item.children];
    for (const g of el.groups) {
      if (g.header) out.push(g.header.children);
      if (g.footer) out.push(g.footer.children);
    }
    return out;
  }
  return [];
}

/**
 * 깊이 우선·문서 순서로 모든 요소를 방문한다(반복 영역 템플릿 자식 포함). fn이 true를 돌려주면 중단하고 true를 돌려준다.
 * parent는 el이 들어 있는 배열, index는 그 안의 위치, ancestors는 바깥부터 차례로 모은 조상(group·repeater).
 * 스키마 검증·렌더러·스튜디오 스토어가 모두 이 함수만 쓴다
 */
export function walkElements(
  els: Element[],
  fn: (el: Element, parent: Element[], index: number, ancestors: Element[]) => boolean | void,
  ancestors: Element[] = [],
): boolean {
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (fn(el, els, i, ancestors)) return true;
    for (const arr of childArrays(el)) if (walkElements(arr, fn, [...ancestors, el])) return true;
  }
  return false;
}

export function collectIds(els: Element[]): Set<string> {
  const ids = new Set<string>();
  walkElements(els, (el) => { ids.add(el.id); });
  return ids;
}
