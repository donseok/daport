# daport 5단계 구현 플랜: AI 자연어 편집·페이지 생성

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자연어 지시로 레포트를 고치고 빈 레포트에서 페이지를 생성한다. AI는 검증된 JSON Patch(또는 요소 목록)만 내놓고, 사용자가 "적용"을 누르기 전까지 모델은 바뀌지 않는다.

**Architecture:** 새 패키지 `packages/ai`가 순수 부분(프롬프트 조립·응답 검증·`LlmClient` 인터페이스)과 Gemini 어댑터·가짜 클라이언트를 갖는다. studio는 두 라우트(`ai/edit`, `ai/generate`), 스토어의 `proposal` 상태, 하단 AI 탭, 캔버스 제안 오버레이를 더한다. 실제 LLM 없이 전 경로가 테스트된다.

**Tech Stack:** TypeScript, zod 4, `fast-json-patch`, `@google/genai`(Gemini `gemini-3.8-flash`), React 19 / Next.js 16, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-daport-phase5-ai-editing-design.md` (승인됨). 플랜이 스펙을 구체화한 곳(T1의 `compactReport`·`summarizeSchema` 함수 경계, T2의 `value` JSON 문자열 규약 적용 지점, T5의 `changedIds` 계산, T6의 오버레이 렌더 방식)은 각 태스크에 적었다.

## Global Constraints

- 의존 방향: `ai → core, fast-json-patch, @google/genai`. `ai`는 renderer·datasource·studio·browser를 import하지 않는다. `studio → ai`.
- 새 외부 의존은 `@google/genai`(ai) 하나. 루트 `pnpm install`은 **T1에서 한 번만** 실행한다.
- API 키는 서버 환경변수 `GEMINI_API_KEY`에서만 읽는다. 프롬프트 원문·모델 원응답·키는 HTTP 응답에 넣지 않는다(서버 로그에 원응답 앞 500자, 키는 `***`).
- 사용자 모델은 "적용" 전까지 바뀌지 않는다. 제안은 히스토리 밖 `proposal` 상태로만 존재하고 저장에 포함되지 않는다. 적용은 되돌리기 1단위.
- 허용 경로: `/elements/**`, `/page/**`, `/params/**`, `/datasets/**`, `/name`. 금지: `/id`, `/version`, `/components/**`, `/sample/**`, `/output/**`, `/repeat/**`. 금지 op는 제거하고 경고(전체 거부 아님).
- 한도: 지시문 2,000자, brief 4,000자, 컨텍스트 추정 60,000토큰(`ceil(chars/3)`), LLM 타임아웃 60초.
- 오류 코드(스펙 8장): `AI_NOT_CONFIGURED`(503), `AI_RATE_LIMIT`(429), `AI_TIMEOUT`(504), `AI_BAD_OUTPUT`(502), `AI_ERROR`(502), `AI_INVALID_PATCH`(400), `AI_NOT_EMPTY`(400), `AI_INPUT_TOO_LONG`(400).
- 기본 `pnpm test`는 `GEMINI_API_KEY` 없이 통과한다. 실제 호출 테스트는 `GEMINI_IT=1`일 때만 수집한다.
- 한글 주석·UI 문구, 영문 식별자. 커밋 제목 `type(pkg): …` 한글, 모든 커밋 메시지는 정확히 이 트레일러로 끝난다: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. `git -c core.hooksPath=/dev/null commit`, 파일 경로로만 스테이징.
- vitest 주의: `beforeEach(() => mock.mockReset())`처럼 mock을 반환하는 화살표 본문은 cleanup 훅으로 오인된다 — 블록 본문을 쓴다.
- Next 라우트 파일은 HTTP 메서드와 설정만 export한다. 헬퍼는 `src/lib/`.
- 텍스트 요소의 값 필드는 `value`다(`text` 아님). 컴포넌트 참조 요소는 `ref`.

## 파일 구조

```
packages/ai/{package.json,tsconfig.json,vitest.config.ts,vitest.it.config.ts,README.md}                (T1, T3, T8)
packages/ai/src/types.ts            LlmClient, LlmError, AiValidationError, ChatTurn, LibraryItem, 상수  (T1)
packages/ai/src/testing.ts          FakeLlmClient                                                       (T1)
packages/ai/src/schema-summary.ts   summarizeSchema(reportJsonSchema())                                 (T1)
packages/ai/src/compact.ts          compactReport, compactFields, compactLibrary, estimateTokens        (T1)
packages/ai/src/prompts/{edit.ko.ts,generate.ko.ts}, prompt.ts  buildEditPrompt/buildGeneratePrompt     (T2)
packages/ai/src/response-schema.ts  EDIT_RESPONSE_SCHEMA, GENERATE_RESPONSE_SCHEMA                      (T2)
packages/ai/src/validate.ts         validateEditPatch, validateGenerated                                (T3)
packages/ai/src/gemini.ts           createGeminiClient                                                  (T4)
packages/ai/src/__it__/gemini.it.test.ts                                                                (T4)
apps/studio/src/lib/ai.ts           getLlmClient, buildContext                                          (T5)
apps/studio/src/app/api/reports/[id]/ai/{edit,generate}/route.ts                                        (T5)
apps/studio/src/editor/store.ts     proposal 상태·setProposal·applyProposal·rejectProposal              (T6)
apps/studio/src/editor/ai/AiPanel.tsx, api.ts                                                           (T7)
apps/studio/src/editor/Editor.tsx   AI 탭                                                               (T7)
apps/studio/src/editor/canvas/Canvas.tsx  제안 오버레이·바                                               (T6)
apps/studio/e2e/phase5.spec.ts, playwright.config.ts, .env.example                                      (T8)
```

## 태스크 순서

T1(ai 골격·타입·압축·가짜, 단일 install) → T2(프롬프트·응답 스키마) → T3(검증기) → T4(Gemini 어댑터·IT) → T5(studio 라우트) → T6(스토어 proposal·캔버스 오버레이) → T7(AI 탭) → T8(E2E·환경·README). T4와 T5는 서로 다른 패키지라 T3 이후 동시 가능하지만, T5가 T4의 `createGeminiClient`를 import하므로 **T4 → T5 순서**로 둔다.

---

### Task 1: `packages/ai` 골격, 타입, 컨텍스트 압축, 가짜 클라이언트 (단일 install)

**Files:**
- Create: `packages/ai/package.json`, `packages/ai/tsconfig.json`, `packages/ai/vitest.config.ts`, `packages/ai/src/index.ts`, `packages/ai/src/types.ts`, `packages/ai/src/testing.ts`, `packages/ai/src/schema-summary.ts`, `packages/ai/src/compact.ts`
- Test: `packages/ai/src/__tests__/compact.test.ts`, `packages/ai/src/__tests__/schema-summary.test.ts`, `packages/ai/src/__tests__/testing.test.ts`

**Interfaces:**
- Consumes: core `reportJsonSchema`, `walkElements`, `parseReport`, 타입 `Report`/`Element`/`FieldNode`/`ComponentBody`.
- Produces:
```ts
// types.ts
export type LlmErrorCode = "LLM_NOT_CONFIGURED" | "LLM_TIMEOUT" | "LLM_RATE_LIMIT" | "LLM_BAD_OUTPUT" | "LLM_ERROR";
export class LlmError extends Error { constructor(readonly code: LlmErrorCode, message: string, readonly retryAfterMs?: number) }
export class AiValidationError extends Error { readonly code = "AI_INVALID_PATCH" }
export type LlmInput = { system: string; messages: { role: "user" | "model"; text: string }[]; schema: object; maxOutputTokens?: number; signal?: AbortSignal };
export interface LlmClient { complete(input: LlmInput): Promise<unknown> }
export type ChatTurn = { role: "user" | "assistant"; text: string };
export type LibraryItem = { id: string; name: string; version: number; w: number; h: number; props: { name: string; type: string }[] };
export type EditContext = { report: Report; selection: string[]; fields: Record<string, FieldNode[]>; library: LibraryItem[]; history: ChatTurn[] };
export const MAX_CONTEXT_TOKENS = 60_000, MAX_INSTRUCTION_CHARS = 2_000, MAX_BRIEF_CHARS = 4_000, MAX_OUTPUT_TOKENS = 8_192;
// compact.ts
export function estimateTokens(text: string): number;                  // ceil(chars/3)
export function compactReport(report: Report, opts?: { text?: number; depth?: number }): string;
export function compactFields(fields: Record<string, FieldNode[]>): string;
export function compactLibrary(library: LibraryItem[]): string;
// schema-summary.ts
export function summarizeSchema(): string;                             // reportJsonSchema()에서 요소 타입별 필수 필드·열거값
// testing.ts
export class FakeLlmClient implements LlmClient { constructor(script: unknown | unknown[] | ((i: LlmInput) => unknown)); readonly calls: LlmInput[] }
```
- 스펙 구체화: 압축 형식은 한 요소당 한 줄 `id type x,y w×h "값…" [자식 n]`, 필드는 `ds.PATH: type`, 라이브러리는 `id name w×h props(name:type)`. 이 형식이 T2 프롬프트와 T3 테스트의 기준이다.

- [ ] **Step 1: 골격과 단일 install**

`packages/ai/package.json`:
```json
{
  "name": "@daport/ai",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" },
  "scripts": { "build": "tsc -p tsconfig.json --noEmit", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run", "test:it": "GEMINI_IT=1 vitest run --config vitest.it.config.ts" },
  "dependencies": { "@daport/core": "workspace:*", "@google/genai": "^1.0.0", "fast-json-patch": "^3.1.1" }
}
```
`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.
`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
// 기본 실행은 실제 Gemini 호출 없이 돈다. __it__는 vitest.it.config.ts로만 수집한다
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["src/__it__/**"] } });
```
루트에서 **`pnpm install` 한 번**. `@google/genai`의 최신 메이저가 1.x가 아니면 `pnpm view @google/genai version`으로 확인해 맞추고 보고한다.

- [ ] **Step 2: 실패 테스트 작성**

`packages/ai/src/__tests__/compact.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { compactReport, compactFields, compactLibrary, estimateTokens } from "../index";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 210, height: 297 }, elements: [
  { id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "품질보증서 " + "가".repeat(60) },
  { id: "g1", type: "group", x: 0, y: 30, w: 100, h: 40, children: [{ id: "r1", type: "rect", x: 1, y: 1, w: 10, h: 10 }] },
  { id: "tb", type: "table", x: 10, y: 80, w: 190, h: 60, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
]});

describe("compactReport", () => {
  it("writes one line per element with id, type, box and truncated value", () => {
    const out = compactReport(report);
    const lines = out.trim().split("\n");
    expect(lines[0]).toMatch(/^t1 text 10,10 80×8 "품질보증서/);
    expect(lines[0].length).toBeLessThan(80);                       // 값은 40자로 자른다
    expect(out).toContain("g1 group 0,30 100×40 [자식 1]");
    expect(out).toContain("  r1 rect 1,1 10×10");                   // 자식은 들여쓰기
    expect(out).toContain("tb table 10,80 190×60 source=items 열 1");
  });
  it("drops children below the depth limit", () => {
    expect(compactReport(report, { depth: 0 })).not.toContain("r1 rect");
  });
});

describe("compactFields / compactLibrary / estimateTokens", () => {
  it("formats fields as ds.PATH: type and library items in one line", () => {
    expect(compactFields({ items: [{ name: "NO", path: "NO", type: "string" }, { name: "QTY", path: "QTY", type: "number" }] }))
      .toBe("items.NO: string\nitems.QTY: number");
    expect(compactLibrary([{ id: "header", name: "회사 헤더", version: 3, w: 190, h: 20, props: [{ name: "title", type: "text" }] }]))
      .toBe("header 회사 헤더 v3 190×20 props(title:text)");
  });
  it("estimateTokens is ceil(chars/3)", () => {
    expect(estimateTokens("abcdef")).toBe(2);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
```

`packages/ai/src/__tests__/schema-summary.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { summarizeSchema } from "../index";

describe("summarizeSchema", () => {
  it("lists every element type with its required fields, derived from the real schema", () => {
    const s = summarizeSchema();
    for (const t of ["text", "rect", "line", "image", "table", "repeater", "barcode", "ref", "group", "pageNumber"]) {
      expect(s).toContain(t);
    }
    expect(s).toMatch(/text: [^\n]*value/);
    expect(s).toMatch(/table: [^\n]*source/);
    expect(s).toMatch(/ref: [^\n]*component|ref: [^\n]*ref/);      // 실제 필드 이름에 맞춘다
    expect(s.length).toBeLessThan(6_000);                           // 프롬프트에 들어갈 만큼 짧다
  });
});
```

`packages/ai/src/__tests__/testing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FakeLlmClient } from "../testing";

describe("FakeLlmClient", () => {
  it("returns scripted values in order, records calls and supports a function script", async () => {
    const f = new FakeLlmClient([{ a: 1 }, { b: 2 }]);
    expect(await f.complete({ system: "s", messages: [{ role: "user", text: "u" }], schema: {} })).toEqual({ a: 1 });
    expect(await f.complete({ system: "s", messages: [], schema: {} })).toEqual({ b: 2 });
    await expect(f.complete({ system: "s", messages: [], schema: {} })).rejects.toThrow(/스크립트/);
    expect(f.calls).toHaveLength(3);
    const g = new FakeLlmClient((i) => ({ echo: i.messages.at(-1)?.text }));
    expect(await g.complete({ system: "", messages: [{ role: "user", text: "hi" }], schema: {} })).toEqual({ echo: "hi" });
  });
  it("throws what the script throws", async () => {
    const boom = new Error("boom");
    await expect(new FakeLlmClient(() => { throw boom; }).complete({ system: "", messages: [], schema: {} })).rejects.toBe(boom);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/ai test`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`packages/ai/src/types.ts`: 위 Interfaces의 타입·클래스·상수를 그대로. `LlmError`·`AiValidationError`는 `name`을 클래스 이름으로 설정한다.

`packages/ai/src/compact.ts`:
```ts
import { walkElements, type Element, type FieldNode, type Report } from "@daport/core";
import type { LibraryItem } from "./types";

/** 대략적인 토큰 수. 정확할 필요는 없고 잘라내기 판단에만 쓴다 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 요소 한 줄: id type x,y w×h [타입별 핵심] */
function line(el: Element, textLimit: number): string {
  const head = `${el.id} ${el.type} ${el.x},${el.y} ${el.w}×${el.h}`;
  switch (el.type) {
    case "text": return `${head} "${trunc(el.value, textLimit)}"`;
    case "image": return `${head} src=${trunc(el.src, 40)}`;
    case "table": return `${head} source=${el.source} 열 ${el.columns.length}`;
    case "repeater": return `${head} source=${el.source} ${el.layout}`;
    case "barcode": return `${head} ${el.format} "${trunc(el.value, textLimit)}"`;
    case "ref": return `${head} ${el.ref}@${el.version}`;
    case "group": return `${head} [자식 ${el.children.length}]`;
    default: return head;
  }
}

/** 모델의 요소 트리를 한 줄씩 압축한다. depth 아래 자식은 생략한다 (컨텍스트 절약) */
export function compactReport(report: Report, opts: { text?: number; depth?: number } = {}): string {
  const textLimit = opts.text ?? 40, maxDepth = opts.depth ?? 3;
  const out: string[] = [`page ${report.page.width}×${report.page.height}mm margin ${report.page.margin.join(",")}`];
  const walk = (els: Element[], depth: number) => {
    for (const el of els) {
      out.push(`${"  ".repeat(depth)}${line(el, textLimit)}`);
      if (depth >= maxDepth) continue;
      if (el.type === "group") walk(el.children, depth + 1);
      if (el.type === "repeater") walk(el.item.children, depth + 1);
    }
  };
  walk(report.elements, 0);
  return out.join("\n");
}

export const compactFields = (fields: Record<string, FieldNode[]>): string =>
  Object.entries(fields).flatMap(([ds, nodes]) => nodes.map((n) => `${ds}.${n.path}: ${n.type}`)).join("\n");

export const compactLibrary = (library: LibraryItem[]): string =>
  library.map((c) => `${c.id} ${c.name} v${c.version} ${c.w}×${c.h} props(${c.props.map((p) => `${p.name}:${p.type}`).join(", ")})`).join("\n");
```
(`el.ref`·`el.version`·`el.value` 같은 필드 이름은 `packages/core/src/schema/elements.ts`를 열어 실제 이름으로 맞춘다. `walkElements`를 쓰지 않고 직접 순회하는 이유는 들여쓰기 깊이가 필요해서다 — 주석으로 남긴다.)

`packages/ai/src/schema-summary.ts`: `reportJsonSchema()`를 읽어 `elements` 배열 항목의 `anyOf`/`oneOf`에서 타입별 `required`와 `enum`을 뽑아 `타입: 필수 필드(a, b, c) 열거(format: code128|ean13|…)` 형태의 여러 줄 문자열을 만든다. zod 4의 `toJSONSchema` 출력 모양을 실제로 찍어 보고 맞춘다(디스크리미네이티드 유니언이 `anyOf`로 나온다). 결과가 6,000자를 넘으면 열거값을 앞 8개까지만 남긴다.

`packages/ai/src/testing.ts`: 배열 스크립트는 순서대로 소비하고 소진되면 `Error("스크립트가 소진되었습니다")`; 함수 스크립트는 매번 호출; 단일 값은 매번 같은 값. `calls`에 입력을 그대로 기록한다.

`packages/ai/src/index.ts`: `export * from "./types"; export * from "./compact"; export * from "./schema-summary";` (testing은 서브패스로만).

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/ai pnpm-lock.yaml
git -c core.hooksPath=/dev/null commit -m "feat(ai): 패키지 골격, LLM 인터페이스, 컨텍스트 압축, 가짜 클라이언트

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 프롬프트 빌더와 응답 스키마

**Files:**
- Create: `packages/ai/src/prompts/edit.ko.ts`, `packages/ai/src/prompts/generate.ko.ts`, `packages/ai/src/prompt.ts`, `packages/ai/src/response-schema.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/__tests__/prompt.test.ts`

**Interfaces:**
- Consumes: T1 `compactReport`·`compactFields`·`compactLibrary`·`estimateTokens`·`summarizeSchema`·상수·`EditContext`.
- Produces:
```ts
export type PromptBundle = { system: string; messages: { role: "user" | "model"; text: string }[]; schema: object; truncated: string[] };
export function buildEditPrompt(ctx: EditContext, instruction: string): PromptBundle;
export function buildGeneratePrompt(ctx: Omit<EditContext, "selection" | "history">, brief: string): PromptBundle;
export const EDIT_RESPONSE_SCHEMA: object;      // { patch: [{ op, path, value?(JSON 문자열), from? }], explanation }
export const GENERATE_RESPONSE_SCHEMA: object;  // { elements: string[](각 요소의 JSON 문자열), explanation }
```
- 스펙 구체화: 프롬프트 본문은 `.md` 파일 대신 **`prompts/*.ts`의 템플릿 문자열 상수**로 둔다(번들러·Node 양쪽에서 import가 확실하고 테스트가 쉽다). 파일 상단에 `// prompt-version: 1` 주석을 단다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/ai/src/__tests__/prompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { buildEditPrompt, buildGeneratePrompt, EDIT_RESPONSE_SCHEMA, GENERATE_RESPONSE_SCHEMA, estimateTokens, MAX_CONTEXT_TOKENS } from "../index";

const base = { id: "r", name: "R", version: 1, page: { width: 210, height: 297 },
  params: [{ name: "lot", type: "string" }],
  elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "제목" }] };
const ctx = {
  report: parseReport(base),
  selection: ["t1"],
  fields: { items: [{ name: "NO", path: "NO", type: "string" as const }] },
  library: [{ id: "header", name: "회사 헤더", version: 2, w: 190, h: 20, props: [] }],
  history: [{ role: "user" as const, text: "이전 지시" }, { role: "assistant" as const, text: "이전 답" }],
};

describe("buildEditPrompt", () => {
  it("puts the rules in system and the context+instruction in the last user message", () => {
    const p = buildEditPrompt(ctx, "제목을 '검사 성적서'로 바꿔");
    expect(p.system).toContain("JSON Patch");
    expect(p.system).toContain("/elements");
    expect(p.system).toContain("/output");                       // 금지 경로 목록
    expect(p.system).toContain("text:");                          // 축약 스키마가 들어 있다
    const last = p.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.text).toContain("t1 text 10,10 80×8");            // 압축된 모델
    expect(last.text).toContain("items.NO: string");
    expect(last.text).toContain("header 회사 헤더 v2");
    expect(last.text).toContain("선택: t1");
    expect(last.text).toContain("params: lot(string)");
    expect(last.text).toContain("제목을 '검사 성적서'로 바꿔");
    expect(p.messages.slice(0, -1).map((m) => m.role)).toEqual(["user", "model"]);   // 이력이 앞에
    expect(p.schema).toBe(EDIT_RESPONSE_SCHEMA);
    expect(p.truncated).toEqual([]);
  });
  it("truncates history first, then the element tree, and records what it cut", () => {
    const many = parseReport({ ...base, elements: Array.from({ length: 4_000 }, (_, i) => ({ id: `t${i}`, type: "text", x: 0, y: 0, w: 10, h: 5, value: "가".repeat(30) })) });
    const p = buildEditPrompt({ ...ctx, report: many, history: [{ role: "user", text: "가".repeat(5_000) }] }, "정리해");
    expect(p.truncated.length).toBeGreaterThan(0);
    expect(p.truncated).toContain("history");
    expect(estimateTokens(p.system + p.messages.map((m) => m.text).join(""))).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
  });
});

describe("buildGeneratePrompt", () => {
  it("asks for a full element list and carries the brief", () => {
    const p = buildGeneratePrompt({ report: parseReport({ ...base, elements: [] }), fields: ctx.fields, library: ctx.library }, "품질보증서: 헤더, 품목 표, 서명란");
    expect(p.system).toContain("elements");
    expect(p.system).toContain("라이브러리");                      // 컴포넌트 우선 사용 지시
    expect(p.messages.at(-1)!.text).toContain("품질보증서: 헤더, 품목 표, 서명란");
    expect(p.schema).toBe(GENERATE_RESPONSE_SCHEMA);
  });
});

describe("response schemas", () => {
  it("are Gemini-compatible: object/array/string only, no oneOf or $ref, value carried as a JSON string", () => {
    const json = JSON.stringify([EDIT_RESPONSE_SCHEMA, GENERATE_RESPONSE_SCHEMA]);
    expect(json).not.toContain("oneOf"); expect(json).not.toContain("$ref"); expect(json).not.toContain("anyOf");
    const patchItem = (EDIT_RESPONSE_SCHEMA as any).properties.patch.items;
    expect(patchItem.properties.value.type).toBe("string");
    expect(patchItem.properties.op.enum).toEqual(["add", "remove", "replace", "move", "copy"]);
    expect(patchItem.required).toEqual(["op", "path"]);
    expect((GENERATE_RESPONSE_SCHEMA as any).properties.elements.items.type).toBe("string");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/ai test -- prompt`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/ai/src/prompts/edit.ko.ts`(및 `generate.ko.ts`): `// prompt-version: 1` 주석 + `export const EDIT_SYSTEM = (schema: string) => \`…\`` 형태. 본문에 넣을 내용:
- 역할: "너는 daport 레포트 모델 편집기다. 사용자의 지시를 **RFC 6902 JSON Patch**로만 표현한다. 설명은 explanation에 한국어 한두 문장."
- 단위·좌표: mm, 좌상단 원점, `x,y`는 페이지 기준, 그룹 자식은 부모 기준.
- 표현식: `{{ }}` 안에 jexl. 예 `{{ params.lot }}`, `{{ row.QTY * 2 }}`, `{{ items.NO }}`.
- 허용 경로와 금지 경로 목록(Global Constraints 그대로), "금지 경로를 건드리면 그 op는 버려진다".
- 축약 스키마(`summarizeSchema()` 결과를 그대로 삽입).
- 규칙: 새 요소의 id는 `<type>-<n>` 형태로 제안, 기존 id와 겹치지 않게; 값은 `value` 필드에 넣고 `text` 같은 이름을 쓰지 말 것; 배열 끝에 추가할 때는 `/elements/-`; `value`는 **JSON 문자열**로 보낼 것(스키마 제약).
- generate 쪽 추가: "라이브러리에 맞는 컴포넌트가 있으면 `ref` 요소로 먼저 쓴다", "페이지 여백 안에 배치한다", "요소는 40개를 넘지 않게".

`packages/ai/src/response-schema.ts`: 위 테스트가 요구하는 구조를 그대로.

`packages/ai/src/prompt.ts`:
```ts
/** 컨텍스트가 상한을 넘으면 이력 → 요소 텍스트 → 트리 깊이 순으로 줄인다. 무엇을 줄였는지 truncated에 남긴다 */
function fit(parts: { system: string; history: ChatTurn[]; body: (opts: { text: number; depth: number }) => string }): { history: ChatTurn[]; body: string; truncated: string[] } { … }
```
단계: (1) 원본으로 계산 → 상한 이하면 그대로, (2) `history`를 비우고 `truncated.push("history")`, (3) `text` 한도를 40 → 16으로 낮추고 `truncated.push("element-text")`, (4) `depth` 3 → 1로 낮추고 `truncated.push("tree-depth")`, (5) 그래도 넘으면 요소 줄을 앞에서부터 300줄만 남기고 `truncated.push("elements")`.
사용자 메시지 본문 형식:
```
# 현재 모델
<compactReport>

# 데이터 필드
<compactFields 또는 "(없음)">

# 파라미터
lot(string), qty(number)

# 컴포넌트 라이브러리
<compactLibrary 또는 "(없음)">

# 선택
선택: t1, t2        ← 편집 프롬프트만

# 지시
<instruction>
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/ai/src
git -c core.hooksPath=/dev/null commit -m "feat(ai): 편집·생성 프롬프트 빌더와 Gemini 응답 스키마

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 응답 검증기

**Files:**
- Create: `packages/ai/src/validate.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: T1 타입, core `parseReport`·`walkElements`, `fast-json-patch`의 `applyPatch`·`deepClone`·`Operation`.
- Produces:
```ts
export const ALLOWED_PATHS = [/^\/elements(\/|$)/, /^\/page(\/|$)/, /^\/params(\/|$)/, /^\/datasets(\/|$)/, /^\/name$/];
export function validateEditPatch(report: Report, raw: unknown): { patch: Operation[]; warnings: string[]; next: Report };
export type LibraryLookup = (id: string) => Promise<{ version: number; body: ComponentBody } | null>;
export function validateGenerated(report: Report, raw: unknown, library: LibraryLookup): Promise<{ elements: Element[]; components: Record<string, ComponentBody>; warnings: string[] }>;
```

- [ ] **Step 1: 실패 테스트 작성**

`packages/ai/src/__tests__/validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, parseComponentBody } from "@daport/core";
import { validateEditPatch, validateGenerated, AiValidationError } from "../index";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 210, height: 297 },
  elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "제목" }] });
const raw = (patch: unknown[], explanation = "x") => ({ patch, explanation });
const op = (o: string, path: string, value?: unknown) => ({ op: o, path, ...(value === undefined ? {} : { value: JSON.stringify(value) }) });

describe("validateEditPatch", () => {
  it("applies an allowed patch, parses JSON-string values and returns the next report", () => {
    const res = validateEditPatch(report, raw([op("replace", "/elements/0/value", "검사 성적서"), op("replace", "/page/width", 297)]));
    expect(res.warnings).toEqual([]);
    expect(res.next.elements[0]).toMatchObject({ value: "검사 성적서" });
    expect(res.next.page.width).toBe(297);
    expect(report.elements[0].value).toBe("제목");                 // 원본 불변
    expect(res.patch).toHaveLength(2);
  });
  it("drops forbidden paths with a warning and keeps the rest", () => {
    const res = validateEditPatch(report, raw([
      op("replace", "/id", "hacked"), op("replace", "/output/kind", "label"), op("add", "/components/x@1", {}),
      op("replace", "/sample/params/lot", "L"), op("replace", "/elements/0/w", 90),
    ]));
    expect(res.patch).toHaveLength(1);
    expect(res.next.elements[0].w).toBe(90);
    expect(res.next.id).toBe("r");
    expect(res.warnings.join(" ")).toMatch(/\/id/);
    expect(res.warnings).toHaveLength(4);
  });
  it("drops an op that cannot be applied and keeps going", () => {
    const res = validateEditPatch(report, raw([op("replace", "/elements/9/value", "x"), op("replace", "/elements/0/value", "ok")]));
    expect(res.next.elements[0].value).toBe("ok");
    expect(res.warnings.some((w) => w.includes("/elements/9/value"))).toBe(true);
  });
  it("renames a new element whose id collides, in the value and in later ops", () => {
    const res = validateEditPatch(report, raw([
      op("add", "/elements/-", { id: "t1", type: "text", x: 0, y: 0, w: 10, h: 5, value: "새 텍스트" }),
      op("replace", "/elements/1/w", 20),
    ]));
    const added = res.next.elements[1] as { id: string; w: number };
    expect(added.id).not.toBe("t1");
    expect(added.id).toMatch(/^text-\d+$/);
    expect(added.w).toBe(20);
  });
  it("throws AiValidationError when the result fails the schema, and for a malformed response", () => {
    expect(() => validateEditPatch(report, raw([op("replace", "/elements/0/w", -5)]))).toThrow(AiValidationError);
    expect(() => validateEditPatch(report, raw([{ op: "frobnicate", path: "/elements/0" }]))).toThrow(AiValidationError);
    expect(() => validateEditPatch(report, { explanation: "x" })).toThrow(AiValidationError);
    expect(() => validateEditPatch(report, raw([op("replace", "/elements/0/value", undefined)]))).toThrow(AiValidationError);   // value 없는 replace
  });
});

describe("validateGenerated", () => {
  const empty = parseReport({ id: "e", version: 1, page: { width: 210, height: 297 } });
  const body = parseComponentBody({ name: "회사 헤더", w: 190, h: 20, props: [], elements: [{ id: "h", type: "text", x: 0, y: 0, w: 190, h: 20, value: "회사" }] });
  const lookup = async (id: string) => (id === "header" ? { version: 3, body } : null);
  const gen = (elements: unknown[]) => ({ elements: elements.map((e) => JSON.stringify(e)), explanation: "x" });

  it("parses elements, fills components for refs at the latest version and clamps to the page", async () => {
    const res = await validateGenerated(empty, gen([
      { id: "hd", type: "ref", x: 10, y: 10, w: 190, h: 20, ref: "header", version: 1, props: {} },
      { id: "t1", type: "text", x: 200, y: 10, w: 80, h: 8, value: "제목" },
    ]), lookup);
    expect(res.elements[0]).toMatchObject({ ref: "header", version: 3 });
    expect(res.components["header@3"]).toBeTruthy();
    expect(res.elements[1].x + res.elements[1].w).toBeLessThanOrEqual(210);
    expect(res.warnings.join(" ")).toMatch(/header/);
    expect(res.warnings.join(" ")).toMatch(/t1/);
  });
  it("rejects a ref to an unknown component and a non-empty report", async () => {
    await expect(validateGenerated(empty, gen([{ id: "x", type: "ref", x: 0, y: 0, w: 10, h: 10, ref: "nope", version: 1, props: {} }]), lookup)).rejects.toThrow(AiValidationError);
    await expect(validateGenerated(empty, { elements: ["not json"], explanation: "" }, lookup)).rejects.toThrow(AiValidationError);
  });
});
```
(`ref` 요소의 실제 필드 이름은 `packages/core/src/schema/elements.ts`의 `RefElementSchema`를 열어 맞춘다 — 4b에서 `ref`·`version`·`props`로 확인됐다. 다르면 테스트와 구현을 실제 이름으로 함께 맞춘다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/ai test -- validate`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/ai/src/validate.ts` 핵심 흐름(편집):
1. `raw`가 `{ patch: unknown[] }`가 아니면 `AiValidationError("응답에 patch 배열이 없습니다")`.
2. 각 항목을 `Operation`으로 정규화: `op`가 허용 5종이 아니면 `AiValidationError`; `path`가 문자열이 아니면 같은 오류; `add`·`replace`·`test`는 `value` 필수 — 없으면 `AiValidationError`; `value`는 문자열이면 `JSON.parse`(실패 시 그 문자열 자체를 값으로 쓰지 말고 `AiValidationError`), 문자열이 아니면 그대로 쓴다(관대하게).
3. 허용 경로 필터: `ALLOWED_PATHS` 중 하나에 맞지 않으면 제거 + `warnings.push(\`금지된 경로라 건너뜀: ${path}\`)`.
4. id 재명명: `add` op의 `value.id`가 현재 모델이나 이미 추가된 id와 겹치면 `<type>-<n>`으로 바꾸고(모델 전체를 훑어 빈 번호), 같은 배열 인덱스를 가리키는 이후 op는 경로가 그대로여도 되므로 **경로 치환은 하지 않고** 값만 바꾼다(테스트의 `/elements/1/w`는 인덱스 기반이라 그대로 동작한다). 경고는 남기지 않고 설명에 맡긴다.
5. 적용: `applyPatch(deepClone(report), patch, /*validate*/ true, /*mutate*/ false)`를 try로 감싸고, 실패하면 오류가 가리키는 op(`e.index`)를 제거하고 재시도(최대 3회), 각 제거마다 `warnings.push(\`적용할 수 없어 건너뜀: ${path}\`)`. 3회를 넘으면 `AiValidationError`.
6. `parseReport(next)` — 실패는 `AiValidationError(zod 메시지 첫 3개)`.
7. `{ patch, warnings, next }` 반환.

생성 흐름: `elements` 각 항목을 `JSON.parse`(실패 → `AiValidationError`) → `ref` 요소는 `library(id)`로 최신 버전 조회(없으면 `AiValidationError`), `version`이 다르면 최신으로 바꾸고 경고 + `components[\`${id}@${v}\`] = body` → 각 요소를 페이지 안으로 클램프(`x = min(x, W - w)` 등, 음수는 0)하고 바뀌면 경고 → `parseReport({ ...report, elements, components })` → 실패는 `AiValidationError`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/ai/src
git -c core.hooksPath=/dev/null commit -m "feat(ai): 패치·생성 응답 검증기 (허용 경로, id 재명명, 페이지 클램프)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Gemini 어댑터와 선택 실행 통합 테스트

**Files:**
- Create: `packages/ai/src/gemini.ts`, `packages/ai/vitest.it.config.ts`, `packages/ai/src/__it__/gemini.it.test.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/__tests__/gemini.test.ts`

**Interfaces:**
- Consumes: T1 `LlmClient`·`LlmError`·`LlmInput`·`MAX_OUTPUT_TOKENS`; T2 `EDIT_RESPONSE_SCHEMA`(IT용); `@google/genai`.
- Produces: `createGeminiClient(opts: { apiKey: string; model: string; timeoutMs?: number }): LlmClient`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/ai/src/__tests__/gemini.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// SDK 경계에서 가짜로 바꾼다. 실제 호출은 __it__ (GEMINI_IT=1)
const generateContent = vi.fn();
const ctor = vi.fn();
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; constructor(o: unknown) { ctor(o); } } }));
const { createGeminiClient, LlmError } = await import("../index");

const input = { system: "SYS", messages: [{ role: "user" as const, text: "이전" }, { role: "model" as const, text: "답" }, { role: "user" as const, text: "지시" }], schema: { type: "object" } };
const client = () => createGeminiClient({ apiKey: "AIza-secret-key", model: "gemini-3.8-flash", timeoutMs: 1_000 });

beforeEach(() => { generateContent.mockReset(); ctor.mockReset(); });

describe("createGeminiClient", () => {
  it("sends system instruction, roles, JSON mime type, schema and low temperature; parses the JSON text", async () => {
    generateContent.mockResolvedValue({ text: '{"patch":[],"explanation":"ok"}' });
    expect(await client().complete(input)).toEqual({ patch: [], explanation: "ok" });
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "AIza-secret-key" }));
    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-3.8-flash");
    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "이전" }] }, { role: "model", parts: [{ text: "답" }] }, { role: "user", parts: [{ text: "지시" }] },
    ]);
    expect(req.config).toMatchObject({ systemInstruction: "SYS", responseMimeType: "application/json", responseSchema: { type: "object" }, temperature: 0.2, maxOutputTokens: 8192 });
    expect(req.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("retries once with a correction turn on unparseable output, then gives LLM_BAD_OUTPUT", async () => {
    generateContent.mockResolvedValueOnce({ text: "not json" }).mockResolvedValueOnce({ text: '{"a":1}' });
    expect(await client().complete(input)).toEqual({ a: 1 });
    expect(generateContent).toHaveBeenCalledTimes(2);
    const retry = generateContent.mock.calls[1][0].contents;
    expect(retry.at(-1).parts[0].text).toMatch(/형식/);
    generateContent.mockReset().mockResolvedValue({ text: "" });
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_BAD_OUTPUT" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("maps SDK errors by status and masks the api key", async () => {
    const err = (status: number, message = `status ${status} key=AIza-secret-key`) => Object.assign(new Error(message), { status });
    generateContent.mockRejectedValueOnce(err(429));
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_RATE_LIMIT" });
    generateContent.mockRejectedValueOnce(err(403));
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
    generateContent.mockRejectedValueOnce(err(500));
    const e = await client().complete(input).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError); expect(e.code).toBe("LLM_ERROR");
    expect(e.message).not.toContain("AIza-secret-key"); expect(e.message).toContain("***");
    generateContent.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });
  it("refuses to construct without an api key", () => {
    expect(() => createGeminiClient({ apiKey: "", model: "m" })).toThrow(expect.objectContaining({ code: "LLM_NOT_CONFIGURED" }));
  });
});
```

`packages/ai/vitest.it.config.ts`:
```ts
import { defineConfig } from "vitest/config";
// GEMINI_IT=1 GEMINI_API_KEY=... pnpm --filter @daport/ai test:it — 실제 Gemini API를 호출한다
export default defineConfig({ test: { include: ["src/__it__/**/*.it.test.ts"], testTimeout: 90_000 } });
```

`packages/ai/src/__it__/gemini.it.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { createGeminiClient, buildEditPrompt, validateEditPatch } from "../index";

const enabled = process.env.GEMINI_IT === "1" && !!process.env.GEMINI_API_KEY;

describe.skipIf(!enabled)("Gemini (real API)", () => {
  it("turns a short edit instruction into a valid patch", async () => {
    const client = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" });
    const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 210, height: 297 },
      elements: [{ id: "title", type: "text", x: 10, y: 10, w: 120, h: 10, value: "품질보증서" }] });
    const prompt = buildEditPrompt({ report, selection: ["title"], fields: {}, library: [], history: [] }, "제목을 '검사 성적서'로 바꾸고 글자를 가운데 정렬해");
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema });
    const { next, warnings } = validateEditPatch(report, raw);
    expect(warnings).toEqual([]);
    expect(next.elements[0]).toMatchObject({ value: "검사 성적서" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/ai test -- gemini`
Expected: FAIL

- [ ] **Step 3: 구현**

`packages/ai/src/gemini.ts`:
```ts
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
  const call = async (input: LlmInput, contents: { role: string; parts: { text: string }[] }[]): Promise<string> => {
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const res = await ai.models.generateContent({
        model: opts.model, contents,
        config: { systemInstruction: input.system, responseMimeType: "application/json", responseSchema: input.schema, temperature: 0.2, maxOutputTokens: input.maxOutputTokens ?? MAX_OUTPUT_TOKENS, abortSignal: signal },
      });
      return res.text ?? "";
    } catch (e) { throw toLlmError(e, opts.apiKey); }
  };
  const parse = (text: string): { ok: true; value: unknown } | { ok: false } => {
    if (!text.trim()) return { ok: false };
    try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
  };
  return {
    async complete(input) {
      const contents = input.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
      const first = parse(await call(input, contents));
      if (first.ok) return first.value;
      const second = parse(await call(input, [...contents, { role: "user", parts: [{ text: RETRY_NOTE }] }]));
      if (second.ok) return second.value;
      throw new LlmError("LLM_BAD_OUTPUT", "모델 응답이 JSON 형식이 아닙니다");
    },
  };
}
```
SDK의 실제 옵션 이름(`config.abortSignal`, `res.text`, 오류 객체의 `status`)은 설치된 `@google/genai`의 타입 정의(`node_modules/@google/genai/dist/*.d.ts`)를 열어 확인하고 맞춘다. 다르면 테스트의 단언도 실제 이름으로 함께 바꾸고 보고한다. `index.ts`에 `export * from "./gemini";`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS. 기본 실행 목록에 `__it__`가 없어야 한다. `GEMINI_API_KEY`가 환경에 있으면 `GEMINI_IT=1 pnpm --filter @daport/ai test:it`를 한 번 돌려 결과를 보고한다(없으면 "미실행").

- [ ] **Step 5: 커밋**

```bash
git add packages/ai/src/gemini.ts packages/ai/src/index.ts packages/ai/src/__tests__/gemini.test.ts packages/ai/vitest.it.config.ts packages/ai/src/__it__/gemini.it.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(ai): Gemini 구조화 출력 어댑터 (1회 형식 재시도, 오류 매핑, 키 마스킹)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: studio AI 라우트와 컨텍스트 조립

**Files:**
- Modify: `apps/studio/package.json`(`@daport/ai` 워크스페이스 의존; 링크만 필요하면 `pnpm install --offline`)
- Create: `apps/studio/src/lib/ai.ts`, `apps/studio/src/app/api/reports/[id]/ai/edit/route.ts`, `apps/studio/src/app/api/reports/[id]/ai/generate/route.ts`
- Test: `apps/studio/src/lib/__tests__/ai.test.ts`, `apps/studio/src/app/api/reports/__tests__/ai-routes.test.ts`

**Interfaces:**
- Consumes: T1–T4 전부(`createGeminiClient`, `FakeLlmClient`, `buildEditPrompt`, `buildGeneratePrompt`, `validateEditPatch`, `validateGenerated`, `LlmError`, `AiValidationError`, 상수); core `inferFields`, `parseReport`; studio `getComponentStore`, `readJsonBody`.
- Produces:
```ts
// lib/ai.ts
export function getLlmClient(): LlmClient | null;   // AI_FAKE=1 → FakeLlmClient(키워드 스크립트), GEMINI_API_KEY 없음 → null
export function aiErrorResponse(e: unknown): NextResponse;
export async function buildContext(report: Report, selection: string[], history: ChatTurn[]): Promise<EditContext>;
export function fakeScript(input: LlmInput): unknown;   // E2E용 가짜 응답 (지시문 키워드로 분기)
// POST /api/reports/:id/ai/edit → { patch, explanation, warnings }
// POST /api/reports/:id/ai/generate → { elements, components, explanation, warnings }
```
- 스펙 구체화: `changedIds`는 서버가 아니라 클라이언트(T6)가 `patch`에서 계산한다 — 응답 계약은 스펙 4.1 그대로 유지.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/ai.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";

afterEach(() => { vi.unstubAllEnvs(); (globalThis as { __daportLlm?: unknown }).__daportLlm = undefined; });

describe("lib/ai", () => {
  it("getLlmClient: null without a key, fake with AI_FAKE=1", async () => {
    const { getLlmClient } = await import("../ai");
    vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("AI_FAKE", "");
    expect(getLlmClient()).toBeNull();
    vi.stubEnv("AI_FAKE", "1");
    (globalThis as { __daportLlm?: unknown }).__daportLlm = undefined;
    expect(getLlmClient()).not.toBeNull();
  });
  it("buildContext collects fields from sample data (names/types only), params and the component library", async () => {
    const { buildContext } = await import("../ai");
    const { getComponentStore } = await import("../component-store");
    await getComponentStore().create(`aihdr${Date.now() % 100000}`, { name: "헤더", w: 190, h: 20, props: [{ name: "title", type: "text", default: "" }], elements: [{ id: "h", type: "text", x: 0, y: 0, w: 190, h: 20, value: "{{ props.title }}" }] } as never);
    const report = parseReport({ id: "r", version: 1, page: { width: 210, height: 297 },
      datasets: [{ name: "items", type: "static", rows: [{ NO: "A", QTY: 1 }] }],
      sample: { params: {}, data: { items: [{ NO: "SECRET-VALUE", QTY: 2 }] }, capturedAt: "2026-09-18T00:00:00.000Z" } });
    const ctx = await buildContext(report, ["x"], [{ role: "user", text: "hi" }]);
    expect(ctx.fields.items.map((f) => `${f.path}:${f.type}`)).toEqual(["NO:string", "QTY:number"]);
    expect(JSON.stringify(ctx.fields)).not.toContain("SECRET-VALUE");
    expect(ctx.library.some((c) => c.name === "헤더" && c.props[0].name === "title")).toBe(true);
    expect(ctx.selection).toEqual(["x"]);
    expect(ctx.history).toHaveLength(1);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/ai-routes.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeLlmClient } from "@daport/ai/testing";
import { LlmError } from "@daport/ai";

let fake: FakeLlmClient;
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getLlmClient: () => fake }));
const { POST: edit } = await import("../[id]/ai/edit/route");
const { POST: generate } = await import("../[id]/ai/generate/route");

const ctx = { params: Promise.resolve({ id: "r" }) };
const post = (fn: typeof edit, body: unknown) => fn(new Request("http://localhost/api/reports/r/ai/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
const report = { id: "r", name: "R", version: 1, page: { width: 210, height: 297 }, elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "제목" }] };
const op = (o: string, path: string, value: unknown) => ({ op: o, path, value: JSON.stringify(value) });

afterEach(() => { vi.restoreAllMocks(); });

describe("POST ai/edit", () => {
  beforeEach(() => { fake = new FakeLlmClient({ patch: [op("replace", "/elements/0/value", "검사 성적서"), op("replace", "/output/kind", "label")], explanation: "제목을 바꿨습니다" }); });
  it("returns the validated patch, explanation and warnings; never the prompt or raw output", async () => {
    const res = await post(edit, { report, instruction: "제목 바꿔", selection: ["t1"], history: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patch).toEqual([{ op: "replace", path: "/elements/0/value", value: "검사 성적서" }]);
    expect(body.explanation).toBe("제목을 바꿨습니다");
    expect(body.warnings.join(" ")).toMatch(/\/output/);
    expect(JSON.stringify(body)).not.toMatch(/JSON Patch|허용 경로|system/);   // 프롬프트 원문 비노출
    expect(fake.calls[0].messages.at(-1)!.text).toContain("제목 바꿔");
  });
  it("400 AI_INPUT_TOO_LONG, 400 AI_INVALID_PATCH, and the LlmError mapping", async () => {
    expect((await post(edit, { report, instruction: "가".repeat(2001), selection: [], history: [] })).status).toBe(400);
    fake = new FakeLlmClient({ patch: [op("replace", "/elements/0/w", -1)], explanation: "" });
    const bad = await post(edit, { report, instruction: "x", selection: [], history: [] });
    expect(bad.status).toBe(400); expect((await bad.json()).code).toBe("AI_INVALID_PATCH");
    const cases: [string, number, string][] = [["LLM_RATE_LIMIT", 429, "AI_RATE_LIMIT"], ["LLM_TIMEOUT", 504, "AI_TIMEOUT"], ["LLM_BAD_OUTPUT", 502, "AI_BAD_OUTPUT"], ["LLM_ERROR", 502, "AI_ERROR"], ["LLM_NOT_CONFIGURED", 503, "AI_NOT_CONFIGURED"]];
    for (const [code, status, out] of cases) {
      fake = new FakeLlmClient(() => { throw new LlmError(code as never, "m"); });
      const r = await post(edit, { report, instruction: "x", selection: [], history: [] });
      expect(r.status).toBe(status); expect((await r.json()).code).toBe(out);
    }
  });
  it("503 AI_NOT_CONFIGURED when there is no client", async () => {
    fake = null as never;
    const r = await post(edit, { report, instruction: "x", selection: [], history: [] });
    expect(r.status).toBe(503); expect((await r.json()).code).toBe("AI_NOT_CONFIGURED");
  });
});

describe("POST ai/generate", () => {
  it("400 AI_NOT_EMPTY for a report with elements; returns elements for an empty one", async () => {
    fake = new FakeLlmClient({ elements: [JSON.stringify({ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "품질보증서" })], explanation: "생성" });
    const notEmpty = await post(generate, { report, brief: "품질보증서" });
    expect(notEmpty.status).toBe(400); expect((await notEmpty.json()).code).toBe("AI_NOT_EMPTY");
    const ok = await post(generate, { report: { ...report, elements: [] }, brief: "품질보증서" });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", value: "품질보증서" });
    expect(body.components).toEqual({});
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- ai`
Expected: FAIL

- [ ] **Step 3: 구현**

`apps/studio/src/lib/ai.ts`:
```ts
import { NextResponse } from "next/server";
import { inferFields, type Report } from "@daport/core";
import { createGeminiClient, LlmError, AiValidationError, type LlmClient, type LlmInput, type EditContext, type ChatTurn, type LibraryItem } from "@daport/ai";
import { FakeLlmClient } from "@daport/ai/testing";
import { getComponentStore } from "./component-store";

const holder = globalThis as typeof globalThis & { __daportLlm?: LlmClient | null };

/** AI_FAKE=1이면 E2E용 가짜, 키가 없으면 null(라우트가 503) */
export function getLlmClient(): LlmClient | null {
  if (holder.__daportLlm !== undefined) return holder.__daportLlm;
  if (process.env.AI_FAKE === "1") return (holder.__daportLlm = new FakeLlmClient(fakeScript));
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
    const res = NextResponse.json({ error: e.message, code }, { status });
    if (e.retryAfterMs) res.headers.set("retry-after", String(Math.ceil(e.retryAfterMs / 1000)));
    return res;
  }
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
```
(`fakeScript`의 생성 판별 문구 "elements 배열"은 T2의 `GENERATE_SYSTEM`에 실제로 들어 있는 문구로 맞춘다. 첫 요소가 텍스트가 아닌 예제에서는 E2E가 첫 텍스트 요소를 쓰도록 T8에서 예제를 고른다.)

`apps/studio/src/app/api/reports/[id]/ai/edit/route.ts`:
```ts
import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { buildEditPrompt, validateEditPatch, MAX_INSTRUCTION_CHARS, type ChatTurn } from "@daport/ai";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { getLlmClient, aiErrorResponse, buildContext } from "@/lib/ai";

export const maxDuration = 90;

/** 자연어 편집 (스펙 4.1, 6.1). 검증된 패치만 돌려준다. 모델은 바꾸지 않는다 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;
  const instruction = typeof b.instruction === "string" ? b.instruction.trim() : "";
  if (!instruction) return NextResponse.json({ error: "지시를 입력하세요", code: "AI_INPUT_TOO_LONG" }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTION_CHARS) return NextResponse.json({ error: `지시는 ${MAX_INSTRUCTION_CHARS}자 이하여야 합니다`, code: "AI_INPUT_TOO_LONG" }, { status: 400 });
  const client = getLlmClient();
  if (!client) return NextResponse.json({ error: "서버에 GEMINI_API_KEY를 설정하세요", code: "AI_NOT_CONFIGURED" }, { status: 503 });
  const started = Date.now();
  try {
    const report = parseReport(b.report);
    const selection = Array.isArray(b.selection) ? b.selection.filter((s): s is string => typeof s === "string") : [];
    const history = (Array.isArray(b.history) ? b.history : []).filter((t): t is ChatTurn => !!t && typeof (t as ChatTurn).text === "string" && ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant"));
    const prompt = buildEditPrompt(await buildContext(report, selection, history), instruction);
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, signal: req.signal });
    const { patch, warnings } = validateEditPatch(report, raw);
    const explanation = typeof (raw as { explanation?: unknown }).explanation === "string" ? (raw as { explanation: string }).explanation : "";
    console.log(`[ai] edit report=${report.id} ms=${Date.now() - started} ops=${patch.length}`);
    return NextResponse.json({ patch, explanation, warnings: [...prompt.truncated.map((t) => `컨텍스트를 줄였습니다: ${t}`), ...warnings] });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
```
`parseReport` 실패(ZodError)는 `aiErrorResponse`에서 400이 되도록 `ZodError` 분기를 추가한다(`{ code: "AI_INVALID_PATCH" }`가 아니라 일반 400 `{ error }`).

`generate/route.ts`: 같은 구조로 `brief`(≤ `MAX_BRIEF_CHARS`) 검사, `report.elements.length > 0`이면 400 `AI_NOT_EMPTY`, `buildGeneratePrompt(await buildContext(report, [], []), brief)`, `validateGenerated(report, raw, lookup)` — `lookup = async (id) => { const d = await getComponentStore().get(id); return d ? { version: d.summary.latestVersion, body: d.latest } : null; }` — 응답 `{ elements, components, explanation, warnings }`.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/package.json pnpm-lock.yaml apps/studio/src/lib/ai.ts "apps/studio/src/app/api/reports/[id]/ai" apps/studio/src/lib/__tests__/ai.test.ts apps/studio/src/app/api/reports/__tests__/ai-routes.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): AI 편집·생성 라우트, 컨텍스트 조립, 오류 매핑, E2E용 가짜 응답

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 스토어 `proposal`과 캔버스 제안 오버레이

**Files:**
- Modify: `apps/studio/src/editor/store.ts`, `apps/studio/src/editor/canvas/Canvas.tsx`
- Create: `apps/studio/src/editor/ai/proposal.ts`(순수: `changedIds`, `applyToReport`)
- Test: `apps/studio/src/editor/__tests__/store.proposal.test.ts`, `apps/studio/src/editor/canvas/__tests__/Canvas.proposal.test.tsx`, `apps/studio/src/editor/ai/__tests__/proposal.test.ts`

**Interfaces:**
- Produces:
```ts
// ai/proposal.ts
export type Proposal = { kind: "edit" | "generate"; patch: Operation[]; explanation: string; warnings: string[]; next: Report; changes: { added: string[]; changed: string[]; removed: string[] }; base: Report };
export function diffIds(before: Report, after: Report): Proposal["changes"];   // 요소 id 집합·내용 비교
export function proposalFromEdit(base: Report, res: { patch: Operation[]; explanation: string; warnings: string[] }): Proposal;
export function proposalFromGenerate(base: Report, res: { elements: Element[]; components: Record<string, ComponentBody>; explanation: string; warnings: string[] }): Proposal;
// store
proposal: Proposal | null;
setProposal(p: Proposal | null): void;
applyProposal(): void;     // apply((r) => 교체) 한 번 → 되돌리기 1단위, proposal = null
rejectProposal(): void;
```
- 스펙 구체화: 스펙 7.2의 `changedIds`를 `changes { added, changed, removed }`로 나눠 강조 색을 정한다. "다른 편집 시 자동 폐기"는 `apply` 안에서 `proposal`이 있고 그 `base`가 현재 `report`와 다르면 `proposal = null`로 구현한다(적용 자체는 `applyProposal`이 먼저 비우고 반영).

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/ai/__tests__/proposal.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { diffIds, proposalFromEdit, proposalFromGenerate } from "../proposal";

const base = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 0, y: 0, w: 10, h: 5, value: "A" },
  { id: "b", type: "rect", x: 0, y: 10, w: 10, h: 5 },
]});

describe("proposal", () => {
  it("diffIds reports added, changed and removed element ids (nested included)", () => {
    const after = parseReport({ ...base, elements: [{ ...base.elements[0], value: "A2" }, { id: "c", type: "rect", x: 0, y: 20, w: 5, h: 5 }] });
    expect(diffIds(base, after)).toEqual({ added: ["c"], changed: ["a"], removed: ["b"] });
  });
  it("proposalFromEdit applies the patch to a copy and never mutates the base", () => {
    const p = proposalFromEdit(base, { patch: [{ op: "replace", path: "/elements/0/value", value: "X" }], explanation: "e", warnings: [] });
    expect(p.next.elements[0]).toMatchObject({ value: "X" });
    expect(base.elements[0]).toMatchObject({ value: "A" });
    expect(p.changes.changed).toEqual(["a"]);
    expect(p.kind).toBe("edit");
  });
  it("proposalFromGenerate puts elements and components into the next report", () => {
    const empty = parseReport({ id: "e", version: 1, page: { width: 100, height: 100 } });
    const p = proposalFromGenerate(empty, { elements: [base.elements[0]], components: {}, explanation: "g", warnings: ["w"] });
    expect(p.next.elements).toHaveLength(1);
    expect(p.changes.added).toEqual(["a"]);
    expect(p.warnings).toEqual(["w"]);
  });
});
```

`apps/studio/src/editor/__tests__/store.proposal.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { createEditorStore } from "../store";
import { proposalFromEdit } from "../ai/proposal";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "a", type: "text", x: 0, y: 0, w: 10, h: 5, value: "A" }] });

describe("store proposal", () => {
  it("keeps the model untouched until apply, then applies as one undo step", () => {
    const s = createEditorStore(report);
    s.getState().setProposal(proposalFromEdit(report, { patch: [{ op: "replace", path: "/elements/0/value", value: "B" }, { op: "replace", path: "/elements/0/w", value: 20 }], explanation: "", warnings: [] }));
    expect(s.getState().report.elements[0]).toMatchObject({ value: "A", w: 10 });
    expect(s.getState().dirty).toBe(false);
    s.getState().applyProposal();
    expect(s.getState().report.elements[0]).toMatchObject({ value: "B", w: 20 });
    expect(s.getState().proposal).toBeNull();
    s.getState().undo();
    expect(s.getState().report.elements[0]).toMatchObject({ value: "A", w: 10 });
  });
  it("reject clears without changing; any other edit discards the proposal", () => {
    const s = createEditorStore(report);
    const p = proposalFromEdit(report, { patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "", warnings: [] });
    s.getState().setProposal(p); s.getState().rejectProposal();
    expect(s.getState().proposal).toBeNull(); expect(s.getState().report.elements[0]).toMatchObject({ value: "A" });
    s.getState().setProposal(p);
    s.getState().updateElement("a", { x: 5 });
    expect(s.getState().proposal).toBeNull();
  });
});
```

`apps/studio/src/editor/canvas/__tests__/Canvas.proposal.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { proposalFromEdit } from "../../ai/proposal";

afterEach(cleanup);
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 0, y: 0, w: 30, h: 5, value: "A" }, { id: "b", type: "rect", x: 0, y: 10, w: 10, h: 5 }] });

describe("Canvas proposal overlay", () => {
  it("draws the shadow page, highlights changes and applies from the bar", () => {
    const store = createEditorStore(report);
    const { container, getByTestId, queryByTestId } = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
    expect(queryByTestId("ai-proposal")).toBeNull();
    act(() => store.getState().setProposal(proposalFromEdit(report, {
      patch: [{ op: "replace", path: "/elements/0/value", value: "AI" }, { op: "remove", path: "/elements/1" }, { op: "add", path: "/elements/-", value: { id: "c", type: "rect", x: 50, y: 50, w: 10, h: 10 } }],
      explanation: "e", warnings: ["w1"] })));
    const overlay = getByTestId("ai-proposal");
    expect(overlay.textContent).toContain("AI");
    expect(container.querySelector('[data-ai-change="changed"][data-ai-id="a"]')).not.toBeNull();
    expect(container.querySelector('[data-ai-change="added"][data-ai-id="c"]')).not.toBeNull();
    expect(container.querySelector('[data-ai-change="removed"][data-ai-id="b"]')).not.toBeNull();
    expect(getByTestId("ai-proposal-bar").textContent).toMatch(/3.*1/);   // op 3개, 경고 1개
    fireEvent.click(getByTestId("ai-apply"));
    expect(store.getState().report.elements[0]).toMatchObject({ value: "AI" });
    expect(queryByTestId("ai-proposal")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- proposal`
Expected: FAIL

- [ ] **Step 3: 구현**

`apps/studio/src/editor/ai/proposal.ts`: `applyPatch(deepClone(base), deepClone(patch), false, false).newDocument`로 `next`를 만들고 `parseReport`로 한 번 더 정규화; `diffIds`는 `walkElements`로 두 트리의 `id → JSON.stringify(요소, 자식 제외)` 맵을 만들어 비교. 생성은 `{ ...base, elements, components: { ...base.components, ...components } }`.

`store.ts`:
- `EditorState`에 `proposal: Proposal | null; setProposal; applyProposal; rejectProposal` 추가, 초기값 `proposal: null`.
- `apply` 안: `commit` 결과가 바뀌었으면 `set({ …, proposal: null })`도 함께(다른 편집 = 제안 폐기). 단 `applyProposal`은 `const p = get().proposal; if (!p) return; set({ proposal: null }); apply((r) => { const next = deepClone(p.next); for (const k of Object.keys(r)) delete (r as any)[k]; Object.assign(r, next); });`로 한 커밋에 반영.
- `undo`/`redo`(`travel`)도 `proposal: null`로 비운다.

`Canvas.tsx`:
- `const proposal = useEditor((s) => s.proposal);` `const shadowPages = useMemo(() => (proposal ? layoutFor(proposal.next, sampleProps) : null), [proposal, sampleProps]);`
- 현재 페이지(`page`) 위에 `proposal`이 있으면 `<div data-testid="ai-proposal" className="absolute inset-0 pointer-events-none opacity-50 outline-dashed outline-2 outline-blue-500"><PaintPage page={shadowPages[pageIndex] ?? shadowPages[0]} /></div>`를 겹친다.
- 강조: `proposal.changes`의 각 id에 대해 요소 상자(기존 `boxes` 계산을 `proposal.next` 레이아웃에도 적용 — `removed`는 현재 레이아웃 상자)를 `<div data-ai-id={id} data-ai-change="added|changed|removed" className="absolute pointer-events-none border-2 …">`로 그린다(추가 초록 `border-green-500`, 변경 파랑 `border-blue-500`, 삭제 빨강 점선 `border-red-500 border-dashed`).
- 바: 페이지 위 고정 `<div data-testid="ai-proposal-bar">AI 제안 · op {n} · 경고 {m} <button data-testid="ai-apply">적용</button> <button>거절</button></div>`(`pointer-events-auto`).
- 오버레이가 있는 동안 캔버스 드래그·선택은 그대로 두되, 드래그로 편집이 생기면 스토어가 제안을 폐기한다(추가 코드 없음).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS(기존 Canvas·store 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/editor/store.ts apps/studio/src/editor/canvas/Canvas.tsx apps/studio/src/editor/ai apps/studio/src/editor/__tests__/store.proposal.test.ts apps/studio/src/editor/canvas/__tests__/Canvas.proposal.test.tsx
git -c core.hooksPath=/dev/null commit -m "feat(studio): AI 제안 상태(적용=되돌리기 1단위, 편집 시 폐기)와 캔버스 제안 오버레이

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: AI 탭

**Files:**
- Create: `apps/studio/src/editor/ai/AiPanel.tsx`, `apps/studio/src/editor/ai/api.ts`
- Modify: `apps/studio/src/editor/Editor.tsx`(하단 영역을 "JSON"/"AI" 탭으로)
- Test: `apps/studio/src/editor/ai/__tests__/AiPanel.test.tsx`

**Interfaces:**
- Consumes: T5 라우트, T6 `setProposal`·`proposalFromEdit`·`proposalFromGenerate`, 스토어 `report`·`selection`, `failureMessage`(`editor/failure-message.ts`).
- Produces: `<AiPanel reportId />` — `aria-label="AI 지시"`, `data-testid="ai-send"`, `data-testid="ai-generate-mode"`(요소 0개일 때만), 선택 칩 `data-testid="ai-selection"`, 대화 `data-testid="ai-turn"`, 미설정 안내 `data-testid="ai-not-configured"`, 취소 버튼 "취소".

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/ai/__tests__/AiPanel.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { AiPanel } from "../AiPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "a", type: "text", x: 0, y: 0, w: 30, h: 5, value: "A" }] });
const mount = (r = report) => { const store = createEditorStore(r); render(<EditorContext.Provider value={store}><AiPanel reportId="r" /></EditorContext.Provider>); return store; };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("AiPanel", () => {
  it("sends instruction, selection and history to ai/edit and turns the answer into a proposal", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "바꿨습니다", warnings: ["경고"] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount();
    act(() => store.getState().select(["a"]));
    expect(screen.getByTestId("ai-selection").textContent).toContain("a");
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "값을 B로" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(store.getState().proposal).not.toBeNull());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reports/r/ai/edit");
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ instruction: "값을 B로", selection: ["a"], history: [] });
    expect(body.report.id).toBe("r");
    const turns = screen.getAllByTestId("ai-turn").map((t) => t.textContent);
    expect(turns[0]).toContain("값을 B로"); expect(turns[1]).toContain("바꿨습니다"); expect(turns[1]).toContain("경고");
    expect(store.getState().report.elements[0]).toMatchObject({ value: "A" });   // 적용 전 불변
  });
  it("uses generate mode on an empty report and shows the not-configured notice on 503", async () => {
    const fetchMock = vi.fn(async () => json({ elements: [{ id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, value: "생성" }], components: {}, explanation: "생성함", warnings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } }));
    expect((screen.getByTestId("ai-generate-mode") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "품질보증서" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(store.getState().proposal?.kind).toBe("generate"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/ai/generate");
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ brief: "품질보증서" });
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "키 없음", code: "AI_NOT_CONFIGURED" }, 503)));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(screen.getByTestId("ai-not-configured").textContent).toContain("GEMINI_API_KEY"));
  });
  it("shows errors as a turn and supports cancel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "요청 한도", code: "AI_RATE_LIMIT" }, 429)));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("요청 한도"));
    cleanup();
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => new Promise((_r, reject) => { init!.signal!.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("a"), { name: "AbortError" })); }); })));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    await waitFor(() => expect(aborted).toBe(true));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- AiPanel`
Expected: FAIL

- [ ] **Step 3: 구현**

`ai/api.ts`: `postAi(reportId, kind, body, signal)` — `fetch(\`/api/reports/${encodeURIComponent(reportId)}/ai/${kind}\`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal })`; 비정상 응답은 `{ ok: false, status, code, message }`(메시지는 `failureMessage`).

`AiPanel.tsx`: 로컬 상태 `turns: { role: "user" | "assistant" | "error"; text: string; warnings?: string[] }[]`, `input`, `busy`, `notConfigured`, `generateMode`(초기값 = 요소 0개, 요소가 생기면 끄고 토글 숨김), `controller: AbortController | null`. 전송: 사용자 턴 추가 → `postAi` → 성공이면 `setProposal(kind === "edit" ? proposalFromEdit(report, res) : proposalFromGenerate(report, res))` + 어시스턴트 턴(설명 + 경고 목록) → 503이면 `notConfigured = true`(안내 박스 `data-testid="ai-not-configured"`: "서버에 GEMINI_API_KEY를 설정하세요") → 그 밖 오류는 `error` 턴. `history`는 직전 턴 중 user/assistant만 최근 6개(`{ role, text }`). Enter 전송, Shift+Enter 줄바꿈. 전송 중에는 "보내기" 대신 "취소" 버튼(`controller.abort()`; 취소는 조용히 "취소됨" 턴).

`Editor.tsx`: 하단 `<div className="h-64 border-t bg-white"><JsonEditor /></div>`를 탭 두 개(`JSON`, `AI`)로 바꾼다. 컴포넌트 편집 화면에서는 AI 탭을 숨긴다(스펙 범위 — 컴포넌트 내용 편집은 범위 밖). JSON 탭의 Monaco는 숨길 때 언마운트하지 않도록 `hidden` 클래스로 토글한다(편집기 상태 보존).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/editor/ai apps/studio/src/editor/Editor.tsx
git -c core.hooksPath=/dev/null commit -m "feat(studio): 하단 AI 탭 — 지시·선택 칩·생성 모드·취소·미설정 안내

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 환경 예시, README, 5단계 E2E

**Files:**
- Modify: `apps/studio/.env.example`, `apps/studio/playwright.config.ts`
- Create: `apps/studio/e2e/phase5.spec.ts`, `packages/ai/README.md`

**Interfaces:**
- Consumes: T5 `AI_FAKE=1` 가짜 응답(`fakeScript`), T6·T7 testid.

- [ ] **Step 1: 환경·Playwright·README**

`.env.example` 끝에:
```
# AI 편집·생성 (Gemini). 키가 없으면 AI 탭이 "설정 필요"를 보인다
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
AI_TIMEOUT_MS=60000
```
`playwright.config.ts`: studio webServer의 `env`에 `AI_FAKE: "1"`을 더한다(E2E는 가짜 응답만 쓴다). 스펙 파일 상단 주석에 "이미 떠 있는 dev 서버를 재사용하면 AI_FAKE가 없어 503이 난다"를 적는다.

`packages/ai/README.md`: 역할, 공개 API, 프롬프트 버전 관리(`prompt-version` 주석), 허용·금지 경로, `GEMINI_IT=1` 실행 방법, 그리고 **"수동 검증 기록"** 절 — 스펙 10장 기준 1·2(예제 3종 × 편집 지시 5개, 빈 레포트 생성)를 실제 Gemini로 돌린 결과(지시, 경고 수, 적용 후 PDF 성공 여부)를 표로 남긴다. 키가 없어 실행하지 못하면 "미실행"과 실행 방법을 적는다.

- [ ] **Step 2: E2E 작성**

`apps/studio/e2e/phase5.spec.ts`:
```ts
// dev 서버에 AI_FAKE=1이 있어야 한다 (playwright.config webServer.env가 넣는다). 가짜 응답은 lib/ai.ts의 fakeScript
import { test, expect, type Page } from "@playwright/test";

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

test("edit: instruction → proposal overlay → apply → undo restores", async ({ page }) => {
  const id = `e2e-ai-edit-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("AI 지시").fill("제목을 '검사 성적서'로 바꿔");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await expect(page.getByTestId("ai-proposal")).toContainText("검사 성적서");
  const canvasPage = page.getByTestId("canvas").locator(".dp-page").first();
  await expect(canvasPage).not.toContainText("검사 성적서");        // 적용 전 불변
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-proposal")).toHaveCount(0);
  await expect(canvasPage).toContainText("검사 성적서");
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(canvasPage).not.toContainText("검사 성적서");
});

test("generate: empty report → brief → proposal → apply → save → reload keeps it", async ({ page }) => {
  const id = `e2e-ai-gen-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.getByTestId("ai-generate-mode")).toBeChecked();
  await page.getByLabel("AI 지시").fill("품질보증서: 제목과 본문 영역");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("canvas")).toContainText("품질보증서");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save")).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("canvas")).toContainText("품질보증서");
});

test("forbidden paths in the answer are dropped with a warning", async ({ page }) => {
  const id = `e2e-ai-forbid-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("AI 지시").fill("금지 경로 테스트");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-turn").last()).toContainText("/output");
  await expect(page.getByTestId("ai-proposal-bar")).toContainText("op 1");
});
```
"+ 텍스트"로 추가한 요소가 `/elements/0`이 되는지(빈 레포트라 첫 요소) 확인하고, 탭 버튼 이름("AI")·되돌리기 버튼 이름은 실제 마크업에 맞춘다(단언은 지우지 않는다).

- [ ] **Step 3: 실행**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter studio e2e`
Expected: 단위 전부 PASS, E2E 기존 19 + 신규 3 전부 PASS. UI 결함으로 실패하면 컴포넌트를 고치지 말고 DONE_WITH_CONCERNS로 정확한 실패를 보고한다.

- [ ] **Step 4: 커밋**

```bash
git add apps/studio/.env.example apps/studio/playwright.config.ts apps/studio/e2e/phase5.spec.ts packages/ai/README.md
git -c core.hooksPath=/dev/null commit -m "test(studio): 5단계 E2E — AI 편집 제안·적용·되돌리기, 페이지 생성, 금지 경로 경고; 환경 예시·README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 자체 점검 (플랜 작성자)

- **스펙 커버리지**: §2 결정 → Global Constraints; §3 패키지 → T1; §4.1 편집 계약·허용 경로 → T3 검증기 + T5 라우트; §4.2 생성 계약 → T3 `validateGenerated` + T5 generate; §4.3 컨텍스트·60k 잘라내기 → T1 압축 + T2 `fit`; §4.4 비노출 → T5 테스트(프롬프트 문구·`sample` 값 비노출); §5.1 API → T1–T4; §5.2 Gemini 어댑터·재시도·키 마스킹 → T4; §5.3 프롬프트 → T2; §5.4 검증기 → T3; §5.5 IT → T4; §6 라우트·로그 → T5; §7.1 AI 탭 → T7; §7.2 proposal·오버레이·자동 폐기 → T6; §7.3 생성 적용 시 components 병합 → T6 `proposalFromGenerate`; §8 오류 표 → T5 `aiErrorResponse` + 라우트 테스트; §9 테스트 → 각 태스크 + T8 E2E; §10 완료 기준 1·2 → T8 README 수동 검증 기록, 3 → T6 테스트, 4 → T5 테스트, 5 → 전체 스위트.
- **타입 일관성**: `LlmClient`/`LlmInput`/`LlmError`(T1 → T4·T5), `EditContext`(T1 → T2·T5), `PromptBundle`(T2 → T5), `validateEditPatch`의 `{ patch, warnings, next }`(T3 → T5), `LibraryLookup`(T3 → T5), 응답 `{ patch, explanation, warnings }`/`{ elements, components, explanation, warnings }`(T5 ↔ T7), `Proposal`(T6 → T7), testid(T6·T7 ↔ T8), `fakeScript` 판별 문구(T2 `GENERATE_SYSTEM` ↔ T5).
- **자리표시자 없음**: 모든 단계에 코드가 있다. 구현자가 실제 값을 읽어 맞추라고 남긴 항목(`@google/genai`의 옵션·오류 필드 이름, zod `toJSONSchema` 출력 모양, `ref` 요소 필드명, 탭·되돌리기 버튼 이름)은 결정을 미룬 것이 아니라 설치된 코드에 맞추라는 지시다.
