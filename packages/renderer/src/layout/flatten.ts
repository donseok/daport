import { componentKey, type ComponentBody, type ComponentProp, type Element } from "@daport/core";

/**
 * 컴포넌트 인스턴스 정보. path는 컴포넌트 트리 안의 요소 id 경로("logo", 그룹 안이면 "box/logo").
 * box는 ref 상자의 페이지 절대좌표(refBox 항목과 인스턴스 #ERR 자리)
 */
export type RefOwner = {
  refId: string; path: string; box: { x: number; y: number; w: number; h: number };
  decls: ComponentProp[]; values: Record<string, string | number | boolean>;
};
type FlatBase = { ancestorsVisible: string[]; owner?: RefOwner; refFlow?: "once" | "every" | "last" };
/** 평탄화된 요소. ancestorsVisible은 바깥부터 모은 조상 그룹·ref의 visible 표현식. 내용을 못 찾은 ref만 missing으로 남는다 */
export type FlatElement = (Exclude<Element, { type: "group" | "ref" }> & FlatBase)
  | (Extract<Element, { type: "ref" }> & FlatBase & { missing: true });
export type FlattenOptions = { components?: Record<string, ComponentBody>; owner?: RefOwner; refFlow?: "once" | "every" | "last" };

/**
 * 그룹과 ref를 풀어 모든 요소를 페이지 절대좌표로 만든다. 순서는 문서 순서 유지.
 * 그룹·ref의 visible은 평가하지 않고 자손에게 넘긴다(순수 함수 유지).
 * ref는 components["<ref>@<version>"]의 elements를 그룹처럼 펼치고 자식마다 owner·refFlow를 붙인다(스펙 5.1).
 * 내용이 없거나 이미 컴포넌트 안(중첩, 스키마가 막는다)이면 펼치지 않고 missing ref 하나로 남긴다
 */
export function flatten(elements: Element[], dx = 0, dy = 0, ancestorsVisible: string[] = [], opts: FlattenOptions = {}): FlatElement[] {
  return walk(elements, dx, dy, ancestorsVisible, opts, "");
}

function walk(elements: Element[], dx: number, dy: number, chain: string[], opts: FlattenOptions, prefix: string): FlatElement[] {
  const out: FlatElement[] = [];
  const tag = <T extends object>(o: T): T => {
    if (opts.owner) Object.assign(o, { owner: opts.owner, refFlow: opts.refFlow });
    return o;
  };
  for (const el of elements) {
    const next = el.visible === undefined ? chain : [...chain, el.visible];
    if (el.type === "group") {
      out.push(...walk(el.children, dx + el.x, dy + el.y, next, opts, `${prefix}${el.id}/`));
      continue;
    }
    if (el.type === "ref") {
      const body = opts.owner ? undefined : opts.components?.[componentKey(el.ref, el.version)];
      if (!body) {
        out.push(tag({ ...el, x: el.x + dx, y: el.y + dy, ancestorsVisible: chain, missing: true as const }));
        continue;
      }
      const x = el.x + dx, y = el.y + dy;
      const base: RefOwner = { refId: el.id, path: "", box: { x, y, w: el.w, h: el.h }, decls: body.props, values: el.props };
      out.push(...walkOwned(body.elements, x, y, next, { components: opts.components, owner: base, refFlow: el.flow }));
      continue;
    }
    const moved = tag({ ...el, x: el.x + dx, y: el.y + dy, ancestorsVisible: chain } as FlatElement);
    if (moved.type === "line") { moved.x2 += dx; moved.y2 += dy; }
    if (opts.owner) moved.owner = { ...opts.owner, path: `${prefix}${el.id}` };
    out.push(moved);
  }
  return out;
}

/** 컴포넌트 내용 트리. path는 컴포넌트 루트부터 다시 센다 */
function walkOwned(elements: Element[], dx: number, dy: number, chain: string[], opts: FlattenOptions): FlatElement[] {
  return walk(elements, dx, dy, chain, opts, "");
}
