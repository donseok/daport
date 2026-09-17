import { z } from "zod";
import { isSafeCssColor } from "./color";

export const color = () => z.string().refine(isSafeCssColor, { message: "invalid color" });

export const StyleSchema = z.object({
  fontFamily: z.enum(["Pretendard"]).default("Pretendard"),
  fontSize: z.number().positive().default(10),     // pt
  bold: z.boolean().default(false),
  color: color().default("#000000"),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  wrap: z.boolean().default(true),
  lineHeight: z.number().positive().default(1.3),  // 배수
  stroke: color().optional(),                      // 선/테두리 색
  strokeWidth: z.number().nonnegative().default(0.2), // mm
  fill: color().optional(),
  radius: z.number().nonnegative().default(0),     // mm
  padding: z.number().nonnegative().default(0),    // mm
});
export type Style = z.infer<typeof StyleSchema>;
export type StyleInput = z.input<typeof StyleSchema>;

/** 열·머리 스타일 위에 덮어쓸 값만 담는 부분 스타일. 기본값을 채우지 않아야 "지정하지 않음"과 "기본값"을 구분한다 */
export const StyleOverrideSchema = z.object({
  fontFamily: z.enum(["Pretendard"]).optional(),
  fontSize: z.number().positive().optional(),
  bold: z.boolean().optional(),
  color: color().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  wrap: z.boolean().optional(),
  lineHeight: z.number().positive().optional(),
  stroke: color().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  fill: color().optional(),
  radius: z.number().nonnegative().optional(),
  padding: z.number().nonnegative().optional(),
});
export type StyleOverride = z.infer<typeof StyleOverrideSchema>;

/** base 위에 overrides를 순서대로 얹는다. undefined 값은 덮어쓰지 않는다 */
export function mergeStyle(base: Style, ...overrides: (StyleOverride | undefined)[]): Style {
  const out: Style = { ...base };
  for (const o of overrides) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
