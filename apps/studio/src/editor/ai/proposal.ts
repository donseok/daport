import { applyPatch, deepClone, type Operation } from "fast-json-patch";
import { parseReport, walkElements, type ComponentBody, type Element, type Report } from "@daport/core";

/** AI 편집·생성 응답을 사용자 모델에 반영하기 전에 미리 보여주는 상태. 히스토리 밖에 존재하며, 적용해야만 되돌리기 한 단위로 들어간다 */
export type Proposal = {
  kind: "edit" | "generate";
  patch: Operation[];
  explanation: string;
  warnings: string[];
  next: Report;
  changes: { added: string[]; changed: string[]; removed: string[] };
  /** 제안을 만들 때의 레포트. 이후 다른 편집으로 report가 바뀌면 이 base와 달라져 제안이 더 이상 유효하지 않다 */
  base: Report;
};

/** 자식 배열(그룹 children, 반복 item/header/footer children)을 뺀 요소 자신의 내용. group·repeater만 자식을 갖는다(core childArrays) */
function ownContent(el: Element): unknown {
  if (el.type === "group") return { ...el, children: undefined };
  if (el.type === "repeater") {
    return {
      ...el,
      item: { ...el.item, children: undefined },
      groups: el.groups.map((g) => ({
        ...g,
        header: g.header ? { ...g.header, children: undefined } : g.header,
        footer: g.footer ? { ...g.footer, children: undefined } : g.footer,
      })),
    };
  }
  return el;
}

function contentById(r: Report): Map<string, string> {
  const m = new Map<string, string>();
  walkElements(r.elements, (el) => { m.set(el.id, JSON.stringify(ownContent(el))); });
  return m;
}

/** 두 레포트의 요소 트리(중첩 포함)를 id 기준으로 비교해 추가·변경·삭제된 id를 나눈다 */
export function diffIds(before: Report, after: Report): Proposal["changes"] {
  const b = contentById(before), a = contentById(after);
  const added: string[] = [], changed: string[] = [];
  for (const [id, json] of a) {
    if (!b.has(id)) added.push(id);
    else if (b.get(id) !== json) changed.push(id);
  }
  const removed: string[] = [];
  for (const id of b.keys()) if (!a.has(id)) removed.push(id);
  return { added, changed, removed };
}

/** /api/reports/:id/ai/edit 응답으로 제안을 만든다. base는 복사본에만 패치를 적용하고 그대로 둔다 */
export function proposalFromEdit(base: Report, res: { patch: Operation[]; explanation: string; warnings: string[] }): Proposal {
  const applied = applyPatch(deepClone(base) as object, deepClone(res.patch), false, false).newDocument;
  const next = parseReport(applied);
  return { kind: "edit", patch: res.patch, explanation: res.explanation, warnings: res.warnings, next, changes: diffIds(base, next), base };
}

/** /api/reports/:id/ai/generate 응답으로 제안을 만든다. 요소는 통째로 교체하고 컴포넌트는 base 위에 덧붙인다 */
export function proposalFromGenerate(
  base: Report,
  res: { elements: Element[]; components: Record<string, ComponentBody>; explanation: string; warnings: string[] },
): Proposal {
  const merged = { ...deepClone(base), elements: deepClone(res.elements), components: { ...deepClone(base.components), ...deepClone(res.components) } };
  const next = parseReport(merged);
  return { kind: "generate", patch: [], explanation: res.explanation, warnings: res.warnings, next, changes: diffIds(base, next), base };
}
