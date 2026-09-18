import type { LlmClient, LlmInput } from "./types";

type Script = unknown | unknown[] | ((input: LlmInput) => unknown);

/**
 * 테스트용 가짜 LLM 클라이언트.
 * - 배열 스크립트: 순서대로 소비하고, 소진되면 에러
 * - 함수 스크립트: 매 호출마다 실행(반환값을 결과로, 던지면 그대로 던짐)
 * - 그 밖의 값: 매 호출마다 같은 값을 반환
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: LlmInput[] = [];
  private readonly script: Script;
  private cursor = 0;

  // 오버로드로 선언해야 함수 스크립트를 넘길 때 매개변수 타입(LlmInput)이 문맥적으로 추론된다
  constructor(script: (input: LlmInput) => unknown);
  constructor(script: unknown[]);
  constructor(script: unknown);
  constructor(script: Script) {
    this.script = script;
  }

  async complete(input: LlmInput): Promise<unknown> {
    this.calls.push(input);
    if (typeof this.script === "function") {
      return (this.script as (i: LlmInput) => unknown)(input);
    }
    if (Array.isArray(this.script)) {
      if (this.cursor >= this.script.length) throw new Error("스크립트가 소진되었습니다");
      return this.script[this.cursor++];
    }
    return this.script;
  }
}
