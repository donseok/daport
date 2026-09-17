import { z } from "zod";
import { StyleSchema, StyleOverrideSchema, color } from "./style";

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
export const CellAlignSchema = z.enum(["left", "center", "right"]);
/** 머리행·그룹 행·소계 행의 셀. span은 차지하는 열 수("all"은 남은 열 전부). 스타일은 열·머리 스타일 위에 덮어쓸 값만 */
export const TableCellSchema = z.object({
  value: z.string().default(""),
  span: z.union([z.number().int().positive(), z.literal("all")]).default(1),
  align: CellAlignSchema.optional(),
  style: StyleOverrideSchema.optional(),
});
export type TableCell = z.infer<typeof TableCellSchema>;
export const TableColumnSchema = z.object({
  header: z.string().default(""),
  value: z.string().default(""),
  w: z.number().positive(),
  align: CellAlignSchema.optional(),              // 없으면 style.align
  style: StyleSchema.prefault({}),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;
/** 그룹 경계는 데이터 순서대로 연속된 같은 key다. 앞 항목이 바깥 그룹 */
export const TableGroupSchema = z.object({
  by: z.string().min(1),                          // 표현식 (행 컨텍스트에서 평가)
  header: z.array(TableCellSchema).default([]),
  footer: z.array(TableCellSchema).default([]),
  keepHeaderWithRows: z.boolean().default(true),
});
export type TableGroup = z.infer<typeof TableGroupSchema>;
export const TableElementSchema = Base.extend({
  type: z.literal("table"),
  source: z.string().min(1),                      // 배열로 평가되는 표현식
  columns: z.array(TableColumnSchema),
  repeatHeader: z.boolean().default(true),
  overflow: z.enum(["continue", "clip"]).default("continue"),
  keepTogether: z.enum(["none", "row"]).default("row"),   // 2단계에서는 늘 row로 동작
  rowHeight: z.number().positive().default(6),    // 최소 행 높이(mm)
  headerHeight: z.number().positive().default(7), // 최소 머리행 높이(mm)
  border: z.enum(["all", "rows", "none"]).default("all"),
  borderStyle: z.object({ stroke: color().default("#000000"), strokeWidth: z.number().nonnegative().default(0.2) }).prefault({}),
  headerStyle: StyleOverrideSchema.default({}),
  groups: z.array(TableGroupSchema).default([]),
  pageFooter: z.array(TableCellSchema).default([]),
  footer: z.array(TableCellSchema).default([]),
});
export type TableElement = z.infer<typeof TableElementSchema>;

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
