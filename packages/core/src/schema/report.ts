import { z } from "zod";
import { ElementSchema } from "./elements";
import { walkElements } from "./tree";

export const PageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  margin: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([10, 10, 10, 10]), // top,right,bottom,left
  unit: z.literal("mm").default("mm"),
});

/** 표현식 컨텍스트가 쓰는 이름. 데이터셋 이름·repeat.as로 쓰면 데이터가 가려지므로 금지한다 */
export const RESERVED_CONTEXT_NAMES: readonly string[] = [
  "params", "secrets", "record", "row", "item", "index", "group", "rows", "pageRows", "page", "total", "sheet", "sheets", "copy", "copies",
];

// repeat.as를 위한 예약어 (record는 기본값이므로 제외)
const RESERVED_REPEAT_AS_NAMES = RESERVED_CONTEXT_NAMES.filter((n) => n !== "record");

export const StaticDatasetSchema = z.object({ name: z.string().min(1), type: z.literal("static"), rows: z.array(z.record(z.string(), z.unknown())) });
export const SqlDatasetSchema = z.object({ name: z.string().min(1), type: z.literal("sql"), connection: z.string(), query: z.string() });
export const HttpDatasetSchema = z.object({
  name: z.string().min(1), type: z.literal("http"),
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
}).superRefine((r, ctx) => {
  const seen = new Set<string>();
  walkElements(r.elements, (el, _parent, _i, ancestors) => {
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: ["elements"] });
    seen.add(el.id);
    const inTemplate = ancestors.some((a) => a.type === "repeater");
    if (inTemplate && el.type === "repeater") ctx.addIssue({ code: "custom", message: `repeater inside repeater template: ${el.id}`, path: ["elements"] });
    if (inTemplate && el.type === "table" && el.overflow !== "clip") {
      ctx.addIssue({ code: "custom", message: `table inside repeater template must be overflow "clip": ${el.id}`, path: ["elements"] });
    }
  });
  const names = new Set<string>();
  r.datasets.forEach((ds, i) => {
    if (RESERVED_CONTEXT_NAMES.includes(ds.name)) ctx.addIssue({ code: "custom", message: `reserved name: ${ds.name}`, path: ["datasets", i, "name"] });
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
