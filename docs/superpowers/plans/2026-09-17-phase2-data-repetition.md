# daport 2단계 구현 플랜: 데이터 반복과 데이터 계층 (초안)

> **상태: 작성 중인 초안.** 공용 규약과 태스크 구성만 들어 있다. 스펙 반박 검토 결과를 반영한 뒤 태스크별 본문(TDD 단계와 코드)을 채운다. 이 상태로는 실행하지 않는다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표 넘김, 레코드마다 한 부씩, 자유 배치 반복 영역, 그룹 머리·소계를 공통 흐름 엔진으로 구현하고, 요청 데이터 우선·http·SQL 경계를 갖춘 데이터 계층과 스튜디오 편집 기능을 만든다.

**Architecture:** core에 스키마·요소 트리 탐색·소스 표현식·필드 추론을 더한다. renderer는 표·반복 영역을 조각(Block)으로 바꾸고 공용 `paginate`와 페이지 조립으로 여러 페이지를 만든다(순수 함수 유지). 네트워크는 새 패키지 `@daport/datasource`만 쓰며 studio 서버 라우트가 조립한다. 캔버스는 레포트 안의 `sample` 데이터로 그린다.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, zod 4, jexl, React 19, Next.js 16, zustand 5, Playwright.

스펙: `docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md`

---

## 공용 규약 (모든 태스크가 따르는 이름과 타입)

이 절의 이름·시그니처·파일 경로는 태스크 사이의 계약이다. 태스크 본문은 이 규약과 다른 이름을 쓰면 안 된다. 스펙: `docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md`.

### core (`packages/core`)

`src/schema/elements.ts`
```ts
export const CellAlignSchema = z.enum(["left", "center", "right"]);
export const TableCellSchema = z.object({
  value: z.string().default(""),
  span: z.union([z.number().int().positive(), z.literal("all")]).default(1),
  align: CellAlignSchema.optional(),              // 없으면 열 정렬, 그 다음 "left"
  style: StyleOverrideSchema.optional(),          // 열·머리 스타일 위에 덮어쓸 값만
});
export type TableCell = z.infer<typeof TableCellSchema>;
// TableColumnSchema: 기존 필드 + align: CellAlignSchema.default("left")
export const TableGroupSchema = z.object({
  by: z.string().min(1),                          // 표현식 (행 컨텍스트에서 평가)
  header: z.array(TableCellSchema).default([]),
  footer: z.array(TableCellSchema).default([]),
  keepHeaderWithRows: z.boolean().default(true),
});
// TableElementSchema 추가 필드:
//   border: z.enum(["all","rows","none"]).default("all")
//   borderStyle: z.object({ stroke: color().default("#000000"), strokeWidth: z.number().nonnegative().default(0.2) }).prefault({})
//   headerStyle: StyleOverrideSchema.default({})
//   groups: z.array(TableGroupSchema).default([])
//   pageFooter: z.array(TableCellSchema).default([])
//   footer: z.array(TableCellSchema).default([])
export const RepeaterBandSchema = z.object({ h: z.number().positive(), children: z.array(ElementSchema) });
export const RepeaterGroupSchema = z.object({ by: z.string().min(1), header: RepeaterBandSchema.optional(), footer: RepeaterBandSchema.optional() });
export const RepeaterElementSchema = Base.extend({
  type: z.literal("repeater"),
  source: z.string().min(1),
  layout: z.enum(["list", "grid"]).default("list"),
  gap: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).default([0, 0]),
  item: z.object({ w: z.number().positive(), h: z.number().positive(), children: z.array(ElementSchema) }),
  groups: z.array(RepeaterGroupSchema).default([]),
  overflow: z.enum(["continue", "clip"]).default("continue"),
});
export type RepeaterElement = z.infer<typeof RepeaterElementSchema>;
export type TableElement = z.infer<typeof TableElementSchema>;
```

`src/schema/style.ts`: `export const StyleOverrideSchema` = StyleSchema의 모든 필드를 기본값 없는 optional로 만든 스키마(`Partial<Style>`로 추론). 색 필드는 같은 `isSafeCssColor` 검증.

`src/schema/tree.ts` (신규) — 요소 트리 탐색의 단일 구현. 스키마 검증, renderer, studio 스토어가 모두 이것만 쓴다.
```ts
/** 요소가 직접 가진 자식 배열들. group → [children], repeater → [item.children, ...groups의 header/footer children], 그 밖 → [] */
export function childArrays(el: Element): Element[][];
/** 깊이 우선·문서 순서. fn이 true를 돌려주면 중단하고 true 반환. parent는 el이 들어 있는 배열 */
export function walkElements(els: Element[], fn: (el: Element, parent: Element[], index: number, ancestors: Element[]) => boolean | void): boolean;
```

`src/schema/report.ts`
```ts
export const RepeatSchema = z.object({ source: z.string().min(1), as: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("record") });
export const SampleSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  data: z.record(z.string(), z.unknown()).default({}),
  capturedAt: z.string(),
});
// HttpDataset: { name, type:"http", method: GET|POST default GET, url, headers: record<string,string> default {}, body?: string, rowsPath?: string }
// ReportSchema 추가: repeat: RepeatSchema.optional(), sample: SampleSchema.optional()
// superRefine: walkElements로 id 유일성(템플릿 자식 포함), repeater 템플릿 안 repeater 금지, 템플릿 안 table은 overflow "clip"만
export const RESERVED_CONTEXT_NAMES: readonly string[];  // params secrets record row item index group rows pageRows page total sheet sheets copy copies — 데이터셋 이름·repeat.as로 쓸 수 없다
```

`src/expression/engine.ts`: 등록 함수 `avg`, `min`, `max` 추가(시그니처는 `sum`과 같고 숫자 아닌 값 건너뜀, 빈 배열 → `null`).

`src/expression/source.ts` (신규)
```ts
/** 소스 표현식을 평가해 배열로 돌려준다. null·undefined → []. 배열이 아니면 ExpressionError(expr, "source is not an array") */
export function evaluateSource(expr: string, ctx: DataContext): unknown[];
```

`src/data/infer.ts` (신규)
```ts
export type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
export type FieldNode = { name: string; path: string; type: FieldType; children?: FieldNode[] };
export function inferFields(rows: unknown, opts?: { sampleSize?: number; maxDepth?: number }): FieldNode[];
```

`src/index.ts`는 위 신규 모듈을 모두 재export 한다.

### renderer (`packages/renderer`)

`src/layout/types.ts` 변경
```ts
type PlacedBase = { elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string;
  instance?: string;          // 반복 인스턴스 경로. 예 "cards#3", "t1#12", 중첩 "cards#3/t2#0"
  clipped?: boolean;          // clip으로 잘린 흐름 요소의 flowBox에 표시
  role?: "flowBox" | "cell" | "border" | "template";
  overflow?: boolean };
export type Page = { index: number; width: number; height: number; items: PlacedItem[];
  copyIndex: number;          // 0부터. repeat 없으면 0
  pageInCopy: number };       // 0부터
```

`src/layout/errors.ts` (신규): `export class LayoutLimitError extends Error { readonly code = "LAYOUT_LIMIT" }`, `export const MAX_PAGES = 2000`.

`src/text/cache.ts` (신규)
```ts
export type MeasureCache = { wrap(text: string, fontSize: number, bold: boolean, width: number): string[] };
export function createMeasureCache(): MeasureCache;   // 키 `${fontSize}|${bold}|${width}|${text}`, layout() 호출마다 새로 만든다
```

`src/flow/types.ts` (신규)
```ts
export type Region = { x: number; y: number; w: number; h: number };
export type BlockKind = "header" | "row" | "groupHeader" | "groupFooter" | "pageFooter" | "footer";
export type PageFlowContext = { page: number; total: number; sheet: number; sheets: number; copy: number; copies: number; pageRows: unknown[] };
export type Block = { kind: BlockKind; height: number; keepWithNext: boolean; rows: unknown[];
  paint(origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[] };
export type FlowInput = { header?: Block; pageFooter?: Block; body: Block[]; footer?: Block };
export type FlowPlacement = { block: Block; y: number };
export type FlowPage = { placements: FlowPlacement[]; pageRows: unknown[]; overflow: boolean };
```

`src/flow/paginate.ts` (신규)
```ts
export function paginate(input: FlowInput, opts: { first: Region; next: Region; repeatHeader: boolean; clip: boolean }): FlowPage[];
```

`src/flow/table.ts` (신규)
```ts
/** el은 페이지 절대좌표. 소스 오류는 ExpressionError로 던진다(호출자가 #ERR로 바꿈). 셀 표현식 오류는 그 셀만 #ERR 항목 */
export function tableFlow(el: TableElement, ctx: DataContext, opts: { measure: MeasureCache; onExpressionError: "blank" | "fail"; instancePrefix?: string }): FlowInput & { rows: unknown[] };
```

`src/flow/repeater.ts` (신규)
```ts
export function repeaterFlow(el: RepeaterElement, ctx: DataContext, opts: { measure: MeasureCache; onExpressionError: "blank" | "fail"; instancePrefix?: string }): FlowInput & { rows: unknown[] };
```

`src/layout/place.ts` (신규, 기존 layout.ts의 place/textItem/isVisible를 옮김)
```ts
export function placeStatic(el: FlatElement, ctx: DataContext, opts: { measure: MeasureCache; onExpressionError: "blank" | "fail"; instance?: string }): PlacedItem[];
```

`src/layout/layout.ts`: `export function layout(report: Report, data: DataContext, opts?: { maxPages?: number }): Page[]` — 시그니처 유지, 내부는 흐름 조립(스펙 5.3). 흐름 요소가 없고 repeat도 없는 레포트의 결과는 1단계와 같은 항목 배열(골든 스냅샷은 `copyIndex`·`pageInCopy` 두 필드 추가 외 변화 없음, 표는 더 이상 placeholder가 아님).

`src/paint/Paint.tsx`: React key `${elementId}|${instance ?? ""}|${n}`(n은 페이지 안 순번), DOM에 `data-instance` 속성.

### datasource (`packages/datasource`, 신규 패키지 `@daport/datasource`)

```ts
// src/types.ts
export type DatasetErrorCode = "TIMEOUT" | "HOST_NOT_ALLOWED" | "HTTP_STATUS" | "BAD_JSON" | "ROWS_PATH" | "TOO_LARGE" | "TOO_MANY_ROWS" | "SQL_NOT_CONFIGURED" | "SQL_ERROR" | "BAD_DATA";
export type DatasetError = { dataset: string; code: DatasetErrorCode; message: string };
export class DatasetFailure extends Error { constructor(readonly code: DatasetErrorCode, message: string) }
export type Limits = { timeoutMs: number; maxBytes: number; maxRows: number };
export const DEFAULT_LIMITS: Limits;   // { timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024, maxRows: 10_000 }
export type HttpRequest = { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string };
export interface HttpConnector { request(req: HttpRequest, limits: Limits): Promise<unknown> }   // 파싱된 JSON. 실패는 DatasetFailure
export interface SqlConnector { query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal }): Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }> }
export type Connectors = { http?: HttpConnector; sql?: Record<string, SqlConnector> };
export type SecretResolver = (name: string) => string | undefined;
// src/execute.ts
export function executeDatasets(report: Report, opts: { params: Record<string, unknown>; data?: Record<string, unknown>; connectors: Connectors; secrets: SecretResolver; limits?: Partial<Limits> }): Promise<{ context: DataContext; errors: DatasetError[] }>;
// src/http.ts
export function parseAllowList(value: string | undefined): string[];   // 소문자 host 또는 host:port
export function createFetchHttpConnector(opts: { allow: string[]; fetch?: typeof fetch }): HttpConnector;
export function buildHttpRequest(ds: HttpDataset, params: Record<string, unknown>, secrets: SecretResolver): HttpRequest;
export function pickRows(json: unknown, rowsPath: string | undefined): Record<string, unknown>[];
export function maskSecrets(message: string, used: string[]): string;
// src/sql.ts
export function extractBinds(sql: string, params: Record<string, unknown>): Record<string, unknown>;
// src/secrets.ts
export function envSecrets(env?: Record<string, string | undefined>): SecretResolver;   // DAPORT_SECRET_<NAME>
```

### studio (`apps/studio`)

- `src/lib/data.ts`: `sampleContext(report: Report): DataContext` — `sample.params`(없으면 1단계 `sampleParams`)와 `sample.data`, 없으면 static 데이터셋 행. `resolveDataSync`는 삭제하고 호출처를 교체한다.
- `src/lib/body.ts` (신규): `readJsonBody(req: Request, maxBytes: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }>` — 413·400 응답을 만든다.
- `src/lib/datasets.ts` (신규, 서버 전용): `runDatasets(report: Report, input: { params?: Record<string, unknown>; data?: Record<string, unknown> }): Promise<{ context: DataContext; errors: DatasetError[] }>` — env에서 허용 목록·비밀값을 읽어 `executeDatasets` 호출.
- `src/app/api/reports/[id]/sample/route.ts` (신규): 스펙 7.5.
- `src/editor/store.ts`: 내부 `walk`를 core `walkElements`로 교체. 추가 상태·액션:
  ```ts
  view: { copyIndex: number; pageInCopy: number }; setView(v: Partial<{ copyIndex: number; pageInCopy: number }>): void;
  liveData: boolean; setLiveData(v: boolean): void;
  setSample(sample: Report["sample"]): void;                 // 되돌리기 가능한 편집
  setDatasets(datasets: Report["datasets"]): void;
  setParams(params: Report["params"]): void;
  setRepeat(repeat: Report["repeat"] | undefined): void;
  addElement(el: Element, opts?: { into?: { repeaterId: string; band: "item" | "groupHeader" | "groupFooter"; groupIndex?: number } }): void;
  ```
- `src/editor/data/` (신규 디렉터리): `DataPanel.tsx`, `DatasetEditor.tsx`, `FieldTree.tsx`, `bindings.ts`:
  ```ts
  export type DragField = { dataset: string; path: string; type: FieldType; isArray: boolean };
  export type DropTarget = { kind: "canvas"; x: number; y: number } | { kind: "table"; tableId: string } | { kind: "repeaterItem"; repeaterId: string; x: number; y: number };
  export type DropResult = { action: "addElement"; element: Element; into?: { repeaterId: string; band: "item" } } | { action: "addColumn"; tableId: string; column: TableColumn } | { action: "none"; warning?: string };
  export function resolveDrop(field: DragField, target: DropTarget, report: Report, allocateId: (base: string) => string): DropResult;
  export const DRAG_MIME = "application/x-daport-field";
  ```
- `src/editor/panels/TablePanel.tsx`, `src/editor/panels/RepeaterPanel.tsx` (신규). `PropertyPanel.tsx`는 선택 요소가 table·repeater면 이 패널을 렌더한다.
- `src/editor/PageSelector.tsx` (신규): `layout` 결과의 페이지·부를 고르는 ◀ ▶ 컨트롤. 툴바에 배치.
- E2E: `e2e/phase2.spec.ts` (신규).

---

## 태스크 목록과 실행 웨이브

각 웨이브 안의 레인은 서로 다른 파일만 건드려 병렬로 실행할 수 있다. 레인 안의 태스크는 순서대로 실행한다. 웨이브가 끝나면 레인을 통합 브랜치에 병합하고 전체 테스트를 돌린다.

| 웨이브 | 레인 | 태스크 | 의존 |
|---|---|---|---|
| 1 | core-schema | T1 표 스키마 확장 · T2 반복 영역 스키마와 요소 트리 탐색 · T3 레포트 repeat·sample·데이터셋 스키마 | - |
| 1 | core-expr | T4 avg/min/max와 소스 표현식 · T5 필드 추론 | - |
| 1 | flow-core | T6 흐름 타입·측정 캐시·한도 오류 · T7 paginate와 불변식 테스트 | - |
| 1 | datasource | T8 datasource 패키지와 executeDatasets(static·요청 data) · T9 SQL 커넥터 경계 | - |
| 2 | table | T10 표 흐름 조각 | T1 T4 T6 T7 |
| 2 | repeater | T11 반복 영역 흐름 조각 | T2 T4 T6 T7 |
| 2 | http | T12 http 커넥터·비밀값·허용 호스트 | T3 T8 |
| 2 | studio-store | T13 스토어 트리 탐색 교체와 데이터·반복·보기 상태 액션, sampleContext | T2 T3 |
| 3 | assemble | T14 페이지 조립(흐름·clip·repeat·번호·상한·instance) | T10 T11 |
| 3 | api | T15 요청 본문 한도·runDatasets·preview/pdf data·sample 라우트 | T8 T12 T6 |
| 3 | data-panel | T16 데이터 패널·데이터셋 편집기·필드 트리·샘플 가져오기 | T5 T13 |
| 4 | fixtures | T17 예제 4종 골든·성능 테스트 · T18 여러 페이지 PDF 테스트 | T14 |
| 4 | canvas | T19 캔버스 페이지·부 선택, 인스턴스 매핑, 반복 영역 템플릿 편집 | T13 T14 |
| 4 | binding | T20 드롭 바인딩 규칙(순수 함수) | T13 T5 |
| 4 | panels | T21 표 속성 패널 · T22 반복 영역 패널·팔레트·레포트 반복 스위치 | T13 |
| 5 | integration | T23 필드 드래그 연결·툴바 페이지 선택기·실데이터 토글·미리보기 data 전송 · T24 2단계 E2E | T15 T16 T19 T20 T21 T22 |
