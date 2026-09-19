# @daport/ai

daport 레포트를 자연어로 편집하거나(부분 지시 → JSON Patch), 빈 레포트를 브리프로 처음부터 생성하는(브리프 → 요소 전체) LLM 어댑터 패키지다. 스튜디오는 `apps/studio/src/lib/ai.ts`와 `/api/reports/[id]/ai/{edit,generate}` 라우트에서만 이 패키지를 부른다.

## 의존 방향

`ai → core, fast-json-patch, @google/genai`. `ai`는 renderer·datasource·studio·browser를 import하지 않는다. 실제 모델 키는 서버 환경변수 `GEMINI_API_KEY`에서만 읽으며, 프롬프트 원문·모델 원응답·키는 어떤 HTTP 응답에도 넣지 않는다. 서버 로그(`[ai] ...`)에는 시각·레포트 id·종류·경과 시간·추정 토큰·op(또는 요소) 수만 남긴다 — 모델 원응답 로그는 현재 없다.

## 공개 API

- `types.ts` — `LlmClient`/`LlmInput`(어댑터 인터페이스), `LlmError`/`AiValidationError`, `ChatTurn`, `LibraryItem`, `EditContext`, 한도 상수(`MAX_CONTEXT_TOKENS` 60,000, `MAX_INSTRUCTION_CHARS` 2,000, `MAX_BRIEF_CHARS` 4,000, `MAX_OUTPUT_TOKENS`).
- `testing.ts` — `FakeLlmClient`. 스크립트 함수(`(input: LlmInput) => unknown`)를 받아 실제 호출 없이 정해진 응답을 낸다. 스튜디오의 `AI_FAKE=1`(E2E용)가 이걸 쓴다.
- `schema-summary.ts` — `summarizeSchema(reportJsonSchema())`. 레포트 zod 스키마를 프롬프트에 넣을 수 있는 요약 문자열로 만든다.
- `compact.ts` — `compactReport`, `compactFields`, `compactLibrary`, `estimateTokens`(`ceil(chars/3)`). 컨텍스트를 60,000토큰 추정치 안으로 줄인다.
- `prompts/edit.ko.ts`, `prompts/generate.ko.ts`, `prompt.ts` — `buildEditPrompt`/`buildGeneratePrompt`가 `EditContext` + 지시문(또는 브리프)에서 `{ system, messages, schema }`(`PromptBundle`)를 만든다.
- `response-schema.ts` — `EDIT_RESPONSE_SCHEMA`(`{ patch, explanation }`), `GENERATE_RESPONSE_SCHEMA`(`{ elements, components?, explanation }`). Gemini의 구조화 출력(`responseSchema`)에 그대로 넘긴다.
- `validate.ts` — `validateEditPatch(report, raw)` → `{ patch, warnings, next }`, `validateGenerated(report, raw)`. 허용 경로 밖 op은 버리고 경고를 남기며(전체 거부 아님), 적용 실패 op도 같은 방식으로 건너뛴다. id 충돌은 재명명하고, 페이지 밖으로 나간 요소는 안으로 클램프하고 경고한다.
- `gemini.ts` — `createGeminiClient({ apiKey, model, timeoutMs? })`. `@google/genai`의 `generateContent`를 구조화 출력으로 호출하고, 형식이 틀린 응답은 한 번만 재시도한다(`RETRY_NOTE`). 오류는 `LlmError`로 매핑한다.

## 프롬프트 버전 관리

`prompts/edit.ko.ts`, `prompts/generate.ko.ts` 각 파일 첫 줄의 `// prompt-version: N` 주석이 버전이다. 프롬프트 문구(지시 형식, 출력 규칙 등)를 바꿀 때마다 이 번호를 올린다. 스키마(`response-schema.ts`)나 검증기(`validate.ts`) 동작이 같이 바뀌면 그쪽 코드에도 이유를 남긴다.

## 허용·금지 경로 (JSON Patch)

- 허용: `/elements/**`, `/page/**`, `/params/**`, `/datasets/**`, `/name`.
- 금지: `/id`, `/version`, `/components/**`, `/sample/**`, `/output/**`, `/repeat/**`.
- 금지 경로를 가리키는 op은 패치 전체를 버리지 않고 그 op만 제거하며 경고를 남긴다(`validateEditPatch`의 `warnings`).

## 실제 Gemini로 통합 테스트 (`GEMINI_IT=1`)

기본 `pnpm test`(`vitest.config.ts`)는 `GEMINI_API_KEY` 없이 통과한다. 실제 API를 부르는 테스트는 `src/__it__/*.it.test.ts`에 있고 `vitest.it.config.ts`로만 수집되며, `GEMINI_IT=1`이고 `GEMINI_API_KEY`가 있을 때만 켜진다(`describe.skipIf`).

```bash
GEMINI_IT=1 GEMINI_API_KEY=... pnpm --filter @daport/ai test:it
```

## 알려진 제약

- `@google/genai` 2.23.0의 `ApiError`는 `message`와 `status`만 노출한다. 그래서 `gemini.ts`의 `toLlmError`는 429(`LLM_RATE_LIMIT`)에서 `retryAfterMs`를 절대 채우지 못하고, 스튜디오 AI 탭은 이 경우 (`Retry-After` 헤더 없이) 일반적인 "다시 시도하세요" 문구만 보여준다.
- `AI_FAKE`는 프로덕션(`NODE_ENV === "production"`)에서는 무시된다. E2E는 `pnpm dev`로 뜨는 서버를 쓰므로 `NODE_ENV`가 production이 아니어서 문제없이 켜진다.

## 수동 검증 기록

스펙 10장 완료 기준 1·2 — 예제 3종(품질보증서·라벨·빈 레포트) × 편집 지시 5개, 그리고 빈 레포트 생성 — 을 실제 Gemini API로 돌려 확인해야 하는 항목이다.

**미실행.** 이 작업을 수행한 환경에는 `GEMINI_API_KEY`가 설정되어 있지 않아 실제 모델 호출을 하지 못했다(허구의 결과를 적지 않는다). 키를 넣고 아래를 실행해 확인한다.

```bash
# 1. 패키지 단위 통합 테스트 (편집 지시 1건짜리 스모크)
GEMINI_IT=1 GEMINI_API_KEY=... pnpm --filter @daport/ai test:it

# 2. 스튜디오를 실제 키로 띄운 뒤(.env.local에 GEMINI_API_KEY 설정) 아래를 브라우저에서 수동 반복
#    - 예제 3종(품질보증서·라벨·빈 레포트)을 열고, 각각 편집 지시 5개를 AI 탭에 넣어 제안 → 적용 → PDF까지 확인
#    - 빈 레포트에서 생성 모드로 브리프를 넣어 제안 → 적용 → PDF까지 확인
#    - 지시별로 경고 개수와 적용 후 PDF 성공 여부를 아래 표에 채운다
pnpm --filter studio dev
```

| 예제 | 편집 지시 | 경고 수 | 적용 후 PDF 성공 |
|------|-----------|---------|-------------------|
| (미실행) | | | |

빈 레포트 생성(완료 기준 2)도 같은 방식으로 브리프·경고 수·PDF 성공 여부를 표로 남긴다. 위 명령을 실행한 뒤 이 표를 채워 넣는다.
