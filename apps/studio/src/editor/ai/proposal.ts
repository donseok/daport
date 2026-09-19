import { applyPatch, deepClone, type Operation } from "fast-json-patch";
import { parseReport, walkElements, type ComponentBody, type Element, type Report } from "@daport/core";

/** AI 편집·생성 응답을 사용자 모델에 반영하기 전에 미리 보여주는 상태. 히스토리 밖에 존재하며, 적용해야만 되돌리기 한 단위로 들어간다 */
export type Proposal = {
  kind: "edit" | "generate" | "import";
  patch: Operation[];
  explanation: string;
  warnings: string[];
  next: Report;
  changes: { added: string[]; changed: string[]; removed: string[] };
  /** /elements 밖(datasets·params·page·name)을 건드리는 op 요약. diffIds는 요소만 보므로 이게 없으면 그런 패치가 화면상 무변화로 보인다 */
  otherOps: string[];
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

/** op의 종류를 한국어 동사로 */
function opVerb(op: Operation["op"]): string {
  if (op === "add" || op === "copy") return "추가";
  if (op === "remove") return "삭제";
  return "변경";   // replace, move
}

/** /elements 밖(datasets·params·page·name)을 건드리는 op을 최상위 경로별로 묶어 "datasets 1건 추가" 같은 요약을 만든다.
 * diffIds는 요소 트리만 비교하므로 이런 패치는 오버레이가 그대로라 사용자가 알아챌 방법이 없다(스펙 1·11) */
function summarizeOtherOps(patch: Operation[]): string[] {
  const counts = new Map<string, Map<string, number>>();
  for (const o of patch) {
    const top = o.path.split("/")[1];
    if (!top || top === "elements") continue;
    const byVerb = counts.get(top) ?? new Map<string, number>();
    const verb = opVerb(o.op);
    byVerb.set(verb, (byVerb.get(verb) ?? 0) + 1);
    counts.set(top, byVerb);
  }
  const out: string[] = [];
  for (const [top, byVerb] of counts) for (const [verb, n] of byVerb) out.push(`${top} ${n}건 ${verb}`);
  return out;
}

/** /api/reports/:id/ai/edit 응답으로 제안을 만든다. base는 복사본에만 패치를 적용하고 그대로 둔다.
 * validateOperation=true: 서버가 이미 검증·적용까지 마친 패치이므로 여기서 실패하면(서버·클라 검증 괴리) 조용히 넘어가지 않고 바로 드러나야 한다 */
export function proposalFromEdit(base: Report, res: { patch: Operation[]; explanation: string; warnings: string[] }): Proposal {
  const applied = applyPatch(deepClone(base) as object, deepClone(res.patch), true, false).newDocument;
  const next = parseReport(applied);
  return { kind: "edit", patch: res.patch, explanation: res.explanation, warnings: res.warnings, next, changes: diffIds(base, next), otherOps: summarizeOtherOps(res.patch), base };
}

/** /api/reports/:id/ai/generate 응답으로 제안을 만든다. 요소는 통째로 교체하고 컴포넌트는 base 위에 덧붙인다 */
export function proposalFromGenerate(
  base: Report,
  res: { elements: Element[]; components: Record<string, ComponentBody>; explanation: string; warnings: string[] },
): Proposal {
  const merged = { ...deepClone(base), elements: deepClone(res.elements), components: { ...deepClone(base.components), ...deepClone(res.components) } };
  const next = parseReport(merged);
  return { kind: "generate", patch: [], explanation: res.explanation, warnings: res.warnings, next, changes: diffIds(base, next), otherOps: [], base };
}

/** 이관 응답 → 제안. 요소뿐 아니라 params·datasets도 함께 바뀐다 */
export function proposalFromImport(
  base: Report,
  res: { elements: Element[]; params: Report["params"]; datasets: Report["datasets"]; explanation: string; warnings: string[] },
): Proposal {
  const next = parseReport({
    ...base,
    elements: res.elements,
    params: [...base.params, ...res.params],
    datasets: [...base.datasets, ...res.datasets],
  });
  const otherOps: string[] = [];
  if (res.params.length > 0) otherOps.push(`파라미터 ${res.params.length}개 추가`);
  if (res.datasets.length > 0) otherOps.push(`데이터셋 ${res.datasets.length}개 추가`);
  return { kind: "import", patch: [], explanation: res.explanation, warnings: res.warnings, next, changes: diffIds(base, next), otherOps, base };
}
