import { z } from "zod";

/** 라벨 프린터 출력 설정 (스펙 4.1). darkness·speed·copies는 프린터 명령으로만 나가고 레이아웃에 영향이 없다 */
export const LabelOutputSchema = z.object({
  language: z.enum(["zpl", "tspl"]),
  dpi: z.union([z.literal(203), z.literal(300)]),
  threshold: z.number().int().min(0).max(255).default(128),   // 회색조가 이 값 미만이면 검정
  darkness: z.number().int().min(0).max(30).optional(),        // ~SD / DENSITY
  speed: z.number().int().min(1).max(14).optional(),           // ^PR / SPEED
  copies: z.number().int().positive().default(1),              // 라벨 한 장당 인쇄 매수 (^PQ / PRINT 1,n)
});
export const OutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf") }),
  z.object({ kind: z.literal("label"), label: LabelOutputSchema }),
]);
export type LabelOutput = z.infer<typeof LabelOutputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export const DEFAULT_OUTPUT: Output = { kind: "pdf" };
