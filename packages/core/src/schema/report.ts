import { z } from "zod";
import { ElementSchema, type Element } from "./elements";

export const PageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  margin: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([10, 10, 10, 10]), // top,right,bottom,left
  unit: z.literal("mm").default("mm"),
});

export const DatasetSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string().min(1), type: z.literal("static"), rows: z.array(z.record(z.string(), z.unknown())) }),
  z.object({ name: z.string().min(1), type: z.literal("sql"), connection: z.string(), query: z.string() }),
  z.object({ name: z.string().min(1), type: z.literal("http"), url: z.string(), method: z.enum(["GET", "POST"]).default("GET") }),
]);

export const ParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "date"]).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export const ReportSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  version: z.number().int().nonnegative().default(1),
  page: PageSchema,
  datasets: z.array(DatasetSchema).default([]),
  params: z.array(ParamSchema).default([]),
  elements: z.array(ElementSchema).default([]),
  onExpressionError: z.enum(["blank", "fail"]).default("blank"),
}).superRefine((r, ctx) => {
  const seen = new Set<string>();
  const walk = (els: Element[], path: (string | number)[]) => {
    els.forEach((el, i) => {
      if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: [...path, i, "id"] });
      seen.add(el.id);
      if (el.type === "group") walk(el.children, [...path, i, "children"]);
    });
  };
  walk(r.elements, ["elements"]);
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportInput = z.input<typeof ReportSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type Param = z.infer<typeof ParamSchema>;

export function parseReport(input: unknown): Report { return ReportSchema.parse(input); }
export function safeParseReport(input: unknown) { return ReportSchema.safeParse(input); }
