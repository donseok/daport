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

/** 라이브러리 컴포넌트 한 버전의 불변 내용. elements 좌표는 컴포넌트 상자(0,0 ~ w,h) 기준 */
export type ComponentBody = { name: string; w: number; h: number; props: ComponentProp[]; elements: Element[] };

export const ComponentBodySchema: z.ZodType<ComponentBody> = z.object({
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
  const seen = new Set<string>();
  walkElements(b.elements, (el, _parent, _i, ancestors) => {
    if (el.type === "ref") ctx.addIssue({ code: "custom", message: `ref inside component: ${el.id}`, path: ["elements"] });
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: ["elements"] });
    seen.add(el.id);
    const inTemplate = ancestors.some((a) => a.type === "repeater");
    if (inTemplate && el.type === "repeater") ctx.addIssue({ code: "custom", message: `repeater inside repeater template: ${el.id}`, path: ["elements"] });
    if (inTemplate && el.type === "table" && el.overflow !== "clip") {
      ctx.addIssue({ code: "custom", message: `table inside repeater template must be overflow "clip": ${el.id}`, path: ["elements"] });
    }
  });
}) as unknown as z.ZodType<ComponentBody>;

export function componentKey(id: string, version: number): string { return `${id}@${version}`; }
export function parseComponentBody(input: unknown): ComponentBody { return ComponentBodySchema.parse(input); }
