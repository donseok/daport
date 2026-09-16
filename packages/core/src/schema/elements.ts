import { z } from "zod";
import { StyleSchema } from "./style";

const Base = z.object({
  id: z.string().min(1),
  x: z.number(), y: z.number(),
  w: z.number().nonnegative(), h: z.number().nonnegative(),
  visible: z.string().optional(),               // 표현식. 미지정이면 항상 표시
  flow: z.enum(["once", "every", "last"]).default("once"),
  style: StyleSchema.prefault({}),
});

export const TextElementSchema = Base.extend({
  type: z.literal("text"),
  value: z.string().default(""),
});
export const ImageElementSchema = Base.extend({
  type: z.literal("image"),
  src: z.string().default(""),                  // asset://id | http(s) URL | 표현식
  fit: z.enum(["contain", "cover", "stretch"]).default("contain"),
});
export const LineElementSchema = Base.extend({
  type: z.literal("line"),
  x2: z.number(), y2: z.number(),               // 절대 mm (그룹 안이면 그룹 상대)
});
export const RectElementSchema = Base.extend({ type: z.literal("rect") });

export const BarcodeElementSchema = Base.extend({
  type: z.literal("barcode"),
  format: z.enum(["code128", "ean13", "qr"]),
  value: z.string().default(""),
  showText: z.boolean().default(true),
});
export const PageNumberElementSchema = Base.extend({
  type: z.literal("pageNumber"),
  format: z.string().default("{{ page }} / {{ total }}"),
});
export const RefElementSchema = Base.extend({
  type: z.literal("ref"),
  ref: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});
export const TableColumnSchema = z.object({
  header: z.string().default(""),
  value: z.string().default(""),
  w: z.number().positive(),
  style: StyleSchema.prefault({}),
});
export const TableElementSchema = Base.extend({
  type: z.literal("table"),
  source: z.string().min(1),
  columns: z.array(TableColumnSchema),
  repeatHeader: z.boolean().default(true),
  overflow: z.enum(["continue", "clip"]).default("continue"),
  keepTogether: z.enum(["none", "row"]).default("row"),
  rowHeight: z.number().positive().default(6),
  headerHeight: z.number().positive().default(7),
});

type LeafElement =
  | z.infer<typeof TextElementSchema> | z.infer<typeof ImageElementSchema>
  | z.infer<typeof LineElementSchema> | z.infer<typeof RectElementSchema>
  | z.infer<typeof BarcodeElementSchema> | z.infer<typeof PageNumberElementSchema>
  | z.infer<typeof RefElementSchema> | z.infer<typeof TableElementSchema>;
export type GroupElement = z.infer<typeof Base> & { type: "group"; children: Element[] };
export type Element = LeafElement | GroupElement;

export const GroupElementSchema: z.ZodType<GroupElement> = Base.extend({
  type: z.literal("group"),
  children: z.lazy(() => z.array(ElementSchema)),
}) as unknown as z.ZodType<GroupElement>;

export const ElementSchema: z.ZodType<Element> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TextElementSchema, ImageElementSchema, LineElementSchema, RectElementSchema,
    BarcodeElementSchema, PageNumberElementSchema, RefElementSchema, TableElementSchema,
    GroupElementSchema as any,
  ])
) as unknown as z.ZodType<Element>;

export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type LineElement = z.infer<typeof LineElementSchema>;
export type RectElement = z.infer<typeof RectElementSchema>;
export type ElementType = Element["type"];
