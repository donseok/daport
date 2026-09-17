import { z } from "zod";
import { PageSchema } from "./report";
import { OutputSchema } from "./output";

/** 페이지 크기 + 출력 설정 묶음 (스펙 4.3). 내장 프리셋은 코드 상수, 사용자 정의는 스튜디오 저장소 */
export const PresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다"),
  name: z.string().min(1),
  page: PageSchema,
  output: OutputSchema.default({ kind: "pdf" }),
  builtin: z.boolean().default(false),
});
export type Preset = z.infer<typeof PresetSchema>;
export type PresetInput = z.input<typeof PresetSchema>;
