# 6단계 AI 이미지 → 양식 이관 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종이 양식 스캔 이미지를 올리면 서버가 보정·인식해 레포트 한 장의 요소·표·파라미터로 바꾸고, 5단계 제안 오버레이로 확인 후 적용한다.

**Architecture:** `packages/ai`에 멀티모달 입력·이관 프롬프트·응답 스키마·검증기를 더하고, studio에 `sharp` 전처리(`lib/scan.ts`)와 `POST /api/reports/:id/ai/import` 라우트, 이관 시작 UI와 대조 배경 토글을 더한다. 제안 상태·적용·되돌리기는 5단계 것을 그대로 쓴다.

**Tech Stack:** TypeScript, pnpm 워크스페이스, Next.js 16(App Router), zod 4, `@google/genai` 2.x, `sharp`(신규), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-daport-phase6-image-import-design.md`

## Global Constraints

- 주석·UI 문구·경고·오류 메시지는 한국어. 식별자·파일명은 영어.
- 커밋은 `git -c core.hooksPath=/dev/null commit`. 파일은 경로로 스테이징한다. `git add -A` 금지.
- 커밋 메시지 마지막 줄은 정확히 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 기본 `pnpm test`는 `GEMINI_API_KEY` 없이 통과해야 한다. 실제 호출 테스트는 `GEMINI_IT=1`일 때만 돈다.
- `packages/ai`의 의존은 `@daport/core`, `fast-json-patch`, `@google/genai`뿐이다. `sharp`를 여기에 넣지 않는다.
- 프롬프트 원문·모델 원응답·API 키·공급자 원문 오류는 응답 본문에 넣지 않는다.
- 로그에는 이미지 바이트와 인식한 글자를 남기지 않는다.
- 모델 좌표는 이미지 기준 0–1000 정수다. mm 변환은 서버가 한다.
- 이관은 빈 레포트에서만 시작한다(요소가 있으면 400 `AI_NOT_EMPTY`).
- 이관이 건드리지 않는 것: `components`, `output`, `sample`, `id`, `version`. `datasets`는 표에 딸린 `rows<N>` 정적 데이터셋만 허용한다.
- 각 태스크는 `pnpm -r typecheck`와 해당 패키지 테스트가 통과해야 커밋한다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/ai/src/types.ts` | `LlmInput.images` 추가 |
| `packages/ai/src/gemini.ts` | 이미지 파트를 `inlineData`로 전달 |
| `packages/ai/src/prompts/import.ko.ts` | 이관 시스템 프롬프트 |
| `packages/ai/src/prompt.ts` | `buildImportPrompt` 추가 |
| `packages/ai/src/response-schema.ts` | `IMPORT_RESPONSE_SCHEMA` 추가 |
| `packages/ai/src/import-validate.ts` | `validateImported` (좌표 변환·params·datasets·표 규칙) |
| `apps/studio/src/lib/scan.ts` | `sharp` 전처리 (서버 전용) |
| `apps/studio/src/app/api/reports/[id]/ai/import/route.ts` | 이관 라우트 |
| `apps/studio/src/lib/ai.ts` | 이관 오류 코드 매핑, `fakeScript` 이관 분기 |
| `apps/studio/src/editor/ai/proposal.ts` | `proposalFromImport` |
| `apps/studio/src/editor/ai/AiPanel.tsx` | 이관 시작 UI |
| `apps/studio/src/editor/canvas/Canvas.tsx` | 대조 배경 레이어 |

검증기는 `validate.ts`에 붙이지 않고 `import-validate.ts`로 나눈다. `validate.ts`는 이미 편집·생성 두 경로를 담고 있어 세 번째를 더하면 한 파일이 너무 커진다.

---

### Task 1: 멀티모달 입력

**Files:**
- Modify: `packages/ai/src/types.ts`, `packages/ai/src/gemini.ts`
- Test: `packages/ai/src/__tests__/gemini.test.ts`

**Interfaces:**
- Produces: `LlmInput.images?: { mimeType: string; data: string }[]` (data는 base64). Gemini 어댑터가 마지막 user 메시지에 `inlineData` 파트로 함께 싣는다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/ai/src/__tests__/gemini.test.ts` 맨 끝의 `describe` 안에 더한다. 파일 위 기존 `vi.mock("@google/genai", ...)`와 `generateContent` 모킹을 그대로 쓴다.

```ts
  it("images를 마지막 user 파트에 inlineData로 싣는다", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"ok":1}' });
    await client().complete({
      system: "s", messages: [{ role: "user", text: "이 이미지를 읽어라" }], schema: {},
      images: [{ mimeType: "image/jpeg", data: "QUJD" }],
    });
    const req = generateContent.mock.calls[0][0];
    const parts = req.contents.at(-1).parts;
    expect(parts[0]).toEqual({ text: "이 이미지를 읽어라" });
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
  });

  it("images가 없으면 파트는 텍스트 하나뿐이다", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"ok":1}' });
    await client().complete({ system: "s", messages: [{ role: "user", text: "t" }], schema: {} });
    expect(generateContent.mock.calls[0][0].contents.at(-1).parts).toEqual([{ text: "t" }]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/ai test -- gemini`
Expected: FAIL (`parts[1]`이 undefined)

- [ ] **Step 3: 구현**

`types.ts`의 `LlmInput`에 한 줄 더한다.

```ts
export type LlmInput = {
  system: string;
  messages: { role: "user" | "model"; text: string }[];
  schema: object;
  images?: { mimeType: string; data: string }[];   // base64. 마지막 user 메시지에 함께 실린다
  maxOutputTokens?: number;
  signal?: AbortSignal;
};
```

`gemini.ts`의 `call` 시그니처에서 `contents`의 파트 타입을 넓히고, `complete`에서 파트를 만든다.

```ts
type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

  const call = async (input: LlmInput, contents: { role: string; parts: Part[] }[], signal: AbortSignal): Promise<string> => {
```

`complete` 안의 `contents` 조립을 바꾼다.

```ts
      const contents = input.messages.map((m, i) => {
        const parts: Part[] = [{ text: m.text }];
        // 이미지는 마지막 메시지에만 싣는다 — 모델이 "지금 보는 그림"과 지시를 한 턴으로 읽게 한다
        if (i === input.messages.length - 1) {
          for (const img of input.images ?? []) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
        return { role: m.role, parts };
      });
```

형식 재시도 경로(`[...contents, { role: "user", parts: [{ text: RETRY_NOTE }] }]`)는 그대로 둔다. 재시도 때 이미지를 다시 보내지 않는다. 같은 대화 안이라 모델이 앞 턴의 이미지를 계속 본다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/ai/src/types.ts packages/ai/src/gemini.ts packages/ai/src/__tests__/gemini.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(ai): LlmInput.images와 Gemini inlineData 전달

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 이관 프롬프트와 응답 스키마

**Files:**
- Create: `packages/ai/src/prompts/import.ko.ts`
- Modify: `packages/ai/src/prompt.ts`, `packages/ai/src/response-schema.ts`
- Test: `packages/ai/src/__tests__/prompt.test.ts`

**Interfaces:**
- Consumes: T1 `LlmInput.images`.
- Produces:
```ts
export const IMPORT_SYSTEM: string;
export const IMPORT_RESPONSE_SCHEMA: object;
export function buildImportPrompt(page: { width: number; height: number }, image: { mimeType: string; data: string }):
  { system: string; messages: { role: "user"; text: string }[]; schema: object; images: { mimeType: string; data: string }[] };
```

- [ ] **Step 1: 실패 테스트 작성**

`packages/ai/src/__tests__/prompt.test.ts`에 더한다.

```ts
describe("buildImportPrompt", () => {
  const img = { mimeType: "image/jpeg", data: "QUJD" };

  it("페이지 크기를 사용자 메시지에 싣고 이미지를 함께 넘긴다", () => {
    const p = buildImportPrompt({ width: 210, height: 297 }, img);
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].text).toContain("210×297mm");
    expect(p.images).toEqual([img]);
    expect(p.schema).toBe(IMPORT_RESPONSE_SCHEMA);
  });

  it("시스템 프롬프트가 좌표·금지 요소·표 규칙을 못 박는다", () => {
    const { system } = buildImportPrompt({ width: 210, height: 297 }, img);
    expect(system).toContain("0-1000");       // 정규화 좌표
    expect(system).toContain("repeater");     // 금지 요소
    expect(system).toContain("rows1");        // 표에 딸린 정적 데이터셋 이름 규칙
    expect(system).toContain("{{ row.");      // 열 value 표현식
    expect(system).toContain("{{ params.");   // 값 칸 표현식
    expect(system).toContain("120");          // 요소 상한
  });

  it("응답 스키마에 oneOf·$ref·anyOf가 없다", () => {
    const json = JSON.stringify(IMPORT_RESPONSE_SCHEMA);
    expect(json).not.toMatch(/oneOf|\$ref|anyOf/);
    expect(IMPORT_RESPONSE_SCHEMA).toMatchObject({ required: ["elements", "explanation"] });
  });
});
```

`prompt.test.ts` 위쪽 import에 `buildImportPrompt`, `IMPORT_RESPONSE_SCHEMA`를 더한다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/ai test -- prompt`
Expected: FAIL (`buildImportPrompt` 없음)

- [ ] **Step 3: 구현**

`packages/ai/src/prompts/import.ko.ts`:

```ts
/** 이관 시스템 프롬프트 (스펙 5.3). 좌표는 정규화 정수, 표는 정적 데이터셋과 짝을 이룬다 */
export const IMPORT_SYSTEM = `당신은 종이 양식 스캔 이미지를 레포트 문서로 옮기는 도구입니다. 이미지를 읽고 요소 목록을 JSON으로 냅니다.

# 좌표
- 모든 x, y, w, h는 이미지 기준 0-1000 정규화 정수입니다. mm이나 픽셀을 쓰지 마세요.
- x와 w는 가로, y와 h는 세로 기준입니다. 왼쪽 위가 0입니다.
- group 자식의 좌표도 0-1000 정규화 정수이며, 그룹이 아니라 이미지 기준입니다.

# 쓸 수 있는 요소
text, rect, line, image, table, barcode, group
- repeater와 ref는 만들지 마세요.
- 요소마다 고유한 id를 영문 소문자로 지으세요. 예: title, header-1, table-1.

# 글자
- 보이는 대로 옮기세요. 지어내지 마세요.
- 읽을 수 없으면 그 칸을 건너뛰고 warnings에 위치를 적으세요.
- 글자 크기는 글상자 높이에서 추정해 style.fontSize(pt)로 적으세요.
- 굵기는 style.bold, 정렬은 style.align(left·center·right)만 구분하세요.

# 값 칸
- 라벨 옆의 빈칸이나 값이 채워진 칸은 text 요소로 만들고 value를 "{{ params.이름 }}"으로 쓰세요.
- 그 이름을 params에 { "name": "이름", "type": "string" } 으로 선언하세요. type은 string, number, date만 됩니다.
- 이름은 영문 소문자 식별자로 지으세요. 예: lotNo, inspectedAt.

# 표
- 표는 머리글 행과 열 경계를 찾아 table 요소 하나로 만드세요. 표 안 글자를 text 요소로 흩지 마세요.
- table에는 source가 필요합니다. 표마다 정적 데이터셋 하나를 datasets에 함께 내세요.
- 데이터셋 이름은 rows1, rows2처럼 순번을 붙이고, table.source에 그 이름을 그대로 적으세요.
- 각 열은 { "header": "머리글", "value": "{{ row.열키 }}", "w": 너비 } 입니다. 열키는 머리글에서 뽑은 영문 식별자입니다.
- 열 너비 w의 합은 표 요소의 w와 같아야 합니다.
- 스캔에서 읽은 본문 행은 최대 20행까지 그 데이터셋의 rows에 담으세요. 각 행은 열키를 키로 쓰는 객체입니다.

# 컴포넌트 후보
- 머리글, 서명란, 도장란처럼 다른 양식에서도 반복될 조각은 group으로 묶고 id에 뜻이 드러나게 지으세요.
- explanation에 어떤 group이 컴포넌트 후보인지 한 문장으로 적으세요.

# 그 밖
- 로고나 사진 자리는 빈 image 요소로 잡고 src는 빈 문자열로 두세요.
- 요소는 최대 120개입니다. 넘으면 장식용 선부터 버리고 warnings에 적으세요.
- 데이터셋, 컴포넌트, 출력 설정, 샘플 데이터는 만들지 마세요. 표에 딸린 rows 데이터셋만 예외입니다.

# 출력
- elements와 datasets, params의 각 원소는 객체 하나의 JSON 문자열입니다.
- explanation은 한국어 한두 문장입니다.`;
```

`response-schema.ts` 끝에 더한다.

```ts
/** 이관 응답: 요소·파라미터·표 데이터셋(각 JSON 문자열) + 설명 + 경고 */
export const IMPORT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    elements: {
      type: "array",
      description: "요소 전체. 각 원소는 요소 객체 하나의 JSON 문자열. 좌표는 0-1000 정규화 정수",
      items: { type: "string" },
    },
    params: {
      type: "array",
      description: '파라미터 선언. 각 원소는 {"name":"lotNo","type":"string"} 꼴의 JSON 문자열',
      items: { type: "string" },
    },
    datasets: {
      type: "array",
      description: '표에 딸린 정적 데이터셋. 각 원소는 {"name":"rows1","rows":[{"col":"값"}]} 꼴의 JSON 문자열',
      items: { type: "string" },
    },
    explanation: { type: "string", description: "무엇을 어떻게 옮겼는지, 컴포넌트 후보는 무엇인지 한국어 한두 문장" },
    warnings: { type: "array", description: "읽지 못한 영역 등 사람이 확인해야 할 점", items: { type: "string" } },
  },
  required: ["elements", "explanation"],
};
```

`prompt.ts` 끝에 더한다(파일 위 import에 `IMPORT_SYSTEM`, `IMPORT_RESPONSE_SCHEMA`를 추가).

```ts
/** 이관 프롬프트 (스펙 5.3). 컨텍스트는 페이지 크기뿐이다 — 빈 레포트에서만 시작하므로 압축할 모델이 없다 */
export function buildImportPrompt(page: { width: number; height: number }, image: { mimeType: string; data: string }) {
  const text = `# 대상 페이지\n${page.width}×${page.height}mm\n\n# 지시\n이 이미지의 양식을 위 페이지 크기의 레포트로 옮기세요.`;
  return { system: IMPORT_SYSTEM, messages: [{ role: "user" as const, text }], schema: IMPORT_RESPONSE_SCHEMA, images: [image] };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/ai/src/prompts/import.ko.ts packages/ai/src/prompt.ts packages/ai/src/response-schema.ts packages/ai/src/__tests__/prompt.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(ai): 이관 프롬프트와 응답 스키마

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 이관 검증기

**Files:**
- Create: `packages/ai/src/import-validate.ts`, `packages/ai/src/__tests__/import-validate.test.ts`
- Modify: `packages/ai/src/index.ts` (`export * from "./import-validate";`)

**Interfaces:**
- Consumes: core `parseReport`, `walkElements`, `ParamSchema`; T2 응답 모양.
- Produces:
```ts
export type ImportResult = {
  elements: Element[];
  params: { name: string; type: "string" | "number" | "date" }[];
  datasets: { name: string; type: "static"; rows: Record<string, unknown>[] }[];
  warnings: string[];
};
export function validateImported(report: Report, raw: unknown, page: { width: number; height: number }): ImportResult;
```
`AiValidationError`(코드 `AI_INVALID_PATCH`)를 그대로 던진다. 라우트가 이관 경로에서 이 오류를 `AI_INVALID_IMPORT`로 바꿔 응답한다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/ai/src/__tests__/import-validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { validateImported } from "../import-validate";
import { AiValidationError } from "../types";

const page = { width: 210, height: 297 };
const empty = parseReport({ id: "r", version: 1, page });
const el = (o: object) => JSON.stringify(o);

describe("validateImported", () => {
  it("정규화 좌표를 mm으로 바꾼다", () => {
    const res = validateImported(empty, { elements: [el({ id: "t1", type: "text", x: 500, y: 0, w: 250, h: 20, value: "제목" })], explanation: "" }, page);
    const t = res.elements[0];
    expect(t.x).toBeCloseTo(105, 3);      // 500/1000 * 210
    expect(t.w).toBeCloseTo(52.5, 3);     // 250/1000 * 210
    expect(t.h).toBeCloseTo(5.94, 2);     // 20/1000 * 297
  });

  it("group 자식 좌표도 mm으로 바꾼다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "g1", type: "group", x: 0, y: 0, w: 1000, h: 100, children: [{ id: "c1", type: "text", x: 100, y: 50, w: 200, h: 30, value: "안" }] })],
      explanation: "",
    }, page);
    const g = res.elements[0] as { children: { x: number; y: number }[] };
    expect(g.children[0].x).toBeCloseTo(21, 3);
    expect(g.children[0].y).toBeCloseTo(14.85, 2);
  });

  it("페이지 밖 요소를 안으로 밀고 경고를 남긴다", () => {
    const res = validateImported(empty, { elements: [el({ id: "t1", type: "text", x: 950, y: 10, w: 200, h: 20, value: "밖" })], explanation: "" }, page);
    expect(res.elements[0].x + res.elements[0].w).toBeLessThanOrEqual(210 + 1e-6);
    expect(res.warnings.join(" ")).toContain("페이지");
  });

  it("params에 없는 이름을 쓰면 표현식을 비우고 경고를 남긴다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "{{ params.lotNo }}" }), el({ id: "t2", type: "text", x: 0, y: 30, w: 100, h: 20, value: "{{ params.unknown }}" })],
      params: [JSON.stringify({ name: "lotNo", type: "string" })],
      explanation: "",
    }, page);
    expect((res.elements[0] as { value: string }).value).toBe("{{ params.lotNo }}");
    expect((res.elements[1] as { value: string }).value).toBe("");
    expect(res.params.map((p) => p.name)).toEqual(["lotNo"]);
    expect(res.warnings.join(" ")).toContain("unknown");
  });

  it("표와 rows 데이터셋을 받아들이고 열 value의 row 참조는 허용한다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1", columns: [{ header: "품명", value: "{{ row.name }}", w: 600 }, { header: "수량", value: "{{ row.qty }}", w: 400 }] })],
      datasets: [JSON.stringify({ name: "rows1", rows: [{ name: "볼트", qty: 3 }] })],
      explanation: "",
    }, page);
    expect(res.datasets).toEqual([{ name: "rows1", type: "static", rows: [{ name: "볼트", qty: 3 }] }]);
    expect(res.elements[0].type).toBe("table");
  });

  it("이름 규칙을 어긴 데이터셋은 그것을 쓰는 표와 함께 버린다", () => {
    const res = validateImported(empty, {
      elements: [
        el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "sales", columns: [{ header: "a", value: "{{ row.a }}", w: 1000 }] }),
        el({ id: "t1", type: "text", x: 0, y: 500, w: 100, h: 20, value: "남는다" }),
      ],
      datasets: [JSON.stringify({ name: "sales", rows: [] })],
      explanation: "",
    }, page);
    expect(res.datasets).toEqual([]);
    expect(res.elements.map((e) => e.id)).toEqual(["t1"]);
    expect(res.warnings.join(" ")).toContain("sales");
  });

  it("rows는 20행까지만 남긴다", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ a: i }));
    const res = validateImported(empty, {
      elements: [el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1", columns: [{ header: "a", value: "{{ row.a }}", w: 1000 }] })],
      datasets: [JSON.stringify({ name: "rows1", rows })],
      explanation: "",
    }, page);
    expect(res.datasets[0].rows).toHaveLength(20);
    expect(res.warnings.join(" ")).toContain("20");
  });

  it("표 밖의 row 참조는 비운다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "{{ row.qty }}" })],
      explanation: "",
    }, page);
    expect((res.elements[0] as { value: string }).value).toBe("");
    expect(res.warnings.join(" ")).toContain("row");
  });

  it("깨진 요소 JSON은 그 요소만 버린다", () => {
    const res = validateImported(empty, { elements: ["{깨짐", el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "정상" })], explanation: "" }, page);
    expect(res.elements).toHaveLength(1);
    expect(res.warnings.join(" ")).toContain("건너뜀");
  });

  it("id가 겹치면 바꾸고 경고를 남긴다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "A" }), el({ id: "t1", type: "text", x: 0, y: 30, w: 100, h: 20, value: "B" })],
      explanation: "",
    }, page);
    expect(new Set(res.elements.map((e) => e.id)).size).toBe(2);
    expect(res.warnings.join(" ")).toContain("id");
  });

  it("elements 배열이 없으면 던진다", () => {
    expect(() => validateImported(empty, { explanation: "" }, page)).toThrow(AiValidationError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/ai test -- import-validate`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`packages/ai/src/import-validate.ts`:

```ts
import { parseReport, safeParseReport, walkElements, type Element, type Report } from "@daport/core";
import { AiValidationError } from "./types";

const MAX_ROWS = 20;
const DATASET_NAME_RE = /^rows[0-9]+$/;
const PARAM_TYPES = new Set(["string", "number", "date"]);

export type ImportParam = { name: string; type: "string" | "number" | "date" };
export type ImportDataset = { name: string; type: "static"; rows: Record<string, unknown>[] };
export type ImportResult = { elements: Element[]; params: ImportParam[]; datasets: ImportDataset[]; warnings: string[] };

/** 모델이 낸 JSON 문자열 배열을 파싱한다. 깨진 항목은 버리고 경고만 남긴다 */
function parseItems(raw: unknown, label: string, warnings: string[]): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      warnings.push(`${label} 항목이 문자열이 아니라 건너뜀`);
      continue;
    }
    try {
      out.push(JSON.parse(item));
    } catch {
      warnings.push(`${label} JSON을 읽지 못해 건너뜀`);
    }
  }
  return out;
}

/** 0-1000 정규화 좌표를 mm으로. 가로는 페이지 너비, 세로는 높이 기준이다 */
function toMm(el: Record<string, unknown>, page: { width: number; height: number }): void {
  const sx = (n: number) => (n / 1000) * page.width;
  const sy = (n: number) => (n / 1000) * page.height;
  if (typeof el.x === "number") el.x = sx(el.x);
  if (typeof el.w === "number") el.w = sx(el.w);
  if (typeof el.y === "number") el.y = sy(el.y);
  if (typeof el.h === "number") el.h = sy(el.h);
  // 표 열 너비도 가로 기준으로 바꾼다 — 합이 표 w와 같아야 스키마·렌더가 맞는다
  if (el.type === "table" && Array.isArray(el.columns)) {
    for (const c of el.columns as Record<string, unknown>[]) if (typeof c.w === "number") c.w = sx(c.w);
  }
  for (const child of childArrays(el)) for (const c of child) toMm(c, page);
}

/** 스키마 검증 전이라 core walkElements를 쓸 수 없다. 자식 배열을 직접 훑는다 */
function childArrays(el: Record<string, unknown>): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  if (Array.isArray(el.children)) out.push(el.children as Record<string, unknown>[]);
  for (const key of ["item", "header", "footer"]) {
    const band = el[key] as Record<string, unknown> | undefined;
    if (band && Array.isArray(band.children)) out.push(band.children as Record<string, unknown>[]);
  }
  return out;
}

/** 요소 트리의 모든 문자열 값을 제자리에서 고친다. inTable이면 row 참조를 허용한다 */
function fixExpressions(el: Record<string, unknown>, allowed: Set<string>, warnings: string[]): void {
  const clean = (v: string): string => {
    for (const m of v.matchAll(/\{\{\s*params\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!allowed.has(m[1])) {
        warnings.push(`선언되지 않은 파라미터 ${m[1]}를 써서 표현식을 비웠습니다`);
        return "";
      }
    }
    if (/\{\{[^}]*\b(row|record)\./.test(v)) {
      warnings.push("표 밖에서 row 참조를 써서 표현식을 비웠습니다");
      return "";
    }
    return v;
  };
  if (typeof el.value === "string" && el.type !== "table") el.value = clean(el.value);
  if (typeof el.src === "string") el.src = clean(el.src);
  if (typeof el.visible === "string") el.visible = clean(el.visible);
  for (const child of childArrays(el)) for (const c of child) fixExpressions(c, allowed, warnings);
}

/** 최상위 요소를 페이지 안으로 민다. 자식 좌표는 부모 기준이 아니라 이미지 기준이라 같이 움직인다 */
function clampToPage(el: Record<string, unknown>, page: { width: number; height: number }, warnings: string[]): void {
  const w = typeof el.w === "number" ? el.w : 0;
  const h = typeof el.h === "number" ? el.h : 0;
  const x = typeof el.x === "number" ? el.x : 0;
  const y = typeof el.y === "number" ? el.y : 0;
  const nx = Math.min(Math.max(0, x), Math.max(0, page.width - w));
  const ny = Math.min(Math.max(0, y), Math.max(0, page.height - h));
  if (nx !== x || ny !== y) {
    warnings.push(`요소 ${String(el.id)}를 페이지 안으로 옮겼습니다`);
    const dx = nx - x;
    const dy = ny - y;
    el.x = nx;
    el.y = ny;
    for (const child of childArrays(el)) for (const c of child) shift(c, dx, dy);
  }
}

function shift(el: Record<string, unknown>, dx: number, dy: number): void {
  if (typeof el.x === "number") el.x += dx;
  if (typeof el.y === "number") el.y += dy;
  for (const child of childArrays(el)) for (const c of child) shift(c, dx, dy);
}

/**
 * 이관 응답을 검증한다 (스펙 6장): 파싱 → mm 변환 → 페이지 보정 → id 정리 →
 * params 병합 → datasets 규칙 → parseReport. 원본 report는 건드리지 않는다
 */
export function validateImported(report: Report, raw: unknown, page: { width: number; height: number }): ImportResult {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { elements?: unknown }).elements)) {
    throw new AiValidationError("응답에 elements 배열이 없습니다");
  }
  const warnings: string[] = [];
  const r = raw as { elements: unknown[]; params?: unknown; datasets?: unknown };

  const elements = parseItems(r.elements, "요소", warnings).filter(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
  );

  // params: 이름·타입 규칙을 통과한 것만. 기존 이름과 겹치면 모델 쪽을 버린다
  const existing = new Set(report.params.map((p) => p.name));
  const params: ImportParam[] = [];
  for (const p of parseItems(r.params, "파라미터", warnings)) {
    const o = p as { name?: unknown; type?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      warnings.push(`파라미터 이름 규칙을 어겨 버렸습니다: ${name}`);
      continue;
    }
    if (existing.has(name)) continue;
    const type = typeof o.type === "string" && PARAM_TYPES.has(o.type) ? (o.type as ImportParam["type"]) : "string";
    params.push({ name, type });
    existing.add(name);
  }

  // datasets: rows<N> 정적만, 20행까지
  const datasets: ImportDataset[] = [];
  for (const d of parseItems(r.datasets, "데이터셋", warnings)) {
    const o = d as { name?: unknown; rows?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    if (!DATASET_NAME_RE.test(name)) {
      warnings.push(`데이터셋 이름 규칙(rows<숫자>)을 어겨 버렸습니다: ${name}`);
      continue;
    }
    const rows = Array.isArray(o.rows) ? (o.rows as Record<string, unknown>[]) : [];
    if (rows.length > MAX_ROWS) warnings.push(`${name}의 행이 많아 ${MAX_ROWS}행까지만 남겼습니다`);
    datasets.push({ name, type: "static", rows: rows.slice(0, MAX_ROWS) });
  }

  // 남은 데이터셋이 없는 표는 렌더할 수 없다 — 표를 함께 버린다
  const names = new Set(datasets.map((d) => d.name));
  const kept = elements.filter((e) => {
    if (e.type !== "table") return true;
    const src = typeof e.source === "string" ? e.source : "";
    if (names.has(src)) return true;
    warnings.push(`데이터셋 ${src || "(없음)"}을 쓸 수 없어 표를 버렸습니다`);
    return false;
  });
  // 표가 하나도 남지 않았으면 데이터셋도 의미가 없다
  const usedNames = new Set(kept.filter((e) => e.type === "table").map((e) => String(e.source)));
  const finalDatasets = datasets.filter((d) => usedNames.has(d.name));

  const allowed = new Set(params.map((p) => p.name).concat([...existing]));
  for (const e of kept) {
    toMm(e, page);
    fixExpressions(e, allowed, warnings);
    clampToPage(e, page, warnings);
  }

  // id 중복 정리
  const seen = new Set<string>();
  for (const e of kept) {
    let id = typeof e.id === "string" && e.id ? e.id : `${String(e.type)}-1`;
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n += 1;
      warnings.push(`id 충돌로 ${id} → ${id}-${n}로 바꿨습니다`);
      id = `${id}-${n}`;
    }
    e.id = id;
    seen.add(id);
  }

  const candidate = {
    ...report,
    elements: kept,
    params: [...report.params, ...params],
    datasets: [...report.datasets, ...finalDatasets],
  };
  const parsed = safeParseReport(candidate);
  if (!parsed.success) {
    const msgs = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AiValidationError(`인식 결과가 스키마를 통과하지 못했습니다: ${msgs}`);
  }
  return { elements: parsed.data.elements, params, datasets: finalDatasets, warnings };
}
```

`index.ts`에 한 줄 더한다.

```ts
export * from "./import-validate";
```

구현자 주의: `parseReport`·`walkElements` import가 실제로 쓰이지 않으면 지운다. 위 코드는 `safeParseReport`만 쓴다. `childArrays`가 훑는 키(`children`, `item`, `header`, `footer`)는 `packages/core/src/schema/tree.ts`의 실제 자식 배열과 맞는지 열어 확인하고, 다르면 실제 이름에 맞춰 고치고 보고한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/ai test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/ai/src/import-validate.ts packages/ai/src/__tests__/import-validate.test.ts packages/ai/src/index.ts
git -c core.hooksPath=/dev/null commit -m "feat(ai): 이관 응답 검증기 (좌표 변환, params, rows 데이터셋, 페이지 보정)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 이미지 전처리

**Files:**
- Modify: `apps/studio/package.json`(`sharp` 의존), `apps/studio/next.config.ts`(`serverExternalPackages`), `pnpm-lock.yaml`
- Create: `apps/studio/src/lib/scan.ts`, `apps/studio/src/lib/__tests__/scan.test.ts`

**Interfaces:**
- Produces:
```ts
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
export class ImageInputError extends Error { constructor(readonly code: "IMAGE_TOO_LARGE" | "IMAGE_UNSUPPORTED", message: string); }
export type ScanResult = { data: Buffer; mimeType: "image/jpeg"; width: number; height: number; angle: number; notes: string[] };
export async function preprocessScan(input: Buffer): Promise<ScanResult>;
```

- [ ] **Step 1: 의존 추가**

```bash
cd /Users/jerry/daport && pnpm --filter studio add sharp
```

`apps/studio/next.config.ts`의 `serverExternalPackages`에 `"sharp"`를 더한다.

```ts
  serverExternalPackages: ["playwright", "oracledb", "sharp"],
```

- [ ] **Step 2: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/scan.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { preprocessScan, ImageInputError, MAX_IMAGE_BYTES } from "../scan";

/** 흰 바탕에 검은 가로줄 여러 개를 그린 이미지. angle만큼 기울여 내보낸다 */
async function ruled(angle: number, pad = 0): Promise<Buffer> {
  const lines = Array.from({ length: 20 }, (_, i) => `<rect x="60" y="${40 + i * 40}" width="680" height="10" fill="#000"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="#fff"/>${lines}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (angle !== 0) img = img.rotate(angle, { background: "#ffffff" });
  if (pad > 0) img = img.extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" });
  return img.png().toBuffer();
}

describe("preprocessScan", () => {
  it("기울어진 스캔의 각도를 1도 안쪽으로 잡아 되돌린다", async () => {
    const res = await preprocessScan(await ruled(3));
    expect(Math.abs(res.angle - 3)).toBeLessThanOrEqual(1);
    expect(res.mimeType).toBe("image/jpeg");
    expect(res.notes.join(" ")).toContain("기울기");
  }, 30_000);

  it("기울지 않은 이미지는 회전하지 않는다", async () => {
    const res = await preprocessScan(await ruled(0));
    expect(Math.abs(res.angle)).toBeLessThan(0.5);
  }, 30_000);

  it("흰 여백을 잘라내고 긴 변을 2000px 이하로 줄인다", async () => {
    const res = await preprocessScan(await ruled(0, 120));
    expect(res.width).toBeLessThanOrEqual(2000);
    expect(res.height).toBeLessThanOrEqual(2000);
    expect(res.height).toBeLessThan(900 + 240);      // 여백이 남지 않았다
  }, 30_000);

  it("이미지가 아니면 IMAGE_UNSUPPORTED", async () => {
    await expect(preprocessScan(Buffer.from("not an image"))).rejects.toMatchObject({ code: "IMAGE_UNSUPPORTED" });
  });

  it("한도를 넘는 바이트는 IMAGE_TOO_LARGE", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    await expect(preprocessScan(big)).rejects.toBeInstanceOf(ImageInputError);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter studio test -- scan`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

`apps/studio/src/lib/scan.ts`:

```ts
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const LONG_EDGE = 2000;
const DESKEW_EDGE = 1000;
const MAX_ANGLE = 10;
const ANGLE_STEP = 0.5;

export class ImageInputError extends Error {
  constructor(readonly code: "IMAGE_TOO_LARGE" | "IMAGE_UNSUPPORTED", message: string) {
    super(message);
    this.name = "ImageInputError";
  }
}

export type ScanResult = { data: Buffer; mimeType: "image/jpeg"; width: number; height: number; angle: number; notes: string[] };

/** 행별 어두운 픽셀 수의 분산. 글줄이 수평일 때 최대가 된다 */
function rowVariance(gray: Buffer, width: number, height: number): number {
  const sums = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) s += 255 - gray[y * width + x];
    sums[y] = s;
  }
  let mean = 0;
  for (const s of sums) mean += s;
  mean /= height;
  let v = 0;
  for (const s of sums) v += (s - mean) ** 2;
  return v / height;
}

/** -10°~+10°를 0.5° 간격으로 훑어 분산이 가장 큰 각도를 고른다 */
async function estimateAngle(base: sharp.Sharp): Promise<number> {
  const small = await base.clone().greyscale().resize({ width: DESKEW_EDGE, height: DESKEW_EDGE, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  let best = 0;
  let bestScore = -1;
  for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
    const rotated = a === 0
      ? { data: small.data, info: small.info }
      : await sharp(small.data, { raw: { width: small.info.width, height: small.info.height, channels: small.info.channels } })
          .rotate(a, { background: "#ffffff" })
          .raw()
          .toBuffer({ resolveWithObject: true });
    const score = rowVariance(rotated.data, rotated.info.width, rotated.info.height);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * 스캔 전처리 (스펙 4.1): EXIF 회전 → 기울기 보정 → 여백 트림 → 리사이즈 → JPEG.
 * 메타데이터는 싣지 않는다(EXIF 위치 정보가 에셋에 남지 않게)
 */
export async function preprocessScan(input: Buffer): Promise<ScanResult> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageInputError("IMAGE_TOO_LARGE", "이미지가 20MB를 넘습니다");

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new ImageInputError("IMAGE_UNSUPPORTED", "PNG 또는 JPEG 이미지만 올릴 수 있습니다");
  }
  if (meta.format !== "png" && meta.format !== "jpeg") throw new ImageInputError("IMAGE_UNSUPPORTED", "PNG 또는 JPEG 이미지만 올릴 수 있습니다");
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_IMAGE_PIXELS) throw new ImageInputError("IMAGE_TOO_LARGE", "이미지 픽셀 수가 한도를 넘습니다");

  const notes: string[] = [];
  const upright = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();   // 인자 없는 rotate가 EXIF 방향을 적용한다
  const angle = await estimateAngle(upright);

  let work = upright.clone();
  if (Math.abs(angle) >= ANGLE_STEP) {
    work = work.rotate(angle, { background: "#ffffff" });
    notes.push(`기울기 ${angle.toFixed(1)}도를 보정했습니다`);
  }

  const beforeTrim = await work.clone().toBuffer({ resolveWithObject: true });
  const trimmed = await work.clone().trim().toBuffer({ resolveWithObject: true }).catch(() => beforeTrim);
  const beforeArea = beforeTrim.info.width * beforeTrim.info.height;
  const trimArea = trimmed.info.width * trimmed.info.height;
  // 트림이 너무 많이 먹었으면(종이보다 어두운 배경 등) 버린다
  const chosen = trimArea >= beforeArea * 0.3 ? trimmed : beforeTrim;
  if (chosen === trimmed && trimArea < beforeArea) notes.push(`바깥 여백을 잘라냈습니다 (${trimmed.info.width}×${trimmed.info.height})`);

  const resized = sharp(chosen.data).resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true });
  let out = await resized.clone().jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (out.data.byteLength > MAX_OUTPUT_BYTES) out = await resized.clone().jpeg({ quality: 60 }).toBuffer({ resolveWithObject: true });
  if (out.data.byteLength > MAX_OUTPUT_BYTES) {
    out = await sharp(chosen.data).resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer({ resolveWithObject: true });
  }

  return { data: out.data, mimeType: "image/jpeg", width: out.info.width, height: out.info.height, angle, notes };
}
```

구현자 주의: `estimateAngle`이 41번 회전하므로 축소본에서만 돌린다. 테스트가 30초를 넘기면 `DESKEW_EDGE`를 600으로 줄이고 그 값으로 다시 잰다(정확도 1도 요건은 유지). 바꿨으면 보고한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test -- scan && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/package.json pnpm-lock.yaml apps/studio/next.config.ts apps/studio/src/lib/scan.ts apps/studio/src/lib/__tests__/scan.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): sharp 스캔 전처리 (EXIF·기울기·트림·리사이즈)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 이관 라우트

**Files:**
- Create: `apps/studio/src/app/api/reports/[id]/ai/import/route.ts`
- Modify: `apps/studio/src/lib/ai.ts`(이관 오류 매핑, `fakeScript` 이관 분기)
- Test: `apps/studio/src/app/api/reports/__tests__/ai-import-route.test.ts`

**Interfaces:**
- Consumes: T2 `buildImportPrompt`, T3 `validateImported`, T4 `preprocessScan`·`ImageInputError`, 기존 `getLlmClient`·`aiErrorResponse`·`readJsonBody`, `lib/asset-io.ts`.
- Produces: `POST /api/reports/:id/ai/import` → `{ elements, params, datasets, explanation, warnings, scan: { src, angle } }`. `scan.src`는 에셋 저장소가 켜져 있으면 `asset://<id>`, 꺼져 있으면(개발·E2E) `data:image/jpeg;base64,...`다. 전처리본이 1MB를 넘고 저장소도 없으면 `null`이다.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/app/api/reports/__tests__/ai-import-route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import { FakeLlmClient } from "@daport/ai/testing";
import { LlmError } from "@daport/ai";

let fake: FakeLlmClient;
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getLlmClient: () => fake }));
const { POST } = await import("../[id]/ai/import/route");

const ctx = { params: Promise.resolve({ id: "r" }) };
const report = { id: "r", name: "R", version: 1, page: { width: 210, height: 297 }, elements: [] };

async function png(): Promise<string> {
  const buf = await sharp({ create: { width: 400, height: 560, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return buf.toString("base64");
}

const post = async (body: unknown) =>
  POST(new Request("http://localhost/api/reports/r/ai/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);

describe("POST ai/import", () => {
  beforeEach(() => {
    fake = new FakeLlmClient({
      elements: [JSON.stringify({ id: "t1", type: "text", x: 100, y: 100, w: 400, h: 40, value: "{{ params.lotNo }}" })],
      params: [JSON.stringify({ name: "lotNo", type: "string" })],
      explanation: "제목과 값 칸을 옮겼습니다",
      warnings: [],
    });
  });

  it("요소·파라미터·설명·스캔 에셋을 돌려준다", async () => {
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", type: "text" });
    expect(body.elements[0].x).toBeCloseTo(21, 3);          // 100/1000 * 210
    expect(body.params).toEqual([{ name: "lotNo", type: "string" }]);
    expect(body.scan.src).toMatch(/^(asset:\/\/|data:image\/jpeg;base64,)/);   // 저장소가 없으면 data URL
    expect(typeof body.scan.angle).toBe("number");
    expect(JSON.stringify(body)).not.toMatch(/0-1000|시스템|프롬프트/);   // 프롬프트 비노출
    expect(fake.calls[0].images).toHaveLength(1);
    expect(fake.calls[0].images![0].mimeType).toBe("image/jpeg");        // 전처리 결과를 보낸다
  }, 30_000);

  it("요소가 있는 레포트는 400 AI_NOT_EMPTY", async () => {
    const withEl = { ...report, elements: [{ id: "x", type: "text", x: 0, y: 0, w: 10, h: 10, value: "a" }] };
    const res = await post({ report: withEl, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("AI_NOT_EMPTY");
  }, 30_000);

  it("이미지가 아니면 415, 너무 크면 413", async () => {
    const bad = await post({ report, image: { mimeType: "image/png", dataBase64: Buffer.from("nope").toString("base64") }, preset: { width: 210, height: 297 } });
    expect(bad.status).toBe(415);
    expect((await bad.json()).code).toBe("IMAGE_UNSUPPORTED");

    const big = await post({ report, image: { mimeType: "image/png", dataBase64: Buffer.alloc(21 * 1024 * 1024).toString("base64") }, preset: { width: 210, height: 297 } });
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe("IMAGE_TOO_LARGE");
  }, 30_000);

  it("검증 실패는 400 AI_INVALID_IMPORT, LlmError는 5단계 표대로", async () => {
    fake = new FakeLlmClient({ explanation: "" });   // elements 없음
    const bad = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("AI_INVALID_IMPORT");

    fake = new FakeLlmClient(() => { throw new LlmError("LLM_TIMEOUT", "m"); });
    const slow = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(slow.status).toBe(504);
    expect((await slow.json()).code).toBe("AI_TIMEOUT");
  }, 30_000);

  it("클라이언트가 없으면 503", async () => {
    fake = null as never;
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("AI_NOT_CONFIGURED");
  }, 30_000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- ai-import-route`
Expected: FAIL (라우트 없음)

- [ ] **Step 3: 구현**

`apps/studio/src/lib/ai.ts`에 더한다. `aiErrorResponse`는 그대로 두고 이관 전용 래퍼를 만든다.

```ts
import { ImageInputError } from "./scan";

/** 이관 오류 → 응답 (스펙 8장). 이미지 오류와 검증 오류만 다르고 나머지는 공통 매핑을 쓴다 */
export function importErrorResponse(e: unknown): NextResponse {
  if (e instanceof ImageInputError) {
    const status = e.code === "IMAGE_TOO_LARGE" ? 413 : 415;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  if (e instanceof AiValidationError) return NextResponse.json({ error: e.message, code: "AI_INVALID_IMPORT" }, { status: 400 });
  return aiErrorResponse(e);
}
```

`fakeScript`에 이관 분기를 맨 앞에 더한다. 판별 문구는 T2 `IMPORT_SYSTEM`에 실제로 들어 있는 `"0-1000"`을 쓴다.

```ts
  if (input.system.includes("0-1000")) {   // 이관 프롬프트
    return {
      elements: [
        JSON.stringify({ id: "title", type: "text", x: 100, y: 40, w: 800, h: 40, value: "검사 성적서", style: { fontSize: 16, bold: true, align: "center" } }),
        JSON.stringify({ id: "lot", type: "text", x: 100, y: 120, w: 400, h: 30, value: "{{ params.lotNo }}" }),
      ],
      params: [JSON.stringify({ name: "lotNo", type: "string" })],
      datasets: [],
      explanation: "제목과 값 칸을 옮겼습니다. 머리글 그룹은 컴포넌트 후보입니다",
      warnings: ["도장 영역은 읽지 못했습니다"],
    };
  }
```

`apps/studio/src/app/api/reports/[id]/ai/import/route.ts`:

```ts
import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { buildImportPrompt, validateImported } from "@daport/ai";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { getLlmClient, importErrorResponse } from "@/lib/ai";
import { preprocessScan } from "@/lib/scan";
import { assetStorageEnabled, putAsset } from "@/lib/asset-io";
import { randomUUID } from "node:crypto";

export const maxDuration = 120;

/** 스캔 이미지 → 요소 제안 (스펙 7장). 빈 레포트에서만 시작한다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;
  const client = getLlmClient();
  if (!client) return NextResponse.json({ error: "서버에 GEMINI_API_KEY를 설정하세요", code: "AI_NOT_CONFIGURED" }, { status: 503 });

  const started = Date.now();
  try {
    const report = parseReport(b.report);
    if (report.elements.length > 0) return NextResponse.json({ error: "빈 레포트에서만 이관할 수 있습니다", code: "AI_NOT_EMPTY" }, { status: 400 });

    const image = b.image as { dataBase64?: unknown } | undefined;
    if (!image || typeof image.dataBase64 !== "string") return NextResponse.json({ error: "이미지를 올리세요", code: "IMAGE_UNSUPPORTED" }, { status: 415 });
    const scan = await preprocessScan(Buffer.from(image.dataBase64, "base64"));

    const preset = b.preset as { width?: unknown; height?: unknown } | undefined;
    const page = {
      width: typeof preset?.width === "number" && preset.width > 0 ? preset.width : report.page.width,
      height: typeof preset?.height === "number" && preset.height > 0 ? preset.height : report.page.height,
    };

    const prompt = buildImportPrompt(page, { mimeType: scan.mimeType, data: scan.data.toString("base64") });
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, images: prompt.images, signal: req.signal });
    const result = validateImported({ ...report, page: { ...report.page, ...page } }, raw, page);

    // 에셋 저장소는 Blob 토큰이 있을 때만 쓴다. 개발·E2E에는 토큰이 없어 작은 이미지는 data URL로 돌려준다
    const src = await storeScan(scan);
    const ratio = scan.width / scan.height;
    const target = page.width / page.height;
    const warnings = [...scan.notes, ...result.warnings];
    if (Math.abs(ratio - target) / target > 0.05) warnings.push("이미지 비율이 선택한 용지와 5% 넘게 달라 요소 위치가 늘어났을 수 있습니다");

    const explanation = typeof (raw as { explanation?: unknown }).explanation === "string" ? (raw as { explanation: string }).explanation : "";
    console.log(`[ai] ts=${new Date().toISOString()} id=${report.id} kind=import ms=${Date.now() - started} px=${scan.width}x${scan.height} elements=${result.elements.length}`);
    return NextResponse.json({ elements: result.elements, params: result.params, datasets: result.datasets, explanation, warnings, scan: { src, angle: scan.angle } });
  } catch (e) {
    return importErrorResponse(e);
  }
}
```

같은 파일에 저장 헬퍼를 둔다.

```ts
const MAX_DATA_URL_BYTES = 1024 * 1024;

/** 전처리본을 어디에 둘지 정한다. Blob 토큰이 있으면 에셋으로, 없으면 작은 이미지에 한해 data URL로 */
async function storeScan(scan: { data: Buffer; mimeType: "image/jpeg" }): Promise<string | null> {
  if (assetStorageEnabled()) {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    await putAsset({ id, name: "scan.jpg", mime: scan.mimeType, data: new Uint8Array(scan.data) });
    return `asset://${id}`;
  }
  if (scan.data.byteLength <= MAX_DATA_URL_BYTES) return `data:${scan.mimeType};base64,${scan.data.toString("base64")}`;
  return null;   // 저장할 곳이 없고 본문에 싣기엔 크다 — 대조 배경 없이 진행한다
}
```

구현자 주의: `putAsset`의 인자는 `{ id, name, mime, data }`인 `BundleAsset`이다(`lib/asset-io.ts`, `lib/bundle.ts`). 시그니처가 다르면 실제 모양에 맞추고 보고한다. `MAX_ASSET_BYTES`는 5MB이고 전처리 출력은 4MB 이하라 한도를 넘지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/app/api/reports/[id]/ai/import apps/studio/src/lib/ai.ts apps/studio/src/app/api/reports/__tests__/ai-import-route.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): 이관 라우트와 오류 매핑, 가짜 이관 응답

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 이관 UI와 대조 배경

**Files:**
- Modify: `apps/studio/src/editor/ai/proposal.ts`, `apps/studio/src/editor/ai/api.ts`, `apps/studio/src/editor/ai/AiPanel.tsx`, `apps/studio/src/editor/canvas/Canvas.tsx`, `apps/studio/src/editor/store.ts`
- Test: `apps/studio/src/editor/ai/__tests__/AiPanel.test.tsx`, `apps/studio/src/editor/ai/__tests__/proposal.test.ts`

**Interfaces:**
- Consumes: T5 라우트 응답.
- Produces:
```ts
// proposal.ts
export function proposalFromImport(base: Report, res: { elements: Element[]; params: Param[]; datasets: Dataset[]; explanation: string; warnings: string[] }): Proposal;
// store.ts
scanOverlay: string | null;          // asset://id 또는 data URL. 캔버스 대조 배경
setScanOverlay(v: string | null): void;
```
`Proposal.kind`에 `"import"`를 더한다.

- [ ] **Step 1: 실패 테스트 작성**

`proposal.test.ts`에 더한다.

```ts
  it("proposalFromImport는 요소·파라미터·데이터셋을 함께 넣는다", () => {
    const p = proposalFromImport(base, {
      elements: [{ id: "t1", type: "text", x: 1, y: 1, w: 10, h: 5, value: "A" } as never],
      params: [{ name: "lotNo", type: "string" } as never],
      datasets: [{ name: "rows1", type: "static", rows: [] } as never],
      explanation: "옮겼습니다",
      warnings: ["도장 못 읽음"],
    });
    expect(p.kind).toBe("import");
    expect(p.next.elements).toHaveLength(1);
    expect(p.next.params.map((x) => x.name)).toContain("lotNo");
    expect(p.next.datasets.map((d) => d.name)).toContain("rows1");
    expect(p.changes.added).toEqual(["t1"]);
    expect(p.warnings).toContain("도장 못 읽음");
  });
```

`AiPanel.test.tsx`에 더한다.

```ts
  it("빈 레포트에서 이미지를 올리면 이관을 호출하고 제안과 대조 배경을 세운다", async () => {
    const fetchMock = vi.fn(async () => json({
      elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 50, h: 8, value: "검사 성적서" }],
      params: [], datasets: [], explanation: "옮겼습니다", warnings: [], scan: { src: "asset://abc123", angle: 3 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } }));
    const file = new File([new Uint8Array([1, 2, 3])], "form.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("ai-import-file"), { target: { files: [file] } });
    await waitFor(() => expect(store.getState().proposal?.kind).toBe("import"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/ai/import");
    expect(store.getState().scanOverlay).toBe("asset://abc123");   // 응답의 scan.src를 그대로 쓴다
    expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("옮겼습니다");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- proposal AiPanel`
Expected: FAIL

- [ ] **Step 3: 구현**

`proposal.ts`에 더한다. 기존 `proposalFromGenerate` 바로 아래에 둔다.

```ts
/** 이관 응답 → 제안. 요소뿐 아니라 params·datasets도 함께 바뀐다 */
export function proposalFromImport(
  base: Report,
  res: { elements: Element[]; params: Report["params"]; datasets: Report["datasets"]; explanation: string; warnings: string[] },
): Proposal {
  const next = parseReport({
    ...base,
    elements: res.elements,
    params: [...base.params, ...res.params],
    datasets: [...base.datasets, ...res.datasets],
  });
  const otherOps: string[] = [];
  if (res.params.length > 0) otherOps.push(`파라미터 ${res.params.length}개 추가`);
  if (res.datasets.length > 0) otherOps.push(`데이터셋 ${res.datasets.length}개 추가`);
  return { kind: "import", patch: [], explanation: res.explanation, warnings: res.warnings, next, changes: diffIds(base, next), otherOps, base };
}
```

`Proposal["kind"]` 타입에 `"import"`를 더한다. `otherOps`는 5단계 수정 라운드에서 들어간 필드다. 실제 이름과 모양을 `proposal.ts`에서 확인해 맞춘다.

`api.ts`에 이관 호출을 더한다.

```ts
export type ImportResponse = {
  elements: Element[]; params: Report["params"]; datasets: Report["datasets"];
  explanation: string; warnings: string[]; scan: { assetId: string; angle: number };
};

/** 이미지를 base64로 실어 이관을 요청한다. 파일을 그대로 보내지 않는 이유는 라우트가 JSON content-type 검사를 공유하기 때문이다 */
export async function postImport(reportId: string, file: File, preset: { width: number; height: number }, signal?: AbortSignal) {
  const dataBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return postAi<ImportResponse>(reportId, "import", { image: { mimeType: file.type, dataBase64 }, preset }, signal);
}
```

구현자 주의: 브라우저에는 `Buffer`가 없다. `btoa(String.fromCharCode(...new Uint8Array(buf)))`는 큰 파일에서 스택을 넘긴다. 청크로 나눠 인코딩하는 작은 헬퍼를 `api.ts`에 두고 그것을 쓴다. `postAi`의 `kind` 타입도 `"edit" | "generate" | "import"`로 넓힌다.

`AiPanel.tsx`: 빈 레포트일 때만 보이는 파일 입력을 더한다. 생성 모드 토글 옆이다.

```tsx
      {isEmpty && (
        <label className="text-xs text-neutral-600">
          양식 이미지로 시작
          <input data-testid="ai-import-file" type="file" accept="image/png,image/jpeg" className="ml-2" disabled={busy} onChange={onPickImage} />
        </label>
      )}
```

`onPickImage`는 `send`와 같은 뼈대를 쓴다. 사용자 턴에 파일 이름을 적고, `postImport`를 부르고, 성공하면 `setProposal(proposalFromImport(report, res.data))`와 `setScanOverlay(res.data.scan.src)`를 부른다(`src`가 `null`이면 배경 없이 진행한다). 실패·취소·언마운트 처리는 기존 `handleResult`·`mountedRef` 규칙을 그대로 따른다.

`store.ts`: `scanOverlay: string | null`과 `setScanOverlay`를 더한다. 제안 폐기와 달리 편집이 일어나도 지우지 않는다. 대조는 이관 후에도 계속 쓴다.

`Canvas.tsx`: 페이지 안, 요소 아래에 배경 레이어를 그린다.

```tsx
        {scanOverlay && (
          <img data-testid="scan-overlay" src={scanOverlay.startsWith("asset://") ? `/api/assets/${scanOverlay.slice(8)}` : scanOverlay} alt=""
            className="absolute inset-0 w-full h-full object-fill opacity-30 pointer-events-none" />
        )}
```

토글 버튼은 툴바가 아니라 AI 탭에 둔다(이관 맥락에서만 쓰인다). `scanOverlay`가 있을 때만 보인다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/editor/ai apps/studio/src/editor/canvas/Canvas.tsx apps/studio/src/editor/store.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): 양식 이미지 이관 UI와 캔버스 대조 배경

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 환경 예시·문서·E2E

**Files:**
- Modify: `apps/studio/.env.example`, `packages/ai/README.md`
- Create: `apps/studio/e2e/fixtures/form.png`, `apps/studio/e2e/phase6.spec.ts`

**Interfaces:**
- Consumes: T5 `fakeScript` 이관 분기, T6 testid.

- [ ] **Step 1: 환경 예시와 README**

`.env.example`에 한 줄 더한다.

```
# 이관(이미지 → 양식) 모델 호출 제한 시간. 비전 호출이라 편집보다 길게 둔다
AI_IMPORT_TIMEOUT_MS=90000
```

`packages/ai/README.md`에 "이관" 절을 더한다. 공개 API(`buildImportPrompt`, `validateImported`, `IMPORT_RESPONSE_SCHEMA`, `LlmInput.images`), 좌표 규칙, 표에 딸린 `rows<N>` 데이터셋 규칙, 알려진 제약(0–1000 좌표라 이미지 비율이 용지와 다르면 늘어남)을 적는다. 수동 검증 기록 표에 이관 항목을 더하고, 키가 없으면 "미실행"과 실행 명령을 적는다.

- [ ] **Step 2: 고정 이미지 만들기**

E2E에 쓸 작은 PNG를 만든다. 실제 스캔본이 아니라 합성 이미지다.

```bash
cd /Users/jerry/daport/apps/studio && mkdir -p e2e/fixtures && node -e "
const sharp=require('sharp');
const svg='<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"600\" height=\"840\"><rect width=\"600\" height=\"840\" fill=\"#fff\"/><text x=\"300\" y=\"80\" font-size=\"32\" text-anchor=\"middle\">검사 성적서</text><rect x=\"60\" y=\"140\" width=\"480\" height=\"40\" fill=\"none\" stroke=\"#000\"/></svg>';
sharp(Buffer.from(svg)).png().toFile('e2e/fixtures/form.png').then(()=>console.log('ok'));
"
```

- [ ] **Step 3: E2E 작성**

`apps/studio/e2e/phase6.spec.ts`:

```ts
// dev 서버에 AI_FAKE=1이 있어야 한다 (playwright.config webServer.env가 넣는다). 가짜 응답은 lib/ai.ts의 fakeScript
import { test, expect } from "@playwright/test";
import path from "node:path";

test("이미지 이관: 업로드 → 제안 → 적용 → 되돌리기", async ({ page }) => {
  const id = `e2e-ai-import-${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));

  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await page.getByTestId("ai-import-file").setInputFiles(path.join(__dirname, "fixtures/form.png"));

  await expect(page.getByTestId("ai-proposal")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ai-proposal")).toContainText("검사 성적서");
  const canvasPage = page.getByTestId("canvas").locator(".dp-page").first();
  await expect(canvasPage).not.toContainText("검사 성적서");     // 적용 전 불변

  await page.getByTestId("ai-apply").click();
  await expect(canvasPage).toContainText("검사 성적서");
  await expect(page.getByTestId("scan-overlay")).toBeVisible();   // 대조 배경은 적용 후에도 남는다

  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(canvasPage).not.toContainText("검사 성적서");
});
```

구현자 주의: 탭·버튼 이름은 실제 마크업에 맞춘다(5단계 E2E가 쓰는 이름을 먼저 본다). 단언은 지우지 않는다.

- [ ] **Step 4: 실행**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter studio e2e`
Expected: 단위 전부 PASS. E2E 기존 22 + 신규 1 = 23 PASS. UI 결함으로 실패하면 컴포넌트를 고치지 말고 정확한 실패를 보고한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/.env.example packages/ai/README.md apps/studio/e2e/fixtures/form.png apps/studio/e2e/phase6.spec.ts
git -c core.hooksPath=/dev/null commit -m "test(studio): 6단계 E2E — 이미지 이관 제안·적용·되돌리기; 환경 예시·README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 자체 점검 (플랜 작성자)

**스펙 커버리지**: §2 결정 → Global Constraints; §3 패키지 구조 → T1·T3·T4; §4 전처리·한도·mm 기준 → T4(파이프라인·한도)·T5(비율 경고); §5.1 멀티모달 → T1; §5.2 응답 스키마 → T2; §5.3 프롬프트 규칙 → T2; §6 검증 1–8 → T3; §7 라우트·에셋 저장 → T5; §8 오류 표 → T5 `importErrorResponse`와 라우트 테스트; §9 스튜디오 화면 → T6; §10 테스트 → 각 태스크 + T7; §11 완료 기준 1–5 → T7 README 수동 검증 기록과 E2E.

**타입 일관성**: `LlmInput.images`(T1 → T2·T5), `buildImportPrompt` 반환(T2 → T5), `ImportResult`(T3 → T5·T6), `ScanResult`·`ImageInputError`(T4 → T5), 라우트 응답(T5 ↔ T6), `Proposal.kind`·`otherOps`(T6), testid `ai-import-file`·`scan-overlay`(T6 ↔ T7).

**자리표시자 없음**: 모든 단계에 실제 코드가 있다. 구현자가 실제 값을 읽어 맞추라고 남긴 항목(`asset-io.ts`의 저장 함수 이름, `tree.ts`의 자식 배열 키, `proposal.ts`의 `otherOps` 실제 모양, 탭·버튼 이름, 브라우저 base64 인코딩)은 결정을 미룬 것이 아니라 설치된 코드에 맞추라는 지시다.
