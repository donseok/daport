import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { inferFields, type Report } from "@daport/core";
import { createGeminiClient, LlmError, AiValidationError, type LlmClient, type LlmInput, type EditContext, type ChatTurn, type LibraryItem } from "@daport/ai";
import { FakeLlmClient } from "@daport/ai/testing";
import { getComponentStore } from "./component-store";

const holder = globalThis as typeof globalThis & { __daportLlm?: LlmClient | null };

/** AI_FAKE=1이면 E2E용 가짜, 키가 없으면 null(라우트가 503). 프로덕션에서는 AI_FAKE를 무시한다(E2E는 `pnpm dev`로 돌아 NODE_ENV가 production이 아니다) */
export function getLlmClient(): LlmClient | null {
  if (holder.__daportLlm !== undefined) return holder.__daportLlm;
  if (process.env.AI_FAKE === "1") {
    if (process.env.NODE_ENV !== "production") return (holder.__daportLlm = new FakeLlmClient(fakeScript));
    console.warn("[ai] AI_FAKE는 프로덕션에서 무시됩니다");
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;   // 캐시하지 않는다 — 키를 넣고 재시작 없이 붙게 하려면 다음 요청에서 다시 본다
  return (holder.__daportLlm = createGeminiClient({ apiKey, model: process.env.GEMINI_MODEL || "gemini-3.8-flash", timeoutMs: Number(process.env.AI_TIMEOUT_MS) > 0 ? Number(process.env.AI_TIMEOUT_MS) : 60_000 }));
}

const STATUS: Record<string, [number, string]> = {
  LLM_NOT_CONFIGURED: [503, "AI_NOT_CONFIGURED"], LLM_RATE_LIMIT: [429, "AI_RATE_LIMIT"], LLM_TIMEOUT: [504, "AI_TIMEOUT"],
  LLM_BAD_OUTPUT: [502, "AI_BAD_OUTPUT"], LLM_ERROR: [502, "AI_ERROR"],
};

/** 오류 → 응답 (스펙 8장). 프롬프트·원응답은 본문에 넣지 않는다 */
export function aiErrorResponse(e: unknown): NextResponse {
  if (e instanceof AiValidationError) return NextResponse.json({ error: e.message, code: "AI_INVALID_PATCH" }, { status: 400 });
  if (e instanceof LlmError) {
    const [status, code] = STATUS[e.code];
    // LLM_ERROR만 provider(Gemini) 원문 메시지를 담고 있다 — 요청 필드·모델명·리전 같은 내부 정보가
    // 섞여 나올 수 있어 그대로 내보내지 않는다(스펙 8: "502 사유 문구만"). 상세는 서버 로그로만 남긴다
    const message = e.code === "LLM_ERROR" ? "AI 모델 호출 중 오류가 발생했습니다" : e.message;
    if (e.code === "LLM_ERROR") console.warn("[ai] LLM_ERROR", e.message);
    const res = NextResponse.json({ error: message, code }, { status });
    if (e.retryAfterMs) res.headers.set("retry-after", String(Math.ceil(e.retryAfterMs / 1000)));
    return res;
  }
  // report 파싱 실패(ZodError)는 원문 zod 덤프 없이 일반 400으로 돌려준다
  if (e instanceof ZodError) return NextResponse.json({ error: "report가 스키마에 맞지 않습니다" }, { status: 400 });
  console.warn("[ai] 예기치 않은 오류", e);
  return NextResponse.json({ error: "AI 요청을 처리하지 못했습니다", code: "AI_ERROR" }, { status: 502 });
}

/** 프롬프트 컨텍스트 (스펙 4.3). sample.data의 값은 넣지 않고 필드 이름·타입만 */
export async function buildContext(report: Report, selection: string[], history: ChatTurn[]): Promise<EditContext> {
  const fields: EditContext["fields"] = {};
  for (const ds of report.datasets) {
    const rows = report.sample?.data?.[ds.name] ?? (ds.type === "static" ? ds.rows : []);
    fields[ds.name] = inferFields(rows);
  }
  const library: LibraryItem[] = [];
  const store = getComponentStore();
  for (const s of await store.list()) {
    const v = await store.getVersion(s.id, s.latestVersion);
    if (v) library.push({ id: s.id, name: s.name, version: s.latestVersion, w: v.body.w, h: v.body.h, props: v.body.props.map((p) => ({ name: p.name, type: p.type })) });
  }
  return { report, selection, fields, library, history: history.slice(-6) };
}

/** E2E용 가짜 응답: 마지막 사용자 메시지의 지시 부분 키워드로 고정 결과를 낸다 */
export function fakeScript(input: LlmInput): unknown {
  const text = input.messages.at(-1)?.text ?? "";
  const instruction = text.slice(text.lastIndexOf("# 지시") + 5);
  if (input.system.includes("elements 배열")) {   // 생성 프롬프트
    return { elements: [
      JSON.stringify({ id: "text-1", type: "text", x: 10, y: 10, w: 120, h: 12, value: "품질보증서" }),
      JSON.stringify({ id: "rect-1", type: "rect", x: 10, y: 30, w: 190, h: 60 }),
    ], explanation: "제목과 본문 영역을 만들었습니다" };
  }
  if (instruction.includes("금지")) return { patch: [{ op: "replace", path: "/output/kind", value: JSON.stringify("label") }, { op: "replace", path: "/name", value: JSON.stringify("AI 수정") }], explanation: "이름을 바꿨습니다" };
  const m = /'([^']+)'/.exec(instruction);
  return { patch: [{ op: "replace", path: "/elements/0/value", value: JSON.stringify(m?.[1] ?? "AI 제목") }], explanation: "첫 요소의 값을 바꿨습니다" };
}
