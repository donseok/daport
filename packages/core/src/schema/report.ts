import { z } from "zod";
import { ElementSchema } from "./elements";
import { ComponentBodySchema, COMPONENT_KEY_RE, checkElementTree, componentKey, hasFlowElement } from "./component";
import { OutputSchema } from "./output";

export const PageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  margin: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([10, 10, 10, 10]), // top,right,bottom,left
  unit: z.literal("mm").default("mm"),
});

/** 표현식 컨텍스트가 쓰는 이름. 데이터셋 이름·repeat.as로 쓰면 데이터가 가려지므로 금지한다 */
export const RESERVED_CONTEXT_NAMES: readonly string[] = [
  "params", "secrets", "record", "row", "item", "index", "group", "rows", "pageRows", "page", "total", "sheet", "sheets", "copy", "copies", "props",
];

// repeat.as를 위한 예약어 (record는 기본값이므로 제외)
const RESERVED_REPEAT_AS_NAMES = RESERVED_CONTEXT_NAMES.filter((n) => n !== "record");

/**
 * 프로토타입 오염 방지: 데이터셋 이름·요청 data 이름으로 쓰면 컨텍스트 객체의 프로토타입을 바꾸거나
 * 상속 멤버를 가릴 수 있는 키. JSON.parse가 만든 own key "__proto__"는 Object.entries로 그대로 보이므로
 * 스키마·실행기(datasource) 양쪽에서 예약어처럼 거부한다
 */
export const FORBIDDEN_CONTEXT_KEYS = ["__proto__", "constructor", "prototype"] as const;

const DATASET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const datasetName = () => z.string().regex(DATASET_NAME_RE, "데이터셋 이름은 식별자여야 합니다");

export const StaticDatasetSchema = z.object({ name: datasetName(), type: z.literal("static"), rows: z.array(z.record(z.string(), z.unknown())) });
export const SqlDatasetSchema = z.object({ name: datasetName(), type: z.literal("sql"), connection: z.string(), query: z.string() });
export const HttpDatasetSchema = z.object({
  name: datasetName(), type: z.literal("http"),
  url: z.string(),                                            // 템플릿. 값은 encodeURIComponent
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),      // 값은 템플릿(그대로 넣음)
  body: z.string().optional(),                                // POST 본문 템플릿
  rowsPath: z.string().optional(),                            // 점 경로. 생략 시 응답 루트
});
export const DatasetSchema = z.discriminatedUnion("type", [StaticDatasetSchema, SqlDatasetSchema, HttpDatasetSchema]);

export const ParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "date"]).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export const RepeatSchema = z.object({
  source: z.string().min(1),                                  // 배열로 평가되는 표현식
  as: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("record"),
});
export const SampleSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  data: z.record(z.string(), z.unknown()).default({}),        // 데이터셋 이름 → 행 배열(앞 200행)
  capturedAt: z.string(),
});

export const ReportSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다"),   // URL 경로에 그대로 쓴다
  name: z.string().default(""),
  version: z.number().int().nonnegative().default(1),
  page: PageSchema,
  datasets: z.array(DatasetSchema).default([]),
  params: z.array(ParamSchema).default([]),
  elements: z.array(ElementSchema).default([]),
  onExpressionError: z.enum(["blank", "fail"]).default("blank"),
  repeat: RepeatSchema.optional(),
  sample: SampleSchema.optional(),
  output: OutputSchema.default({ kind: "pdf" }),
  /** 이 레포트가 쓰는 컴포넌트 버전의 내용. 키 "<컴포넌트id>@<버전>" */
  components: z.record(z.string().regex(COMPONENT_KEY_RE, "components 키는 <컴포넌트id>@<버전> 형식이어야 합니다"), ComponentBodySchema).default({}),
}).superRefine((r, ctx) => {
  // 같은 컴포넌트를 여러 번 참조해도 내용 트리는 키마다 한 번만 훑는다
  const flowByKey = new Map<string, boolean>();
  checkElementTree(r.elements, ctx, (el, inTemplate) => {
    if (el.type !== "ref") return;
    const key = componentKey(el.ref, el.version);
    const body = Object.hasOwn(r.components, key) ? r.components[key] : undefined;
    if (!body) {
      ctx.addIssue({ code: "custom", message: `missing component ${key}: ${el.id}`, path: ["elements"] });
      return;
    }
    if (Math.abs(el.w - body.w) > 1e-6 || Math.abs(el.h - body.h) > 1e-6) {
      ctx.addIssue({ code: "custom", message: `ref size differs from component ${key}: ${el.id}`, path: ["elements"] });
    }
    if (!inTemplate) return;
    let flow = flowByKey.get(key);
    if (flow === undefined) { flow = hasFlowElement(body.elements); flowByKey.set(key, flow); }
    if (flow) {
      ctx.addIssue({ code: "custom", message: `component with continue table or repeater inside repeater template: ${el.id}`, path: ["elements"] });
    }
  });
  const names = new Set<string>();
  r.datasets.forEach((ds, i) => {
    if (RESERVED_CONTEXT_NAMES.includes(ds.name) || (FORBIDDEN_CONTEXT_KEYS as readonly string[]).includes(ds.name)) {
      ctx.addIssue({ code: "custom", message: `reserved name: ${ds.name}`, path: ["datasets", i, "name"] });
    }
    if (names.has(ds.name)) ctx.addIssue({ code: "custom", message: `duplicate dataset name: ${ds.name}`, path: ["datasets", i, "name"] });
    names.add(ds.name);
  });
  if (r.repeat && RESERVED_REPEAT_AS_NAMES.includes(r.repeat.as)) ctx.addIssue({ code: "custom", message: `reserved name: ${r.repeat.as}`, path: ["repeat", "as"] });
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportInput = z.input<typeof ReportSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type HttpDataset = z.infer<typeof HttpDatasetSchema>;
export type SqlDataset = z.infer<typeof SqlDatasetSchema>;
export type StaticDataset = z.infer<typeof StaticDatasetSchema>;
export type Param = z.infer<typeof ParamSchema>;
export type Repeat = z.infer<typeof RepeatSchema>;
export type Sample = z.infer<typeof SampleSchema>;

export function parseReport(input: unknown): Report { return ReportSchema.parse(input); }
export function safeParseReport(input: unknown) { return ReportSchema.safeParse(input); }
