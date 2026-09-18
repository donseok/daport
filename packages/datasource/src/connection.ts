import { z } from "zod";

/** 연결 이름: 레포트의 sql 데이터셋이 참조한다. 소문자·숫자·하이픈 */
const ConnectionName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "연결 이름은 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다");
/** DAPORT_SECRET_<이름>의 이름 부분 */
const SecretRef = z.string().regex(/^[A-Z0-9_]+$/, "비밀값 이름은 대문자·숫자·_만 쓸 수 있습니다");

/** 에이전트 URL은 https만. http는 로컬 개발(localhost·127.0.0.1)에서만 허용한다 */
export function assertAgentUrl(url: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("에이전트 URL이 올바르지 않습니다"); }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return;
  throw new Error("에이전트 URL은 https여야 합니다 (http는 localhost만)");
}

export const ConnectionSchema = z.discriminatedUnion("via", [
  z.object({
    name: ConnectionName, via: z.literal("direct"),
    host: z.string().min(1), port: z.number().int().min(1).max(65535).default(1521),
    service: z.string().min(1), user: z.string().min(1), secretRef: SecretRef,
  }),
  z.object({
    name: ConnectionName, via: z.literal("agent"),
    url: z.string().url().refine((u) => { try { assertAgentUrl(u); return true; } catch { return false; } }, "에이전트 URL은 https여야 합니다 (http는 localhost만)"),
    secretRef: SecretRef,
  }),
]);
export type Connection = z.infer<typeof ConnectionSchema>;
export type DirectConnection = Extract<Connection, { via: "direct" }>;
export type AgentConnection = Extract<Connection, { via: "agent" }>;
export const parseConnection = (input: unknown): Connection => ConnectionSchema.parse(input);
