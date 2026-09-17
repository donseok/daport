import type { Element } from "../schema/elements";
import type { Report } from "../schema/report";
import { walkElements } from "../schema/tree";
import { componentKey, COMPONENT_KEY_RE, type ComponentBody } from "../schema/component";
import { elementBox, unionBox, translateElement, type Box } from "./geometry";

type RefElement = Extract<Element, { type: "ref" }>;

/** 레포트 본문(그룹 안·반복 영역 템플릿 안 포함)에서 이 컴포넌트를 가리키는 ref를 문서 순서로 모은다. 버전은 가리지 않는다 */
export function refsTo(report: Report, componentId: string): RefElement[] {
  const out: RefElement[] = [];
  walkElements(report.elements, (el) => { if (el.type === "ref" && el.ref === componentId) out.push(el); });
  return out;
}

/**
 * 레포트 안의 이 컴포넌트 인스턴스를 모두 새 버전으로 올린다(스펙 7.2 규칙 1~3). 입력 레포트는 바꾸지 않는다.
 * 1. components[id@version] = body
 * 2. ref.version = version, ref.w/h = body.w/h, 새 선언에 없는 입력값 이름은 지운다(선언된 값은 그대로)
 * 3. 이 컴포넌트의 다른 버전 항목을 지운다(모든 인스턴스가 새 버전을 가리키므로 쓰이지 않는다). 다른 컴포넌트 항목은 건드리지 않는다
 * 스키마 검증(규칙 4)은 호출하는 쪽이 한다
 */
export function upgradeRefs(report: Report, componentId: string, version: number, body: ComponentBody): Report {
  const next = structuredClone(report);
  const content = structuredClone(body);
  const declared = new Set(content.props.map((p) => p.name));
  for (const ref of refsTo(next, componentId)) {
    ref.version = version;
    ref.w = content.w;
    ref.h = content.h;
    for (const name of Object.keys(ref.props)) if (!declared.has(name)) delete ref.props[name];
  }
  const components: Report["components"] = {};
  for (const [key, value] of Object.entries(next.components)) {
    const m = COMPONENT_KEY_RE.exec(key);
    if (m && m[1] === componentId) continue;
    components[key] = value;
  }
  components[componentKey(componentId, version)] = content;
  next.components = components;
  return next;
}

/** 본문의 어떤 ref도 가리키지 않는 components 항목을 지운 새 레포트. 요소 트리는 그대로 공유한다 */
export function pruneComponents(report: Report): Report {
  const used = new Set<string>();
  walkElements(report.elements, (el) => { if (el.type === "ref") used.add(componentKey(el.ref, el.version)); });
  const components: Report["components"] = {};
  for (const [key, value] of Object.entries(report.components)) if (used.has(key)) components[key] = value;
  return { ...report, components };
}

/**
 * 같은 부모 배열 안의 요소들로 컴포넌트 내용을 만든다(스펙 7.3 1~2). 선택 조건 검사는 sameParent가 한다.
 * box는 부모 기준 경계 상자(선은 두 끝점), body.elements는 box 기준 상대좌표로 옮긴 복제본(부모 배열 순서), props는 빈 배열
 */
export function extractComponent(parent: Element[], ids: string[], name: string): { body: ComponentBody; box: Box } {
  const wanted = new Set(ids);
  if (wanted.size === 0) throw new Error("extractComponent: no ids");
  const picked = parent.filter((el) => wanted.has(el.id));
  if (picked.length !== wanted.size) {
    const missing = [...wanted].filter((id) => !picked.some((el) => el.id === id));
    throw new Error(`elements not in parent: ${missing.join(", ")}`);
  }
  const box = unionBox(picked.map(elementBox));
  const elements = picked.map((el) => translateElement(el, -box.x, -box.y));
  return { body: { name, w: box.w, h: box.h, props: [], elements }, box };
}
