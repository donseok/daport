import { GoogleGenAI } from "@google/genai";
import { LlmError, MAX_OUTPUT_TOKENS, type LlmClient, type LlmInput } from "./types";

const mask = (s: string, key: string) => (key ? s.split(key).join("***") : s);
const RETRY_NOTE = "직전 응답이 JSON 형식에 맞지 않았습니다. 지정한 스키마에 맞는 JSON 하나만 다시 출력하세요.";

function toLlmError(e: unknown, key: string): LlmError {
  if (e instanceof LlmError) return e;
  const status = (e as { status?: number } | null)?.status;
  const name = (e as { name?: string } | null)?.name;
  const message = mask(e instanceof Error ? e.message : String(e), key);
  if (name === "AbortError" || name === "TimeoutError") return new LlmError("LLM_TIMEOUT", "모델 응답 시간이 초과되었습니다");
  if (status === 429) return new LlmError("LLM_RATE_LIMIT", "모델 요청 한도를 넘었습니다");
  if (status === 401 || status === 403) return new LlmError("LLM_NOT_CONFIGURED", "Gemini API 키가 거부되었습니다");
  return new LlmError("LLM_ERROR", message);
}

/** Gemini 구조화 출력 클라이언트 (스펙 5.2). 형식이 틀린 응답은 한 번만 다시 요청한다 */
export function createGeminiClient(opts: { apiKey: string; model: string; timeoutMs?: number }): LlmClient {
  if (!opts.apiKey) throw new LlmError("LLM_NOT_CONFIGURED", "GEMINI_API_KEY가 설정되지 않았습니다");
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  // 한 요청 안에서 재시도 두 번이 이 신호 하나를 나눠 쓴다 — 매 호출마다 새로 만들면 마감이 2배가 된다(스펙 8: 60s → AI_TIMEOUT)
  const call = async (input: LlmInput, contents: { role: string; parts: { text: string }[] }[], signal: AbortSignal): Promise<string> => {
    try {
      const res = await ai.models.generateContent({
        model: opts.model,
        contents,
        config: { systemInstruction: input.system, responseMimeType: "application/json", responseSchema: input.schema, temperature: 0.2, maxOutputTokens: input.maxOutputTokens ?? MAX_OUTPUT_TOKENS, abortSignal: signal },
      });
      return res.text ?? "";
    } catch (e) {
      throw toLlmError(e, opts.apiKey);
    }
  };
  const parse = (text: string): { ok: true; value: unknown } | { ok: false } => {
    if (!text.trim()) return { ok: false };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false };
    }
  };
  return {
    async complete(input) {
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const contents = input.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
      const first = parse(await call(input, contents, signal));
      if (first.ok) return first.value;
      const second = parse(await call(input, [...contents, { role: "user", parts: [{ text: RETRY_NOTE }] }], signal));
      if (second.ok) return second.value;
      throw new LlmError("LLM_BAD_OUTPUT", "모델 응답이 JSON 형식이 아닙니다");
    },
  };
}
