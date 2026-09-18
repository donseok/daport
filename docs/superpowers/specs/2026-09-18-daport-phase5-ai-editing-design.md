# daport 5단계 설계 스펙: AI 자연어 편집·페이지 생성

작성일: 2026-09-18
상태: 승인됨
상위 스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` (8.1–8.2장, 6.3장)
이전 단계: `docs/superpowers/specs/2026-09-18-daport-phase4b-oracle-design.md`

## 1. 목적

자연어 지시로 레포트를 고치고, 빈 레포트에서 페이지 전체를 만든다. AI는 **레포트 모델 JSON을 읽고 JSON Patch(또는 요소 목록)를 내놓는 역할**로 한정한다(1단계 스펙 8장). 결과는 서버가 검증한 것만 캔버스에 "제안"으로 겹쳐 보이고, 사용자가 적용을 누르기 전까지 모델은 바뀌지 않는다. 적용은 되돌리기 한 단위다.

이미지 → 컴포넌트(1단계 8.3)는 6단계다. 대화 저장, 스트리밍, 부분 적용은 범위 밖이다(11장).

## 2. 원칙과 확정된 결정

| 항목 | 결정 |
|---|---|
| LLM | Google Gemini. 기본 모델 `gemini-3.8-flash`(환경변수 `GEMINI_MODEL`로 교체). 키는 서버 환경변수 `GEMINI_API_KEY`만. 1단계 8.4의 Claude/Vercel Gateway 기본값을 대체한다 |
| 범위 | 자연어 편집(8.1) + 페이지 생성(8.2) |
| 출력 계약 | 편집은 RFC 6902 JSON Patch, 생성은 `elements[]`. 구조화 출력(Gemini `responseSchema`)으로 받고 서버가 검증한다 |
| 검증 | 허용 경로 필터 → 복제 모델에 패치 적용 → core `parseReport` 통과분만 응답. 금지 경로 op는 제거하고 경고로 남긴다(전체 거부 아님) |
| 불변성 | 제안은 스토어 밖 상태(`proposal`)로만 존재. 적용 = 기존 `apply`로 한 번에 반영(되돌리기 1단위). 다른 편집이 생기면 제안은 폐기 |
| 패키지 | `packages/ai`(프롬프트·검증·`LlmClient`·Gemini 어댑터·가짜 클라이언트, core만 의존). studio는 라우트·AI 탭·오버레이 |
| 비노출 | 프롬프트 원문·모델 원응답·API 키는 클라이언트로 가지 않는다. 프롬프트에 `sample.data`의 값은 넣지 않고 필드 이름·타입만 |
| 테스트 | 가짜 클라이언트로 전부 커버. 실제 Gemini 호출은 `GEMINI_IT=1`일 때만. 기본 `pnpm test`는 키 없이 통과 |

## 3. 패키지 구조 변화

```
packages/
  ai          (신규) LlmClient·LlmError, createGeminiClient(@google/genai), FakeLlmClient,
              buildEditPrompt·buildGeneratePrompt(prompts/*.ko.md), validateEditPatch·validateGenerated,
              EDIT_RESPONSE_SCHEMA·GENERATE_RESPONSE_SCHEMA, estimateTokens
apps/studio   + lib/ai.ts(클라이언트 싱글턴·컨텍스트 조립), api/reports/[id]/ai/{edit,generate}/route.ts,
              + 스토어 proposal 상태·액션, 하단 AI 탭, 캔버스 제안 오버레이·바
```

의존 방향: `ai → core, fast-json-patch, @google/genai`. renderer·datasource·studio를 모른다. `studio → ai`. 새 외부 의존: `@google/genai`(ai). `fast-json-patch`는 studio가 이미 쓰는 것과 같은 버전.

## 4. 계약과 검증 규칙

### 4.1 편집 요청·응답

```
POST /api/reports/:id/ai/edit
body: { report: Report, instruction: string (≤ 2,000자), selection: string[], history: { role: "user" | "assistant"; text: string }[] (최근 6턴) }
→ 200 { patch: Operation[], explanation: string, warnings: string[] }
```

- `patch`는 RFC 6902(`fast-json-patch`의 `Operation`). 모델이 낸 것을 서버가 검증한 뒤에만 돌려준다.
- 허용 경로: `/elements/**`, `/page/**`, `/params/**`, `/datasets/**`, `/name`. 금지: `/id`, `/version`, `/components/**`(라이브러리 내용은 손대지 않음 — `ref` 요소 추가는 허용), `/sample/**`, `/output/**`, `/repeat/**`. 위반 op는 제거하고 `warnings`에 사유를 넣는다.
- 검증 순서: 허용 경로 필터 → 복제 모델에 `applyPatch` → `parseReport`(스키마·id 유일·ref 참조) → 실패 시 400 `AI_INVALID_PATCH`(zod 메시지). 통과한 패치만 응답.
- 새 요소 id는 모델이 제안하되 충돌하면 서버가 `<type>-<n>`으로 바꾼다(`explanation`에 명시).

### 4.2 페이지 생성 요청·응답

```
POST /api/reports/:id/ai/generate
body: { report: Report (요소 0개), brief: string (≤ 4,000자) }
→ 200 { elements: Element[], components: Record<string, ComponentBody>, explanation: string, warnings: string[] }
```

- 서버는 `elements`를 `report.elements`에 넣은 모델로 `parseReport`를 돌린다. `ref` 요소는 라이브러리의 **최신 버전**만 허용(다른 버전은 최신으로 바꾸고 경고)하고 `components[<id>@<v>]` 내용은 라이브러리에서 채워 응답에 포함한다. 요소가 있는 레포트에는 400 `AI_NOT_EMPTY`.
- 페이지 밖으로 나가는 요소는 페이지 안으로 잘라 넣고 경고.

### 4.3 프롬프트 컨텍스트 (두 요청 공통)

- 시스템: 역할("daport 레포트 모델 편집기, JSON Patch만 출력"), 축약 스키마(core `reportJsonSchema()`에서 요소 타입별 필수 필드·열거값만 자동 추출), 단위(mm)·좌표계·페이지 크기, 표현식 문법(`{{ }}` + jexl, `ds.FIELD`, `params.x`) 예시 3개, 허용·금지 경로.
- 사용자 컨텍스트: 현재 모델(요소 트리는 `id type x,y w×h "text…" bind=…` 한 줄로 압축, 텍스트 40자 절단), 데이터 필드 목록(`inferFields(sample.data)` → `ds.PATH: type`), 파라미터 목록, 컴포넌트 라이브러리 목록(`id name w×h props(name:type)`), 선택 요소 id, 최근 대화 6턴, 지시.
- 컨텍스트 추정 토큰(`ceil(chars/3)`)이 60,000을 넘으면 요소 텍스트 → 대화 이력 → 반복 영역 자식 순으로 잘라내고 `warnings`에 기록.

### 4.4 원칙

- AI 호출은 서버 라우트에서만. 클라이언트로 키·프롬프트 원문·모델 원응답이 가지 않는다.
- 사용자 모델은 "적용" 전까지 바뀌지 않는다. 제안은 `proposal` 상태로만 존재한다.
- 응답에 비밀값·연결 정보가 들어갈 경로가 없다(`sample.data`의 값은 프롬프트에 넣지 않는다).

## 5. `packages/ai`

### 5.1 의존과 공개 API

의존: `@daport/core`, `fast-json-patch`, `@google/genai`.

```ts
export interface LlmClient {
  /** 구조화 출력 한 번. schema는 응답 형식 JSON Schema(Gemini 부분집합). 결과는 파싱된 JSON. 실패는 LlmError */
  complete(input: { system: string; messages: { role: "user" | "model"; text: string }[]; schema: object; maxOutputTokens?: number; signal?: AbortSignal }): Promise<unknown>;
}
export type LlmErrorCode = "LLM_NOT_CONFIGURED" | "LLM_TIMEOUT" | "LLM_RATE_LIMIT" | "LLM_BAD_OUTPUT" | "LLM_ERROR";
export class LlmError extends Error { readonly code: LlmErrorCode; readonly retryAfterMs?: number }
export function createGeminiClient(opts: { apiKey: string; model: string; timeoutMs?: number }): LlmClient;
export class FakeLlmClient implements LlmClient { constructor(script: unknown[] | ((input) => unknown)); readonly calls: … }
export class AiValidationError extends Error { readonly code = "AI_INVALID_PATCH" }

export type ChatTurn = { role: "user" | "assistant"; text: string };
export type LibraryItem = { id: string; name: string; version: number; w: number; h: number; props: { name: string; type: string }[] };
export type EditContext = { report: Report; selection: string[]; fields: Record<string, FieldNode[]>; library: LibraryItem[]; history: ChatTurn[] };
export type PromptBundle = { system: string; messages: { role: "user" | "model"; text: string }[]; schema: object; truncated: string[] };
export function buildEditPrompt(ctx: EditContext, instruction: string): PromptBundle;
export function buildGeneratePrompt(ctx: Omit<EditContext, "selection" | "history">, brief: string): PromptBundle;
export function validateEditPatch(report: Report, raw: unknown): { patch: Operation[]; warnings: string[]; next: Report };
export type LibraryLookup = (id: string) => Promise<{ version: number; body: ComponentBody } | null>;
export function validateGenerated(report: Report, raw: unknown, library: LibraryLookup): Promise<{ elements: Element[]; components: Record<string, ComponentBody>; warnings: string[] }>;
export const EDIT_RESPONSE_SCHEMA: object; export const GENERATE_RESPONSE_SCHEMA: object;
export function estimateTokens(text: string): number;   // ceil(chars / 3)
export const MAX_CONTEXT_TOKENS = 60_000; export const MAX_INSTRUCTION_CHARS = 2_000; export const MAX_BRIEF_CHARS = 4_000;
```

### 5.2 Gemini 어댑터

- `@google/genai`의 `models.generateContent({ model, contents, config: { systemInstruction, responseMimeType: "application/json", responseSchema, maxOutputTokens, temperature: 0.2 } })`. 응답 텍스트를 `JSON.parse`; 파싱 실패·빈 응답 → `LLM_BAD_OUTPUT`. 429 → `LLM_RATE_LIMIT`(`retry-after`가 있으면 `retryAfterMs`), 타임아웃(기본 60초, `AbortSignal.timeout`) → `LLM_TIMEOUT`, 401/403 → `LLM_NOT_CONFIGURED`, 그 밖 → `LLM_ERROR`. 오류 메시지의 API 키 문자열은 `***`.
- `responseSchema`는 Gemini가 지원하는 OpenAPI 부분집합만(`oneOf`·`$ref` 없음). 그래서 `EDIT_RESPONSE_SCHEMA`는 `patch[].value`를 **JSON 문자열**로 받고 서버가 파싱한다(임의 중첩 객체를 스키마로 표현하지 못하는 제약 회피). `GENERATE_RESPONSE_SCHEMA`도 `elements`를 JSON 문자열 배열로 받는다.
- 재시도: `LLM_BAD_OUTPUT`이면 "직전 응답이 형식에 맞지 않았다"는 사용자 턴을 붙여 **1회** 재요청. 그래도 실패면 그대로 던진다.

### 5.3 프롬프트 빌더

- 시스템 프롬프트는 `packages/ai/src/prompts/edit.ko.md`·`generate.ko.md`(문자열 import, 상단에 버전 주석). 한글로 쓰되 필드 이름·경로는 영문.
- 축약 스키마는 `reportJsonSchema()`에서 자동 생성(요소 타입별 `required`·열거값). 스키마가 바뀌면 프롬프트가 따라간다.
- 컨텍스트 압축 형식과 잘라내기 순서는 4.3.

### 5.4 검증기

- `validateEditPatch`: (1) 형태 검사(op ∈ add/remove/replace/move/copy, path 문자열, `value` JSON 문자열 파싱), (2) 허용 경로 필터(위반 op 제거 + 경고), (3) `applyPatch(deepClone(report), patch, true)` — 적용 실패 op는 제거하고 나머지로 재시도(최대 3회, 각각 경고), (4) `parseReport(next)` 실패 → `AiValidationError`, (5) id 충돌 시 새 요소 id 재명명(패치 `value.id`와 이후 op 경로를 함께 치환).
- `validateGenerated`: `elements` 파싱 → `ref`는 라이브러리 최신 버전으로(경고) → `components` 채움 → 페이지 밖 요소 클램프(경고) → `parseReport({ ...report, elements, components })`.

### 5.5 테스트

가짜 클라이언트로 전 경로. Gemini 어댑터는 `vi.mock("@google/genai")`로 요청 옵션·오류 매핑·키 마스킹·재시도. 실제 호출은 `GEMINI_IT=1`일 때만 도는 파일 하나(짧은 편집 지시 → 유효 패치).

## 6. 스튜디오 라우트

### 6.1 `POST /api/reports/:id/ai/edit` · `POST /api/reports/:id/ai/generate`

- 내부 라우트(무인증, 동일 출처), 본문 20MB 헬퍼 재사용. `GEMINI_API_KEY`가 없으면 503 `AI_NOT_CONFIGURED`.
- `lib/ai.ts`: `getLlmClient()`(싱글턴; `GEMINI_MODEL` 기본 `gemini-3.8-flash`, `AI_TIMEOUT_MS` 기본 60000; `AI_FAKE=1`이면 `FakeLlmClient` — E2E용), `buildContext(report, selection)`(필드 목록은 `sample.data`가 있으면 `inferFields`, 없으면 static 행; 라이브러리 목록은 `getComponentStore().list()` + 최신 버전 `props`).
- edit: `parseReport(body.report)` → 길이 검사 → 컨텍스트 → `buildEditPrompt` → `complete` → `validateEditPatch` → `{ patch, explanation, warnings(+truncated) }`. generate: 요소가 있으면 400 → `buildGeneratePrompt` → `validateGenerated` → `{ elements, components, explanation, warnings }`.
- 오류 매핑은 8장. 프롬프트·원응답은 서버 로그(`console.warn`, 원응답 앞 500자)에만.
- 요청 로그 한 줄: 시각·레포트 id·종류·소요 ms·추정 토큰·op 수. 지시문 본문은 로그하지 않는다.

## 7. AI 탭과 제안 오버레이

### 7.1 AI 탭 (하단 패널, JSON 편집기 탭 옆)

- 대화 목록(사용자/AI 턴; AI 턴은 `explanation`과 `warnings`), 입력창(`aria-label="AI 지시"`, Enter 전송, Shift+Enter 줄바꿈), "보내기"(`data-testid="ai-send"`), 전송 중 스피너·취소(`AbortController`).
- 선택 요소가 있으면 "선택: text-1, table-2" 칩을 보이고 `selection`으로 싣는다.
- 요소가 없으면 "페이지 생성" 모드 토글(`data-testid="ai-generate-mode"`): 입력이 `brief`로 `generate`에 간다.
- 503 `AI_NOT_CONFIGURED`면 탭 본문을 "서버에 GEMINI_API_KEY를 설정하세요" 안내로 대체. 429/504/502는 대화에 오류 턴으로.

### 7.2 제안 상태와 오버레이

- 스토어 `proposal: { patch, explanation, next: Report, changedIds: string[], kind: "edit" | "generate" } | null`(히스토리 밖, 저장 안 됨). `setProposal`, `applyProposal`(`apply`로 `next`를 한 번에 반영 → 되돌리기 1단위, 비움), `rejectProposal`. 다른 편집이 생기면 자동 폐기하고 "제안이 무효화됨"을 표시.
- 캔버스: `proposal`이 있으면 `next`로 레이아웃한 그림자 페이지를 현재 페이지 위에 반투명(0.5)·점선 테두리로 겹쳐 그리고 `changedIds`를 강조(추가 초록, 변경 파랑, 삭제 빨강 점선). `data-testid="ai-proposal"`.
- 오버레이 바(`data-testid="ai-proposal-bar"`): "적용"(`data-testid="ai-apply"`), "거절", op 수·경고 수.
- 저장은 현재 모델만 저장한다(제안 미포함).

### 7.3 페이지 생성 결과

적용 시 `elements`와 함께 응답의 `components`를 `report.components`에 합친다(라이브러리 최신 버전; 해시는 저장 시 기존 검사대로).

## 8. 오류 처리

| 상황 | 코드 | 응답 |
|---|---|---|
| `GEMINI_API_KEY` 없음 / 401·403 | `AI_NOT_CONFIGURED` | 503 |
| 모델 요율 제한 | `AI_RATE_LIMIT` | 429 (+ `retry-after` 전달) |
| 모델 타임아웃(60초) | `AI_TIMEOUT` | 504 |
| 응답 형식 불일치(1회 재시도 후) | `AI_BAD_OUTPUT` | 502 |
| 모델·네트워크 오류 | `AI_ERROR` | 502 (사유 문구만) |
| 패치 적용 모델이 스키마 위반 | `AI_INVALID_PATCH` | 400 + zod 메시지 |
| 금지 경로·적용 불가 op | — | 200, 그 op 제거 + `warnings` |
| 생성 요청인데 요소가 있음 | `AI_NOT_EMPTY` | 400 |
| 지시문 길이 초과 | `AI_INPUT_TOO_LONG` | 400 |
| 컨텍스트 잘라냄 | — | 200 + `warnings` |

프롬프트 원문·모델 원응답·API 키는 응답에 넣지 않는다.

## 9. 테스트

- **ai**: 프롬프트 빌더(축약 스키마 내용, 압축 형식, 60k 초과 잘라내기 순서·`truncated`), `validateEditPatch`(허용/금지 경로, `value` 파싱, 적용 실패 op 제거 재시도, id 재명명, `AiValidationError`), `validateGenerated`(ref 최신 강제, components 채움, 클램프 경고, 스키마 실패), Gemini 어댑터(요청 옵션·`responseSchema`·오류 코드·키 마스킹·`LLM_BAD_OUTPUT` 재시도), `FakeLlmClient`. `GEMINI_IT=1` 실제 호출 1개.
- **studio 단위**: `lib/ai.ts` 컨텍스트 조립·`AI_FAKE`, 두 라우트(503/429/504/502/400 매핑, 성공 응답 모양, 원응답 비노출, 길이 검사), 스토어 `proposal` 액션(적용 = 되돌리기 1단위, 다른 편집 시 자동 폐기, 거절), AI 탭(전송·취소·선택 칩·생성 모드·503 안내), 캔버스 오버레이(`ai-proposal` 렌더·강조 분기), 저장이 제안을 포함하지 않음.
- **E2E**(`phase5.spec.ts`, Playwright webServer에 `AI_FAKE=1`; 가짜 스크립트는 지시문 키워드로 분기해 고정 패치/요소 반환): 예제 레포트에서 "제목을 '검사 성적서'로 바꿔" → 제안 오버레이 → 적용 → 캔버스 텍스트 변경 → 되돌리기 1회로 복구; 새 레포트에서 생성 모드 → brief → 요소 N개 제안 → 적용 → 저장 → 새로고침 후 유지; 금지 경로 op가 섞인 가짜 응답 → 경고 표시, 그 op만 빠짐.

## 10. 완료 기준

1. 실제 Gemini로 예제 레포트 3종에 편집 지시 5개(텍스트 변경·요소 이동·표 컬럼 추가·바인딩 변경·요소 삭제)가 유효 패치를 내고 적용 후 PDF가 나온다(구현 중 수동 실행 결과를 `packages/ai/README.md`에 기록).
2. 빈 레포트 + brief("품질보증서: 회사 헤더 컴포넌트, 품목 표, 서명란")로 생성한 페이지가 스키마를 통과하고 라이브러리 컴포넌트를 `ref`로 쓴다.
3. 모델은 적용 전까지 불변이며 적용은 되돌리기 1단위다(테스트).
4. 키·프롬프트·원응답이 클라이언트에 노출되지 않는다.
5. 기존 단위·E2E 전부 통과, 기본 `pnpm test`는 키 없이 통과.

## 11. 범위 밖 (이후 단계)

- 이미지 → 컴포넌트(6단계), 대화 저장·공유, 스트리밍 출력, 여러 제안 후보 비교, 부분 적용(op 단위 선택), 컴포넌트 라이브러리 내용 편집.
- 데이터셋 쿼리 생성(sql 텍스트는 AI가 만들 수 있으나 가드·샘플 실행은 사용자 확인).
- 사용자별 사용량·비용 집계, 모델 자동 전환, 프롬프트 A/B.
