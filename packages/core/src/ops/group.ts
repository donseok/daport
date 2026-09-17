import { ElementSchema, type Element, type GroupElement } from "../schema/elements";
import { walkElements } from "../schema/tree";
import { elementBox, unionBox, translateElement } from "./geometry";

export type ParentInfo = { parent: Element[]; indices: number[] } | { error: string };

/**
 * 선택한 요소들이 모두 같은 부모 배열(최상위, 같은 그룹의 children, 같은 반복 영역 밴드)에 있는지 본다(스펙 7.3·7.4).
 * 성공하면 그 배열(elements 트리 안의 실제 배열 참조)과 요소 위치(오름차순)를 돌려준다. 실패하면 사용자에게 보일 사유.
 * allowInTemplate=false면 반복 영역 템플릿·밴드 안의 요소를 막고, allowRefs=false면 선택 요소나 그 자손에 ref가 있으면 막는다
 */
export function sameParent(elements: Element[], ids: string[], opts: { allowInTemplate: boolean; allowRefs: boolean }): ParentInfo {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return { error: "선택한 요소가 없습니다" };
  const found = new Map<string, { el: Element; parent: Element[]; index: number; ancestors: Element[] }>();
  walkElements(elements, (el, parent, index, ancestors) => {
    if (wanted.includes(el.id) && !found.has(el.id)) found.set(el.id, { el, parent, index, ancestors });
  });
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length) return { error: `요소를 찾을 수 없습니다: ${missing.join(", ")}` };
  const hits = wanted.map((id) => found.get(id)!);
  const parent = hits[0].parent;
  if (hits.some((h) => h.parent !== parent)) return { error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" };
  if (!opts.allowInTemplate && hits[0].ancestors.some((a) => a.type === "repeater")) {
    return { error: "반복 영역 템플릿 안의 요소는 컴포넌트로 만들 수 없습니다" };
  }
  if (!opts.allowRefs && walkElements(hits.map((h) => h.el), (el) => el.type === "ref")) {
    return { error: "컴포넌트 인스턴스는 다른 컴포넌트에 넣을 수 없습니다" };
  }
  return { parent, indices: hits.map((h) => h.index).sort((a, b) => a - b) };
}

/**
 * 부모 배열의 요소들을 group 하나로 묶은 새 배열(스펙 7.4). 그룹 x/y/w/h는 경계 상자(선은 두 끝점), 자식은 상자 기준 상대좌표로
 * 부모 배열 순서를 유지하고, 그룹은 첫 선택 요소(문서 순서) 자리에 들어간다. 입력 배열과 요소는 바꾸지 않는다
 */
export function groupElements(parent: Element[], ids: string[], groupId: string): Element[] {
  const wanted = new Set(ids);
  const picked = parent.filter((el) => wanted.has(el.id));
  if (wanted.size === 0 || picked.length !== wanted.size) throw new Error(`groupElements: ids not in parent: ${ids.join(", ")}`);
  const box = unionBox(picked.map(elementBox));
  const group = ElementSchema.parse({ id: groupId, type: "group", x: box.x, y: box.y, w: box.w, h: box.h, children: [] }) as GroupElement;
  group.children = picked.map((el) => translateElement(el, -box.x, -box.y));
  const out: Element[] = [];
  let placed = false;
  for (const el of parent) {
    if (!wanted.has(el.id)) { out.push(el); continue; }
    if (!placed) { out.push(group); placed = true; }
  }
  return out;
}

/**
 * 그룹을 풀어 자식을 그룹 자리에 순서대로 넣은 새 배열(스펙 7.4). 자식 좌표는 부모 기준으로 되돌린다.
 * 그룹에 visible이 있으면 풀면 조건이 사라지므로 던진다. 입력 배열과 요소는 바꾸지 않는다
 */
export function ungroupElement(parent: Element[], groupId: string): Element[] {
  const index = parent.findIndex((el) => el.id === groupId);
  const group = parent[index];
  if (!group || group.type !== "group") throw new Error(`group not found: ${groupId}`);
  if (group.visible !== undefined) throw new Error("group has visible");
  const children = group.children.map((c) => translateElement(c, group.x, group.y));
  return [...parent.slice(0, index), ...children, ...parent.slice(index + 1)];
}
