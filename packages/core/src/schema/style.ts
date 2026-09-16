import { z } from "zod";

export const StyleSchema = z.object({
  fontFamily: z.enum(["Pretendard"]).default("Pretendard"),
  fontSize: z.number().positive().default(10),     // pt
  bold: z.boolean().default(false),
  color: z.string().default("#000000"),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  wrap: z.boolean().default(true),
  lineHeight: z.number().positive().default(1.3),  // 배수
  stroke: z.string().optional(),                   // 선/테두리 색
  strokeWidth: z.number().nonnegative().default(0.2), // mm
  fill: z.string().optional(),
  radius: z.number().nonnegative().default(0),     // mm
  padding: z.number().nonnegative().default(0),    // mm
});
export type Style = z.infer<typeof StyleSchema>;
export type StyleInput = z.input<typeof StyleSchema>;
