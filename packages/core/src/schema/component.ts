import { z } from "zod";
import { ElementSchema, type Element } from "./elements";
import { walkElements } from "./tree";
export { COMPONENT_ID_RE, COMPONENT_KEY_RE } from "./ids";

const IDENT = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "입력값 이름은 식별자여야 합니다");

/** 컴포넌트 입력값 선언. default는 필수이고 type과 맞아야 한다(image는 asset://id 또는 URL 문자열) */
export const ComponentPropSchema = z.discriminatedUnion("type", [
  z.object({ name: IDENT, type: z.literal("string"), default: z.string(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("number"), default: z.number(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("boolean"), default: z.boolean(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("image"), default: z.string(), label: z.string().optional() }),
]);
export type ComponentProp = z.infer<typeof ComponentPropSchema>;

/** 반복 영역 템플릿에 넣을 수 없는 요소(repeater, overflow가 clip이 아닌 table)가 트리에 있는가 */
export function hasFlowElement(elements: Element[]): boolean {
  return walkElements(elements, (el) => el.type === "repeater" || (el.type === "table" && el.overflow !== "clip"));
}

/**
 * 레포트 본문과 컴포넌트 내용이 함께 쓰는 요소 트리 규칙: 요소 id 유일, 반복 영역 템플릿 안 repeater 금지,
 * 템플릿 안 표는 overflow "clip"만. 오류 path는 양쪽 다 ["elements"]다(레포트에 박힌 컴포넌트 내용은
 * zod가 앞에 components.<키>를 붙여 준다). each는 요소마다 부르는 쪽별 추가 검사다
 */
export function checkElementTree(
  elements: Element[],
  ctx: z.RefinementCtx,
  each?: (el: Element, inTemplate: boolean) => void,
): void {
  const seen = new Set<string>();
  walkElements(elements, (el, _parent, _i, ancestors) => {
    const inTemplate = ancestors.some((a) => a.type === "repeater");
    each?.(el, inTemplate);
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: ["elements"] });
    seen.add(el.id);
    if (inTemplate && el.type === "repeater") ctx.addIssue({ code: "custom", message: `repeater inside repeater template: ${el.id}`, path: ["elements"] });
    if (inTemplate && el.type === "table" && el.overflow !== "clip") {
      ctx.addIssue({ code: "custom", message: `table inside repeater template must be overflow "clip": ${el.id}`, path: ["elements"] });
    }
  });
}

/** 라이브러리 컴포넌트 한 버전의 불변 내용. elements 좌표는 컴포넌트 상자(0,0 ~ w,h) 기준 */
export const ComponentBodySchema = z.object({
  name: z.string().min(1),
  w: z.number().positive(),
  h: z.number().positive(),
  props: z.array(ComponentPropSchema).default([]),
  elements: z.array(ElementSchema).default([]),
}).superRefine((b, ctx) => {
  const propNames = new Set<string>();
  b.props.forEach((p, i) => {
    if (propNames.has(p.name)) ctx.addIssue({ code: "custom", message: `duplicate prop name: ${p.name}`, path: ["props", i, "name"] });
    propNames.add(p.name);
  });
  checkElementTree(b.elements, ctx, (el) => {
    if (el.type === "ref") ctx.addIssue({ code: "custom", message: `ref inside component: ${el.id}`, path: ["elements"] });
  });
});

export type ComponentBody = z.infer<typeof ComponentBodySchema>;

/** 문서에 적힌 모양과 스키마가 어긋나면 여기서 타입 오류가 난다(캐스트가 아니라 대입 가능성만 확인한다) */
type ComponentBodyShape = { name: string; w: number; h: number; props: ComponentProp[]; elements: Element[] };
type Assert<T extends true> = T;
type _BodyFitsShape = Assert<ComponentBody extends ComponentBodyShape ? true : false>;
type _ShapeFitsBody = Assert<ComponentBodyShape extends ComponentBody ? true : false>;

export function componentKey(id: string, version: number): string { return `${id}@${version}`; }
export function parseComponentBody(input: unknown): ComponentBody { return ComponentBodySchema.parse(input); }
