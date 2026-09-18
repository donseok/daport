import type { Report, FieldNode } from "@daport/core";

export type LlmErrorCode = "LLM_NOT_CONFIGURED" | "LLM_TIMEOUT" | "LLM_RATE_LIMIT" | "LLM_BAD_OUTPUT" | "LLM_ERROR";

/** LLM 호출 실패를 나타낸다. code로 재시도·안내 분기를 결정한다 */
export class LlmError extends Error {
  constructor(readonly code: LlmErrorCode, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "LlmError";
  }
}

/** 모델이 만든 패치가 문서 검증을 통과하지 못했을 때 던진다 */
export class AiValidationError extends Error {
  readonly code = "AI_INVALID_PATCH";
  constructor(message: string) {
    super(message);
    this.name = "AiValidationError";
  }
}

export type LlmInput = {
  system: string;
  messages: { role: "user" | "model"; text: string }[];
  schema: object;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export interface LlmClient {
  complete(input: LlmInput): Promise<unknown>;
}

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type LibraryItem = { id: string; name: string; version: number; w: number; h: number; props: { name: string; type: string }[] };

export type EditContext = {
  report: Report;
  selection: string[];
  fields: Record<string, FieldNode[]>;
  library: LibraryItem[];
  history: ChatTurn[];
};

export const MAX_CONTEXT_TOKENS = 60_000;
export const MAX_INSTRUCTION_CHARS = 2_000;
export const MAX_BRIEF_CHARS = 4_000;
export const MAX_OUTPUT_TOKENS = 8_192;
