# daport 2단계 구현 플랜: 데이터 반복과 데이터 계층

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표 넘김, 레코드마다 한 부씩, 자유 배치 반복 영역, 그룹 머리·소계를 공통 흐름 엔진으로 구현하고, 요청 데이터 우선·http·SQL 경계를 갖춘 데이터 계층과 스튜디오 편집 기능을 만든다.

**Architecture:** core에 스키마·요소 트리 탐색·소스 표현식·필드 추론을 더한다. renderer는 표·반복 영역을 조각(Block)으로 바꾸고 공용 `paginate`와 페이지 조립으로 여러 페이지를 만든다(순수 함수 유지). 네트워크는 새 패키지 `@daport/datasource`만 쓰며 studio 서버 라우트가 조립한다. 캔버스는 레포트 안의 `sample` 데이터로 그린다.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, zod 4, jexl 2, React 19, Next.js 16, zustand 5, fast-json-patch, Playwright, pdf-lib·pdf-to-img·pixelmatch(테스트 전용).

**Spec:** `docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md` (상위: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md`)

## Global Constraints

- core와 renderer는 입출력 없는 순수 코드다. 네트워크는 `@daport/datasource`만 쓴다. 의존 방향: `datasource → core`, `renderer → core`, `pdf → renderer`, `studio → 전부`. renderer·pdf는 datasource를 모른다.
- 모든 기능은 범용 기능이다. 예제(검사증명서·송장·출하지시서·사원 명찰)는 fixtures JSON으로만 존재하며 예제 전용 코드는 없다.
- `layout(report, data)` 시그니처와 순수성을 유지한다. 흐름 요소·repeat가 없는 레포트의 결과는 1단계와 같다(`Page`에 `copyIndex`·`pageInCopy` 추가, 표는 실제 셀로 그려짐).
- 셀·항목 표현식 오류는 그 셀·항목만 `#ERR`(1단계 `onExpressionError` 규칙). 소스 표현식 오류·배열 아님은 흐름 요소 전체를 `#ERR` 한 칸.
- 페이지 상한 `MAX_PAGES = 2000` 초과 시 `LayoutLimitError`(code `LAYOUT_LIMIT`). 요청 본문 상한 20MB(413). http 한도: 타임아웃 30초, 응답 20MB, 1만 행.
- 비밀값은 `DAPORT_SECRET_<NAME>` 환경변수에서만 읽고 http 템플릿 평가 컨텍스트에만 존재한다. 오류 메시지의 비밀값은 `***`로 치환.
- 허용 호스트는 `DAPORT_HTTP_ALLOW`(쉼표 구분, 소문자 host 또는 host:port). 비어 있으면 모든 http 데이터셋이 `HOST_NOT_ALLOWED`. 리다이렉트는 따라가지 않는다.
- 예약된 컨텍스트 이름(데이터셋 이름·`repeat.as`로 쓸 수 없음): `params secrets record row item index group rows pageRows page total sheet sheets copy copies`.
- 커밋 메시지는 1단계 관례(`feat(core): …`, `test(renderer): …`)를 따른다. 태스크마다 `pnpm typecheck`와 해당 패키지 `pnpm --filter <pkg> test`가 통과해야 커밋한다.
- 코드 주석·UI 문구는 한국어, 식별자는 영어.

## 스펙 검토에서 조정한 사항 (플랜이 스펙과 다른 곳)

1단계 코드를 기준으로 스펙을 반박 검토한 결과다. 스펙 본문은 그대로 두고 플랜에서 이렇게 조정한다.

| # | 스펙 | 조정 | 이유 |
|---|---|---|---|
| R1 | 5.5 성능 목표(행 1만 건 1초) | core `evaluate`에 컴파일 캐시(표현식 문자열 → guardAst를 거친 jexl Expression) 추가 | 1단계 `evaluate`는 호출마다 파싱한다. 1만 행 × 4열이면 4만 회 파싱이라 목표를 못 맞춘다. jexl `Expression`은 AST를 한 번만 만들고 재사용한다 |
| R2 | 5.2 `paginate` 출력 | `FlowPage`에 `truncated: boolean` 추가 | `clip`으로 버린 조각이 있는지 호출자가 알아야 `clipped` 표시를 남길 수 있다 |
| R3 | 3장 "pdf 변경 없음" | `renderHtmlScreenshot`에 `{ pageIndex }` 옵션 추가(테스트 도우미) | 여러 페이지 PDF의 페이지별 픽셀 비교(9장)에 페이지별 HTML 스크린샷이 필요하다 |
| R4 | 4.3 열 `align` | `TableColumnSchema.align`은 optional. 셀 정렬 = `cell.align ?? column.align ?? column.style.align` | 1단계 열에는 이미 `style.align`이 있다. 기본값을 강제하면 기존 JSON의 `style.align: "right"`가 무시된다 |
| R5 | 4.1 repeat 소스 오류 | blank 모드: 부 1개, `record` 미정의, 여백 좌상단에 `#ERR` 항목(elementId `__repeat`). fail 모드: 던진다 | 스펙은 흐름 요소 소스 오류만 정했다. 캔버스(blank)가 빈 화면이 되지 않게 같은 규칙을 적용 |
| R6 | 5.1 조각 높이 고정 | 페이지 의존 변수(`page total sheet sheets copy copies pageRows`)를 참조하지 않는 셀·항목은 조각 생성 시 값을 캐시하고 `paint`에서 다시 평가하지 않는다 | 1만 행을 두 번 평가하지 않기 위해. 참조 여부는 값 문자열의 정규식 검사로 정한다 |
| R7 | 4.4 grid 줄 조각 | 그룹 경계에서 줄을 끊는다(그룹 머리 다음 줄은 새로 시작) | 한 줄에 두 그룹의 항목이 섞이면 그룹 머리의 의미가 없다 |
| R8 | 7.3 팔레트 | repeater(또는 그 템플릿 자식)가 선택된 상태에서 팔레트를 누르면 요소를 그 repeater의 `item.children`에 넣는다 | 스펙은 템플릿 자식을 JSON 편집기에서만 만들게 두었는데, 필드 드롭 외에 캔버스로 넣을 길이 없다 |
| R9 | 6.1 `data` 값 | 배열 원소가 객체가 아니면 `BAD_DATA` | `rowsProxy`는 객체 행을 전제한다. 조용히 통과시키면 `row.X`가 `#ERR`로 보여 원인을 찾기 어렵다 |
| R10 | 7.4 캔버스 | 요소의 첫 배치 항목(문서 순서, `role`이 `cell`·`border`가 아닌 것)을 선택 상자로 쓴다. 표·반복 영역은 `flowBox`가 첫 항목이다 | 반복 인스턴스는 같은 `elementId`를 여러 항목이 갖는다. 템플릿(첫 인스턴스)이 편집 대상이다 |

---
## 공용 규약 (모든 태스크가 따르는 이름과 타입)

이 절의 이름·시그니처·파일 경로는 태스크 사이의 계약이다. 태스크 본문은 이 규약과 다른 이름을 쓰면 안 된다. 각 태스크의 **Interfaces**는 이 절의 발췌다.

### core (`packages/core`)

`src/schema/style.ts`
```ts
export const StyleOverrideSchema;   // StyleSchema의 모든 필드를 기본값 없는 optional로. 색 필드는 같은 isSafeCssColor 검증
export type StyleOverride = z.infer<typeof StyleOverrideSchema>;   // Partial<Style>
export function mergeStyle(base: Style, ...overrides: (StyleOverride | undefined)[]): Style;   // undefined 값은 덮어쓰지 않는다
```

`src/schema/elements.ts`
```ts
export const CellAlignSchema = z.enum(["left", "center", "right"]);
export const TableCellSchema = z.object({
  value: z.string().default(""),
  span: z.union([z.number().int().positive(), z.literal("all")]).default(1),
  align: CellAlignSchema.optional(),
  style: StyleOverrideSchema.optional(),
});
export type TableCell = z.infer<typeof TableCellSchema>;
// TableColumnSchema: 기존 필드(header value w style) + align: CellAlignSchema.optional()
export const TableGroupSchema = z.object({
  by: z.string().min(1),
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
export const RepeaterBandSchema = z.object({ h: z.number().positive(), children: z.lazy(() => z.array(ElementSchema)) });
export const RepeaterGroupSchema = z.object({ by: z.string().min(1), header: RepeaterBandSchema.optional(), footer: RepeaterBandSchema.optional() });
export const RepeaterElementSchema = Base.extend({
  type: z.literal("repeater"),
  source: z.string().min(1),
  layout: z.enum(["list", "grid"]).default("list"),
  gap: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).default([0, 0]),
  item: z.object({ w: z.number().positive(), h: z.number().positive(), children: z.lazy(() => z.array(ElementSchema)) }),
  groups: z.array(RepeaterGroupSchema).default([]),
  overflow: z.enum(["continue", "clip"]).default("continue"),
});
export type RepeaterElement = { … } & { type: "repeater"; … };   // 재귀 타입은 group처럼 수동 선언
export type TableElement = z.infer<typeof TableElementSchema>;
export type TableColumn = z.infer<typeof TableColumnSchema>;
export type TableGroup = z.infer<typeof TableGroupSchema>;
export type RepeaterBand = { h: number; children: Element[] };
export type RepeaterGroup = { by: string; header?: RepeaterBand; footer?: RepeaterBand };
```

`src/schema/tree.ts` (신규)
```ts
export function childArrays(el: Element): Element[][];   // group → [children]; repeater → [item.children, ...groups의 header/footer children]; 그 밖 → []
export function walkElements(els: Element[], fn: (el: Element, parent: Element[], index: number, ancestors: Element[]) => boolean | void): boolean;
export function collectIds(els: Element[]): Set<string>;
```

`src/schema/report.ts`
```ts
export const RESERVED_CONTEXT_NAMES: readonly string[];
export const RepeatSchema = z.object({ source: z.string().min(1), as: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("record") });
export const SampleSchema = z.object({ params: z.record(z.string(), z.unknown()).default({}), data: z.record(z.string(), z.unknown()).default({}), capturedAt: z.string() });
// HttpDatasetSchema: { name, type:"http", method: GET|POST default GET, url, headers: record<string,string> default {}, body?: string, rowsPath?: string }
export type HttpDataset = Extract<Dataset, { type: "http" }>;
export type SqlDataset = Extract<Dataset, { type: "sql" }>;
export type Repeat = z.infer<typeof RepeatSchema>;
export type Sample = z.infer<typeof SampleSchema>;
// ReportSchema 추가: repeat: RepeatSchema.optional(), sample: SampleSchema.optional()
// superRefine: walkElements로 id 유일성(템플릿 자식 포함), repeater 템플릿 안 repeater 금지, 템플릿 안 table은 overflow "clip"만,
//              데이터셋 이름·repeat.as는 RESERVED_CONTEXT_NAMES 금지, 데이터셋 이름 중복 금지
```

`src/expression/engine.ts`: 함수 `avg`, `min`, `max` 추가. 컴파일 캐시 `compileCached(expression)` (내부, 최대 2000개, 넘치면 비움).

`src/expression/source.ts` (신규)
```ts
export function evaluateSource(expr: string, ctx: DataContext): unknown[];   // null·undefined → []. 배열 아님 → ExpressionError(expr, "source is not an array")
export const PAGE_VARS_RE: RegExp;   // /\b(page|total|sheet|sheets|copy|copies|pageRows)\b/
export function usesPageVars(template: string): boolean;
```

`src/data/infer.ts` (신규)
```ts
export type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
export type FieldNode = { name: string; path: string; type: FieldType; children?: FieldNode[] };
export function inferFields(rows: unknown, opts?: { sampleSize?: number; maxDepth?: number }): FieldNode[];
```

`src/index.ts`는 위 신규 모듈을 모두 재export 한다.

### renderer (`packages/renderer`)

`src/layout/types.ts`
```ts
type PlacedBase = { elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string;
  instance?: string; clipped?: boolean; role?: "flowBox" | "cell" | "border" | "template"; overflow?: boolean };
export type Page = { index: number; width: number; height: number; items: PlacedItem[]; copyIndex: number; pageInCopy: number };
```

`src/layout/errors.ts`: `export class LayoutLimitError extends Error { readonly code = "LAYOUT_LIMIT" }`, `export const MAX_PAGES = 2000`.

`src/text/cache.ts`: `export type MeasureCache = { wrap(text: string, fontSize: number, bold: boolean, width: number): string[] }`, `export function createMeasureCache(): MeasureCache`.

`src/flow/types.ts`
```ts
export type Region = { x: number; y: number; w: number; h: number };
export type BlockKind = "header" | "row" | "groupHeader" | "groupFooter" | "pageFooter" | "footer";
export type PageFlowContext = { page: number; total: number; sheet: number; sheets: number; copy: number; copies: number; pageRows: unknown[] };
export type Block = { kind: BlockKind; height: number; keepWithNext: boolean; rows: unknown[]; paint(origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[] };
export type FlowInput = { header?: Block; pageFooter?: Block; body: Block[]; footer?: Block };
export type FlowPlacement = { block: Block; y: number; overflow: boolean };
export type FlowPage = { placements: FlowPlacement[]; pageRows: unknown[]; overflow: boolean; truncated: boolean };
export type FlowOptions = { measure: MeasureCache; onExpressionError: "blank" | "fail"; instancePrefix?: string };
```

`src/flow/paginate.ts`: `export function paginate(input: FlowInput, opts: { first: Region; next: Region; repeatHeader: boolean; clip: boolean }): FlowPage[]`

`src/flow/table.ts`: `export function tableFlow(el: TableElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] }`
`src/flow/repeater.ts`: `export function repeaterFlow(el: RepeaterElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] }`
`src/flow/children.ts`: `export function paintChildren(children: Element[], origin: { x: number; y: number }, ctx: DataContext, opts: FlowOptions & { instance: string }): PlacedItem[]` (반복 영역 항목·밴드의 자식을 그린다. table은 clip 흐름으로)

`src/layout/place.ts`: `export function placeStatic(el: FlatElement, ctx: DataContext, opts: { onExpressionError: "blank" | "fail"; instance?: string }): PlacedItem[]` (table·repeater를 받으면 던진다), `export function errorItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, message: string, instance?: string): PlacedText`, `export function isVisible(visible: string | undefined, ctx: DataContext): boolean`

`src/layout/layout.ts`: `export function layout(report: Report, data: DataContext, opts?: { maxPages?: number }): Page[]`

`src/paint/Paint.tsx`: React key `${elementId}|${instance ?? ""}|${n}`, DOM `data-instance`, `data-role` 속성.

### datasource (`packages/datasource`, 신규 `@daport/datasource`)

```ts
// src/types.ts
export type DatasetErrorCode = "TIMEOUT" | "HOST_NOT_ALLOWED" | "HTTP_STATUS" | "BAD_JSON" | "ROWS_PATH" | "TOO_LARGE" | "TOO_MANY_ROWS" | "SQL_NOT_CONFIGURED" | "SQL_ERROR" | "BAD_DATA";
export type DatasetError = { dataset: string; code: DatasetErrorCode; message: string };
export class DatasetFailure extends Error { readonly code: DatasetErrorCode; constructor(code: DatasetErrorCode, message: string) }
export type Limits = { timeoutMs: number; maxBytes: number; maxRows: number };
export const DEFAULT_LIMITS: Limits;   // { timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024, maxRows: 10_000 }
export type HttpRequest = { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string };
export interface HttpConnector { request(req: HttpRequest, limits: Limits): Promise<unknown> }
export interface SqlConnector { query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal }): Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }> }
export type Connectors = { http?: HttpConnector; sql?: Record<string, SqlConnector> };
export type SecretResolver = (name: string) => string | undefined;
// src/execute.ts
export function executeDatasets(report: Report, opts: { params: Record<string, unknown>; data?: Record<string, unknown>; connectors: Connectors; secrets: SecretResolver; limits?: Partial<Limits> }): Promise<{ context: DataContext; errors: DatasetError[] }>;
export function toRows(value: unknown): Record<string, unknown>[];   // 객체 → [객체], 객체 배열 → 그대로, 그 밖 → DatasetFailure("BAD_DATA")
// src/http.ts
export function parseAllowList(value: string | undefined): string[];
export function createFetchHttpConnector(opts: { allow: string[]; fetch?: typeof fetch }): HttpConnector;
export function buildHttpRequest(ds: HttpDataset, params: Record<string, unknown>, secrets: SecretResolver): { request: HttpRequest; usedSecrets: string[] };
export function pickRows(json: unknown, rowsPath: string | undefined): Record<string, unknown>[];
export function maskSecrets(message: string, values: string[]): string;
// src/sql.ts
export function extractBinds(sql: string, params: Record<string, unknown>): Record<string, unknown>;
// src/secrets.ts
export function envSecrets(env?: Record<string, string | undefined>): SecretResolver;   // DAPORT_SECRET_<NAME>, NAME은 [A-Z0-9_]+
```

### studio (`apps/studio`)

- `src/lib/data.ts`: `sampleParams(report)` 유지. `sampleContext(report: Report): DataContext` 신규. `resolveDataSync` 삭제.
- `src/lib/body.ts` (신규): `readJsonBody(req: Request, maxBytes: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }>`. `export const MAX_BODY_BYTES = 20 * 1024 * 1024`.
- `src/lib/datasets.ts` (신규, 서버 전용): `runDatasets(report: Report, input: { params?: Record<string, unknown>; data?: Record<string, unknown> }): Promise<{ context: DataContext; errors: DatasetError[] }>`.
- `src/lib/assets.ts`: `resolveAssetUrls`는 `walkElements`로 템플릿 자식까지 바꾼다.
- `src/app/api/reports/[id]/sample/route.ts` (신규): 응답 `{ data: Record<string, unknown[]>, fields: Record<string, FieldNode[]>, errors: DatasetError[], capturedAt: string }`. `SAMPLE_ROWS = 200`은 `src/lib/datasets.ts`가 export한다(route.ts는 HTTP 메서드 외 export 불가).
- `src/editor/store.ts` 추가 상태·액션:
  ```ts
  view: { copyIndex: number; pageInCopy: number }; setView(v: Partial<{ copyIndex: number; pageInCopy: number }>): void;
  liveData: boolean; setLiveData(v: boolean): void;
  setSample(sample: Report["sample"]): void;
  setDatasets(datasets: Report["datasets"]): void;
  setParams(params: Report["params"]): void;
  setRepeat(repeat: Report["repeat"] | undefined): void;
  addElement(el: Element, opts?: { into?: { repeaterId: string; band: "item" | "groupHeader" | "groupFooter"; groupIndex?: number } }): void;
  findParentRepeater(id: string): string | undefined;   // id가 어떤 repeater 템플릿 안에 있으면 그 repeater id
  ```
- `src/editor/data/`: `DataPanel.tsx`, `DatasetEditor.tsx`, `FieldTree.tsx`, `bindings.ts`:
  ```ts
  export type DragField = { dataset: string; path: string; type: FieldType; isArray: boolean; children?: FieldNode[] };
  export type DropTarget = { kind: "canvas"; x: number; y: number } | { kind: "table"; tableId: string } | { kind: "repeaterItem"; repeaterId: string; x: number; y: number };
  export type DropResult = { action: "addElement"; element: Element; into?: { repeaterId: string; band: "item" } } | { action: "addColumn"; tableId: string; column: TableColumn; warning?: string } | { action: "none"; warning?: string };
  export function resolveDrop(field: DragField, target: DropTarget, report: Report, allocateId: (base: string) => string): DropResult;
  export const DRAG_MIME = "application/x-daport-field";
  export function sourceDataset(source: string): string | undefined;   // 소스 표현식의 루트 식별자 (record.items → undefined, items[...] → items)
  ```
- `src/editor/panels/TablePanel.tsx`, `src/editor/panels/RepeaterPanel.tsx` (신규). `PropertyPanel.tsx`는 table·repeater면 이 패널을 렌더.
- `src/editor/PageSelector.tsx` (신규). `src/editor/canvas/Canvas.tsx`는 `view`로 페이지를 고르고 `pages`를 스토어 밖 `useMemo`로 계산한다.
- E2E: `apps/studio/e2e/phase2.spec.ts`.

---

## 태스크 목록과 실행 웨이브

각 웨이브 안의 레인은 서로 다른 파일만 건드려 병렬로 실행할 수 있다(`git worktree`로 레인마다 브랜치). 레인 안의 태스크는 순서대로 실행한다. 웨이브가 끝나면 레인을 통합 브랜치(`feature/phase2`)에 병합하고 루트에서 `pnpm typecheck && pnpm test`를 돌린다.

| 웨이브 | 레인 | 태스크 | 의존 |
|---|---|---|---|
| 1 | core-schema | T1 표 스키마 확장 · T2 반복 영역 스키마와 요소 트리 탐색 · T3 레포트 repeat·sample·데이터셋 스키마 | - |
| 1 | core-expr | T4 avg/min/max·컴파일 캐시·소스 표현식 · T5 필드 추론 | - |
| 1 | flow-core | T6 흐름 타입·측정 캐시·한도 오류 · T7 paginate와 불변식 테스트 | - |
| 1 | datasource | T8 datasource 패키지와 executeDatasets(static·요청 data) · T9 SQL 커넥터 경계 | - |
| 2 | flow | T10 표 흐름 조각 · T11 반복 영역 흐름 조각·자식 그리기 | T1 T2 T4 T6 T7 (T11은 T10의 tableFlow를 쓴다) |
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

T1~T3은 같은 파일(`elements.ts`, `report.ts`)을 순서대로 고치므로 한 레인이다. T6·T7은 renderer의 새 파일만 만들고 기존 `layout.ts`는 T14에서 바꾼다. T10과 T11은 한 레인에서 순서대로 실행한다(T11의 `flow/paint.ts`가 T10의 `tableFlow`로 템플릿 안 clip 표를 그린다).

---
## 웨이브 1

### Task 1: core 표 스키마 확장 (셀·그룹·테두리·스타일 덮어쓰기)

**Files:**
- Modify: `packages/core/src/schema/style.ts`
- Modify: `packages/core/src/schema/elements.ts` (TableColumnSchema, TableElementSchema)
- Test: `packages/core/src/__tests__/table-schema.test.ts`

**Interfaces:**
- Consumes: 1단계 `StyleSchema`, `Base`, `color()`(style.ts 안의 지역 함수 — export로 바꾼다).
- Produces: `StyleOverrideSchema`, `StyleOverride`, `mergeStyle`, `CellAlignSchema`, `TableCellSchema`, `TableCell`, `TableGroupSchema`, `TableGroup`, `TableColumn`, `TableElement`(추가 필드 `border borderStyle headerStyle groups pageFooter footer`, 열 `align?`).

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/table-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "../schema/report";
import { StyleSchema, StyleOverrideSchema, mergeStyle } from "../schema/style";
import { TableElementSchema } from "../schema/elements";

const base = { id: "r", version: 1, page: { width: 210, height: 297 } };
const table = { id: "t", type: "table", x: 0, y: 0, w: 100, h: 50, source: "items", columns: [{ header: "A", value: "{{ row.A }}", w: 50 }] };

describe("StyleOverrideSchema / mergeStyle", () => {
  it("accepts a partial style without filling defaults", () => {
    expect(StyleOverrideSchema.parse({ bold: true })).toEqual({ bold: true });
    expect(StyleOverrideSchema.parse({})).toEqual({});
  });
  it("rejects unsafe colors like the full schema", () => {
    expect(StyleOverrideSchema.safeParse({ color: "red;background:url(x)" }).success).toBe(false);
  });
  it("mergeStyle overlays defined values only, later overrides win", () => {
    const s = mergeStyle(StyleSchema.parse({ fontSize: 8 }), { bold: true, fontSize: undefined }, undefined, { align: "right" });
    expect(s).toMatchObject({ fontSize: 8, bold: true, align: "right", color: "#000000" });
  });
});

describe("table schema (phase 2)", () => {
  it("fills new defaults: border all, borderStyle, headerStyle, groups, pageFooter, footer", () => {
    const r = parseReport({ ...base, elements: [table] });
    const t = r.elements[0];
    expect(t.type).toBe("table");
    if (t.type !== "table") return;
    expect(t.border).toBe("all");
    expect(t.borderStyle).toEqual({ stroke: "#000000", strokeWidth: 0.2 });
    expect(t.headerStyle).toEqual({});
    expect(t.groups).toEqual([]);
    expect(t.pageFooter).toEqual([]);
    expect(t.footer).toEqual([]);
    expect(t.columns[0].align).toBeUndefined();
    expect(t.columns[0].style.fontSize).toBe(10);   // 1단계 열 스타일은 그대로 기본값이 채워진다
  });
  it("parses cells with span, align and a style override", () => {
    const t = TableElementSchema.parse({ ...table, footer: [{ value: "합계", span: "all", align: "right", style: { bold: true } }, { value: "" }] });
    expect(t.footer[0]).toEqual({ value: "합계", span: "all", align: "right", style: { bold: true } });
    expect(t.footer[1]).toEqual({ value: "", span: 1 });
  });
  it("parses groups with by/header/footer and keepHeaderWithRows default true", () => {
    const t = TableElementSchema.parse({ ...table, groups: [{ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }] }] });
    expect(t.groups[0]).toEqual({ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }], footer: [], keepHeaderWithRows: true });
  });
  it("rejects a zero span, an unknown border and an unsafe border color", () => {
    expect(TableElementSchema.safeParse({ ...table, footer: [{ value: "x", span: 0 }] }).success).toBe(false);
    expect(TableElementSchema.safeParse({ ...table, border: "dotted" }).success).toBe(false);
    expect(TableElementSchema.safeParse({ ...table, borderStyle: { stroke: "url(x)" } }).success).toBe(false);
  });
  it("keeps 1단계 table JSON valid (keepTogether none is accepted)", () => {
    expect(TableElementSchema.safeParse({ ...table, keepTogether: "none", overflow: "clip" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- table-schema`
Expected: FAIL — `StyleOverrideSchema`, `mergeStyle` 없음(import 오류).

- [ ] **Step 3: style.ts 구현**

`packages/core/src/schema/style.ts` 전체를 이렇게 바꾼다:
```ts
import { z } from "zod";
import { isSafeCssColor } from "./color";

export const color = () => z.string().refine(isSafeCssColor, { message: "invalid color" });

export const StyleSchema = z.object({
  fontFamily: z.enum(["Pretendard"]).default("Pretendard"),
  fontSize: z.number().positive().default(10),     // pt
  bold: z.boolean().default(false),
  color: color().default("#000000"),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  wrap: z.boolean().default(true),
  lineHeight: z.number().positive().default(1.3),  // 배수
  stroke: color().optional(),                      // 선/테두리 색
  strokeWidth: z.number().nonnegative().default(0.2), // mm
  fill: color().optional(),
  radius: z.number().nonnegative().default(0),     // mm
  padding: z.number().nonnegative().default(0),    // mm
});
export type Style = z.infer<typeof StyleSchema>;
export type StyleInput = z.input<typeof StyleSchema>;

/** 열·머리 스타일 위에 덮어쓸 값만 담는 부분 스타일. 기본값을 채우지 않아야 "지정하지 않음"과 "기본값"을 구분한다 */
export const StyleOverrideSchema = z.object({
  fontFamily: z.enum(["Pretendard"]).optional(),
  fontSize: z.number().positive().optional(),
  bold: z.boolean().optional(),
  color: color().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  wrap: z.boolean().optional(),
  lineHeight: z.number().positive().optional(),
  stroke: color().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  fill: color().optional(),
  radius: z.number().nonnegative().optional(),
  padding: z.number().nonnegative().optional(),
});
export type StyleOverride = z.infer<typeof StyleOverrideSchema>;

/** base 위에 overrides를 순서대로 얹는다. undefined 값은 덮어쓰지 않는다 */
export function mergeStyle(base: Style, ...overrides: (StyleOverride | undefined)[]): Style {
  const out: Style = { ...base };
  for (const o of overrides) {
    if (!o) continue;
    for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: elements.ts의 표 스키마 교체**

`packages/core/src/schema/elements.ts`에서 `import { StyleSchema } from "./style";`를 `import { StyleSchema, StyleOverrideSchema, color } from "./style";`로 바꾸고, `TableColumnSchema`와 `TableElementSchema`를 다음으로 교체한다:
```ts
export const CellAlignSchema = z.enum(["left", "center", "right"]);
/** 머리행·그룹 행·소계 행의 셀. span은 차지하는 열 수("all"은 남은 열 전부). 스타일은 열·머리 스타일 위에 덮어쓸 값만 */
export const TableCellSchema = z.object({
  value: z.string().default(""),
  span: z.union([z.number().int().positive(), z.literal("all")]).default(1),
  align: CellAlignSchema.optional(),
  style: StyleOverrideSchema.optional(),
});
export type TableCell = z.infer<typeof TableCellSchema>;
export const TableColumnSchema = z.object({
  header: z.string().default(""),
  value: z.string().default(""),
  w: z.number().positive(),
  align: CellAlignSchema.optional(),              // 없으면 style.align
  style: StyleSchema.prefault({}),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;
/** 그룹 경계는 데이터 순서대로 연속된 같은 key다. 앞 항목이 바깥 그룹 */
export const TableGroupSchema = z.object({
  by: z.string().min(1),                          // 표현식 (행 컨텍스트에서 평가)
  header: z.array(TableCellSchema).default([]),
  footer: z.array(TableCellSchema).default([]),
  keepHeaderWithRows: z.boolean().default(true),
});
export type TableGroup = z.infer<typeof TableGroupSchema>;
export const TableElementSchema = Base.extend({
  type: z.literal("table"),
  source: z.string().min(1),                      // 배열로 평가되는 표현식
  columns: z.array(TableColumnSchema),
  repeatHeader: z.boolean().default(true),
  overflow: z.enum(["continue", "clip"]).default("continue"),
  keepTogether: z.enum(["none", "row"]).default("row"),   // 2단계에서는 늘 row로 동작
  rowHeight: z.number().positive().default(6),    // 최소 행 높이(mm)
  headerHeight: z.number().positive().default(7), // 최소 머리행 높이(mm)
  border: z.enum(["all", "rows", "none"]).default("all"),
  borderStyle: z.object({ stroke: color().default("#000000"), strokeWidth: z.number().nonnegative().default(0.2) }).prefault({}),
  headerStyle: StyleOverrideSchema.default({}),
  groups: z.array(TableGroupSchema).default([]),
  pageFooter: z.array(TableCellSchema).default([]),
  footer: z.array(TableCellSchema).default([]),
});
export type TableElement = z.infer<typeof TableElementSchema>;
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm --filter @daport/core typecheck`
Expected: 새 테스트 6개 PASS, 기존 테스트 PASS. renderer·studio는 아직 빌드하지 않아도 된다(`TableElement`의 추가 필드는 모두 기본값이라 기존 코드가 깨지지 않는다).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema/style.ts packages/core/src/schema/elements.ts packages/core/src/__tests__/table-schema.test.ts
git commit -m "feat(core): 표 스키마 확장 — 셀·그룹·테두리·스타일 덮어쓰기"
```

---

### Task 2: core 반복 영역 스키마와 요소 트리 탐색

**Files:**
- Modify: `packages/core/src/schema/elements.ts` (RepeaterElementSchema, ElementSchema union, 타입)
- Create: `packages/core/src/schema/tree.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./schema/tree"`)
- Test: `packages/core/src/__tests__/repeater-schema.test.ts`, `packages/core/src/__tests__/tree.test.ts`

**Interfaces:**
- Consumes: T1의 `TableElementSchema`, 1단계 `Base`, `GroupElementSchema` 패턴.
- Produces: `RepeaterElementSchema`, `RepeaterBandSchema`, `RepeaterGroupSchema`, 타입 `RepeaterElement`, `RepeaterBand`, `RepeaterGroup`; `childArrays(el)`, `walkElements(els, fn)`, `collectIds(els)`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/repeater-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ElementSchema } from "../schema/elements";

const text = (id: string) => ({ id, type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.NAME }}" });
const rep = { id: "cards", type: "repeater", x: 10, y: 40, w: 190, h: 240, source: "lots", item: { w: 60, h: 35, children: [text("nm")] } };

describe("repeater schema", () => {
  it("parses with defaults list/gap/groups/overflow and template children", () => {
    const el = ElementSchema.parse(rep);
    expect(el.type).toBe("repeater");
    if (el.type !== "repeater") return;
    expect(el.layout).toBe("list");
    expect(el.gap).toEqual([0, 0]);
    expect(el.groups).toEqual([]);
    expect(el.overflow).toBe("continue");
    expect(el.item.children[0]).toMatchObject({ id: "nm", type: "text", style: { fontSize: 10 } });
  });
  it("parses grid layout with groups whose bands have h and children", () => {
    const el = ElementSchema.parse({ ...rep, layout: "grid", gap: [2, 3], groups: [{ by: "item.LINE", header: { h: 8, children: [text("gh")] } }] });
    if (el.type !== "repeater") return;
    expect(el.gap).toEqual([2, 3]);
    expect(el.groups[0].header?.children[0].id).toBe("gh");
    expect(el.groups[0].footer).toBeUndefined();
  });
  it("rejects missing item, non-positive item size and negative gap", () => {
    expect(ElementSchema.safeParse({ ...rep, item: undefined }).success).toBe(false);
    expect(ElementSchema.safeParse({ ...rep, item: { w: 0, h: 10, children: [] } }).success).toBe(false);
    expect(ElementSchema.safeParse({ ...rep, gap: [-1, 0] }).success).toBe(false);
  });
});
```

`packages/core/src/__tests__/tree.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ElementSchema, type Element } from "../schema/elements";
import { childArrays, walkElements, collectIds } from "../schema/tree";

const els: Element[] = [
  ElementSchema.parse({ id: "a", type: "text", x: 0, y: 0, w: 1, h: 1 }),
  ElementSchema.parse({ id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "b", type: "rect", x: 0, y: 0, w: 1, h: 1 }] }),
  ElementSchema.parse({ id: "r", type: "repeater", x: 0, y: 0, w: 1, h: 1, source: "s", item: { w: 1, h: 1, children: [{ id: "c", type: "text", x: 0, y: 0, w: 1, h: 1 }] },
    groups: [{ by: "item.k", header: { h: 1, children: [{ id: "d", type: "rect", x: 0, y: 0, w: 1, h: 1 }] }, footer: { h: 1, children: [{ id: "e", type: "rect", x: 0, y: 0, w: 1, h: 1 }] } }] }),
];

describe("tree", () => {
  it("childArrays: group → [children], repeater → [item, group header, group footer], leaf → []", () => {
    expect(childArrays(els[0])).toEqual([]);
    expect(childArrays(els[1]).map((a) => a.map((e) => e.id))).toEqual([["b"]]);
    expect(childArrays(els[2]).map((a) => a.map((e) => e.id))).toEqual([["c"], ["d"], ["e"]]);
  });
  it("walkElements visits depth-first in document order with parent, index and ancestors", () => {
    const seen: string[] = [];
    walkElements(els, (el, parent, i, ancestors) => { seen.push(`${el.id}:${parent[i] === el}:${ancestors.map((a) => a.id).join("/")}`); });
    expect(seen).toEqual(["a:true:", "g:true:", "b:true:g", "r:true:", "c:true:r", "d:true:r", "e:true:r"]);
  });
  it("walkElements stops when fn returns true", () => {
    const seen: string[] = [];
    expect(walkElements(els, (el) => { seen.push(el.id); return el.id === "b"; })).toBe(true);
    expect(seen).toEqual(["a", "g", "b"]);
    expect(walkElements(els, () => {})).toBe(false);
  });
  it("collectIds includes template children", () => {
    expect([...collectIds(els)].sort()).toEqual(["a", "b", "c", "d", "e", "g", "r"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- repeater tree`
Expected: FAIL — `../schema/tree` 없음, repeater 타입 거부.

- [ ] **Step 3: elements.ts에 repeater 추가**

`packages/core/src/schema/elements.ts`의 `type LeafElement = …` 앞에 넣고, `GroupElement`·`Element`·`ElementSchema`를 아래처럼 바꾼다:
```ts
export type RepeaterBand = { h: number; children: Element[] };
export type RepeaterGroup = { by: string; header?: RepeaterBand; footer?: RepeaterBand };
export type RepeaterElement = z.infer<typeof Base> & {
  type: "repeater";
  source: string;
  layout: "list" | "grid";
  gap: [number, number];
  item: { w: number; h: number; children: Element[] };
  groups: RepeaterGroup[];
  overflow: "continue" | "clip";
};

type LeafElement =
  | z.infer<typeof TextElementSchema> | z.infer<typeof ImageElementSchema>
  | z.infer<typeof LineElementSchema> | z.infer<typeof RectElementSchema>
  | z.infer<typeof BarcodeElementSchema> | z.infer<typeof PageNumberElementSchema>
  | z.infer<typeof RefElementSchema> | z.infer<typeof TableElementSchema>;
export type GroupElement = z.infer<typeof Base> & { type: "group"; children: Element[] };
export type Element = LeafElement | GroupElement | RepeaterElement;

export const GroupElementSchema: z.ZodType<GroupElement> = Base.extend({
  type: z.literal("group"),
  children: z.lazy(() => z.array(ElementSchema)),
}) as unknown as z.ZodType<GroupElement>;

/** 반복 영역의 항목·그룹 머리·소계 템플릿. 자식 좌표는 밴드 좌상단 기준 */
export const RepeaterBandSchema = z.object({ h: z.number().positive(), children: z.lazy(() => z.array(ElementSchema)) });
export const RepeaterGroupSchema = z.object({ by: z.string().min(1), header: RepeaterBandSchema.optional(), footer: RepeaterBandSchema.optional() });
export const RepeaterElementSchema: z.ZodType<RepeaterElement> = Base.extend({
  type: z.literal("repeater"),
  source: z.string().min(1),
  layout: z.enum(["list", "grid"]).default("list"),
  gap: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).default([0, 0]),   // [가로, 세로] mm
  item: z.object({ w: z.number().positive(), h: z.number().positive(), children: z.lazy(() => z.array(ElementSchema)) }),
  groups: z.array(RepeaterGroupSchema).default([]),
  overflow: z.enum(["continue", "clip"]).default("continue"),
}) as unknown as z.ZodType<RepeaterElement>;

export const ElementSchema: z.ZodType<Element> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TextElementSchema, ImageElementSchema, LineElementSchema, RectElementSchema,
    BarcodeElementSchema, PageNumberElementSchema, RefElementSchema, TableElementSchema,
    GroupElementSchema as any, RepeaterElementSchema as any,
  ])
) as unknown as z.ZodType<Element>;
```

- [ ] **Step 4: tree.ts 작성**

`packages/core/src/schema/tree.ts`:
```ts
import type { Element } from "./elements";

/** 요소가 직접 가진 자식 배열들. group → [children], repeater → [item.children, 그룹마다 header·footer children], 그 밖 → [] */
export function childArrays(el: Element): Element[][] {
  if (el.type === "group") return [el.children];
  if (el.type === "repeater") {
    const out = [el.item.children];
    for (const g of el.groups) {
      if (g.header) out.push(g.header.children);
      if (g.footer) out.push(g.footer.children);
    }
    return out;
  }
  return [];
}

/**
 * 깊이 우선·문서 순서로 모든 요소를 방문한다(반복 영역 템플릿 자식 포함). fn이 true를 돌려주면 중단하고 true를 돌려준다.
 * parent는 el이 들어 있는 배열, index는 그 안의 위치, ancestors는 바깥부터 차례로 모은 조상(group·repeater).
 * 스키마 검증·렌더러·스튜디오 스토어가 모두 이 함수만 쓴다
 */
export function walkElements(
  els: Element[],
  fn: (el: Element, parent: Element[], index: number, ancestors: Element[]) => boolean | void,
  ancestors: Element[] = [],
): boolean {
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (fn(el, els, i, ancestors)) return true;
    for (const arr of childArrays(el)) if (walkElements(arr, fn, [...ancestors, el])) return true;
  }
  return false;
}

export function collectIds(els: Element[]): Set<string> {
  const ids = new Set<string>();
  walkElements(els, (el) => { ids.add(el.id); });
  return ids;
}
```

`packages/core/src/index.ts`에 `export * from "./schema/tree";`를 `./schema/elements` 줄 다음에 추가한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm --filter @daport/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema/elements.ts packages/core/src/schema/tree.ts packages/core/src/index.ts packages/core/src/__tests__/repeater-schema.test.ts packages/core/src/__tests__/tree.test.ts
git commit -m "feat(core): 반복 영역 요소 스키마와 요소 트리 탐색"
```

---

### Task 3: core 레포트 repeat·sample·데이터셋 스키마와 검증 규칙

**Files:**
- Modify: `packages/core/src/schema/report.ts`
- Test: `packages/core/src/__tests__/report-schema.test.ts`

**Interfaces:**
- Consumes: T2 `walkElements`.
- Produces: `RESERVED_CONTEXT_NAMES`, `RepeatSchema`, `SampleSchema`, `HttpDatasetSchema`, `SqlDatasetSchema`, `StaticDatasetSchema`, 타입 `Repeat`, `Sample`, `HttpDataset`, `SqlDataset`, `Report.repeat?`, `Report.sample?`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/report-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, safeParseReport, RESERVED_CONTEXT_NAMES } from "../schema/report";

const base = { id: "r", version: 1, page: { width: 210, height: 297 } };
const text = (id: string) => ({ id, type: "text", x: 1, y: 1, w: 20, h: 5, value: "x" });
const table = (id: string, overflow?: string) => ({ id, type: "table", x: 0, y: 0, w: 100, h: 50, source: "items", columns: [], ...(overflow ? { overflow } : {}) });
const repeater = (id: string, children: unknown[]) => ({ id, type: "repeater", x: 0, y: 0, w: 100, h: 100, source: "lots", item: { w: 50, h: 20, children } });
const issues = (input: unknown) => { const r = safeParseReport(input); return r.success ? [] : r.error.issues.map((i) => i.message); };

describe("report schema (phase 2)", () => {
  it("parses repeat with default as=record and sample with defaults", () => {
    const r = parseReport({ ...base, repeat: { source: "shipments" }, sample: { capturedAt: "2026-09-17T00:00:00.000Z" } });
    expect(r.repeat).toEqual({ source: "shipments", as: "record" });
    expect(r.sample).toEqual({ params: {}, data: {}, capturedAt: "2026-09-17T00:00:00.000Z" });
    expect(parseReport(base).repeat).toBeUndefined();
  });
  it("rejects a repeat.as that is not an identifier or is reserved", () => {
    expect(issues({ ...base, repeat: { source: "s", as: "1x" } }).length).toBeGreaterThan(0);
    expect(issues({ ...base, repeat: { source: "s", as: "row" } })).toContain("reserved name: row");
    expect(RESERVED_CONTEXT_NAMES).toContain("pageRows");
  });
  it("parses http dataset with headers/body/rowsPath and sql dataset", () => {
    const r = parseReport({ ...base, datasets: [
      { name: "orders", type: "http", url: "https://mes.example.com/{{ params.no }}", headers: { Authorization: "Bearer {{ secrets.T }}" }, method: "POST", body: "{}", rowsPath: "data.items" },
      { name: "items", type: "sql", connection: "mes", query: "SELECT 1 FROM DUAL" },
    ]});
    expect(r.datasets[0]).toMatchObject({ type: "http", method: "POST", headers: { Authorization: "Bearer {{ secrets.T }}" }, rowsPath: "data.items" });
    const http = parseReport({ ...base, datasets: [{ name: "o", type: "http", url: "https://x" }] }).datasets[0];
    expect(http).toEqual({ name: "o", type: "http", url: "https://x", method: "GET", headers: {} });
  });
  it("rejects reserved or duplicate dataset names", () => {
    expect(issues({ ...base, datasets: [{ name: "record", type: "static", rows: [] }] })).toContain("reserved name: record");
    expect(issues({ ...base, datasets: [{ name: "a", type: "static", rows: [] }, { name: "a", type: "static", rows: [] }] })).toContain("duplicate dataset name: a");
  });
  it("rejects duplicate ids across repeater template children", () => {
    expect(issues({ ...base, elements: [text("t"), repeater("r", [text("t")])] })).toContain("duplicate element id: t");
  });
  it("rejects a repeater inside a repeater template and a continue-table inside a template", () => {
    expect(issues({ ...base, elements: [repeater("r", [repeater("r2", [])])] })).toContain("repeater inside repeater template: r2");
    expect(issues({ ...base, elements: [repeater("r", [table("t")])] })).toContain('table inside repeater template must be overflow "clip": t');
    expect(issues({ ...base, elements: [repeater("r", [table("t", "clip")])] })).toEqual([]);
    expect(issues({ ...base, elements: [repeater("r", [{ id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [table("t")] }])] }))
      .toContain('table inside repeater template must be overflow "clip": t');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- report-schema`
Expected: FAIL — `RESERVED_CONTEXT_NAMES` 없음, repeat·sample 키가 버려짐.

- [ ] **Step 3: report.ts 교체**

`packages/core/src/schema/report.ts` 전체:
```ts
import { z } from "zod";
import { ElementSchema } from "./elements";
import { walkElements } from "./tree";

export const PageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  margin: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([10, 10, 10, 10]), // top,right,bottom,left
  unit: z.literal("mm").default("mm"),
});

/** 표현식 컨텍스트가 쓰는 이름. 데이터셋 이름·repeat.as로 쓰면 데이터가 가려지므로 금지한다 */
export const RESERVED_CONTEXT_NAMES: readonly string[] = [
  "params", "secrets", "record", "row", "item", "index", "group", "rows", "pageRows", "page", "total", "sheet", "sheets", "copy", "copies",
];

export const StaticDatasetSchema = z.object({ name: z.string().min(1), type: z.literal("static"), rows: z.array(z.record(z.string(), z.unknown())) });
export const SqlDatasetSchema = z.object({ name: z.string().min(1), type: z.literal("sql"), connection: z.string(), query: z.string() });
export const HttpDatasetSchema = z.object({
  name: z.string().min(1), type: z.literal("http"),
  url: z.string(),                                            // 템플릿. 값은 encodeURIComponent
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),      // 값은 템플릿(그대로 넣음)
  body: z.string().optional(),                                // POST 본문 템플릿
  rowsPath: z.string().optional(),                            // 점 경로. 생략 시 응답 루트
});
export const DatasetSchema = z.discriminatedUnion("type", [StaticDatasetSchema, SqlDatasetSchema, HttpDatasetSchema]);

export const ParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "date"]).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export const RepeatSchema = z.object({
  source: z.string().min(1),                                  // 배열로 평가되는 표현식
  as: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).default("record"),
});
export const SampleSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  data: z.record(z.string(), z.unknown()).default({}),        // 데이터셋 이름 → 행 배열(앞 200행)
  capturedAt: z.string(),
});

export const ReportSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다"),   // URL 경로에 그대로 쓴다
  name: z.string().default(""),
  version: z.number().int().nonnegative().default(1),
  page: PageSchema,
  datasets: z.array(DatasetSchema).default([]),
  params: z.array(ParamSchema).default([]),
  elements: z.array(ElementSchema).default([]),
  onExpressionError: z.enum(["blank", "fail"]).default("blank"),
  repeat: RepeatSchema.optional(),
  sample: SampleSchema.optional(),
}).superRefine((r, ctx) => {
  const seen = new Set<string>();
  walkElements(r.elements, (el, _parent, _i, ancestors) => {
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: ["elements"] });
    seen.add(el.id);
    const inTemplate = ancestors.some((a) => a.type === "repeater");
    if (inTemplate && el.type === "repeater") ctx.addIssue({ code: "custom", message: `repeater inside repeater template: ${el.id}`, path: ["elements"] });
    if (inTemplate && el.type === "table" && el.overflow !== "clip") {
      ctx.addIssue({ code: "custom", message: `table inside repeater template must be overflow "clip": ${el.id}`, path: ["elements"] });
    }
  });
  const names = new Set<string>();
  r.datasets.forEach((ds, i) => {
    if (RESERVED_CONTEXT_NAMES.includes(ds.name)) ctx.addIssue({ code: "custom", message: `reserved name: ${ds.name}`, path: ["datasets", i, "name"] });
    if (names.has(ds.name)) ctx.addIssue({ code: "custom", message: `duplicate dataset name: ${ds.name}`, path: ["datasets", i, "name"] });
    names.add(ds.name);
  });
  if (r.repeat && RESERVED_CONTEXT_NAMES.includes(r.repeat.as)) ctx.addIssue({ code: "custom", message: `reserved name: ${r.repeat.as}`, path: ["repeat", "as"] });
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportInput = z.input<typeof ReportSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type HttpDataset = z.infer<typeof HttpDatasetSchema>;
export type SqlDataset = z.infer<typeof SqlDatasetSchema>;
export type StaticDataset = z.infer<typeof StaticDatasetSchema>;
export type Param = z.infer<typeof ParamSchema>;
export type Repeat = z.infer<typeof RepeatSchema>;
export type Sample = z.infer<typeof SampleSchema>;

export function parseReport(input: unknown): Report { return ReportSchema.parse(input); }
export function safeParseReport(input: unknown) { return ReportSchema.safeParse(input); }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm --filter @daport/core typecheck`
Expected: PASS. 1단계 `schema.test.ts`의 "rejects duplicate element ids"는 message가 같아 그대로 통과한다. `reportJsonSchema()`도 lazy 재귀가 group과 같은 방식이라 통과한다.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema/report.ts packages/core/src/__tests__/report-schema.test.ts
git commit -m "feat(core): 레포트 repeat·sample·http 데이터셋 스키마와 템플릿 검증 규칙"
```

---

### Task 4: core avg/min/max, 컴파일 캐시, 소스 표현식

**Files:**
- Modify: `packages/core/src/expression/engine.ts`
- Create: `packages/core/src/expression/source.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./expression/source"`)
- Test: `packages/core/src/__tests__/expression-phase2.test.ts`

**Interfaces:**
- Consumes: 1단계 `evaluate`, `ExpressionError`, `guardAst`, `checkKey`.
- Produces: 함수 `avg(rows, field)`, `min(rows, field)`, `max(rows, field)`; `evaluateSource(expr, ctx)`, `PAGE_VARS_RE`, `usesPageVars(template)`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/expression-phase2.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluate, ExpressionError } from "../expression/engine";
import { evaluateSource, usesPageVars } from "../expression/source";

const rows = [{ Q: 10 }, { Q: "20" }, { Q: null }, { Q: "abc" }, { Q: true }, {}];

describe("avg/min/max", () => {
  it("skip non-numeric values (null, empty, boolean, NaN strings)", () => {
    expect(evaluate("avg(rows, 'Q')", { rows })).toBe(15);
    expect(evaluate("min(rows, 'Q')", { rows })).toBe(10);
    expect(evaluate("max(rows, 'Q')", { rows })).toBe(20);
  });
  it("return null for an empty array or no numeric value, and for a non-array", () => {
    expect(evaluate("avg(rows, 'Q')", { rows: [] })).toBeNull();
    expect(evaluate("max(rows, 'Q')", { rows: [{ Q: "x" }] })).toBeNull();
    expect(evaluate("min(rows, 'Q')", { rows: 5 })).toBeNull();
  });
  it("reject prototype keys as field names", () => {
    expect(() => evaluate("avg(rows, '__proto__')", { rows })).toThrow(ExpressionError);
  });
});

describe("compile cache", () => {
  it("evaluates the same expression many times faster than re-parsing (10k rows under 300ms)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ A: i, B: `n${i}` }));
    const t0 = performance.now();
    for (const row of many) evaluate("row.A * 2 + (row.B == 'n3' ? 1 : 0)", { row });
    expect(performance.now() - t0).toBeLessThan(300);
  });
  it("still rejects forbidden identifiers and syntax errors after caching", () => {
    expect(() => evaluate("a.constructor", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluate("a.constructor", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluate("a +", { a: 1 })).toThrow(ExpressionError);
    expect(() => evaluate("a +", { a: 1 })).toThrow(ExpressionError);
  });
  it("keeps the filter key guard on cached expressions", () => {
    expect(() => evaluate("a['constructor']", { a: {} })).toThrow(ExpressionError);
    expect(() => evaluate("a['constructor']", { a: {} })).toThrow(ExpressionError);
    expect(evaluate("a['b']", { a: { b: 1 } })).toBe(1);
  });
});

describe("evaluateSource", () => {
  const ctx = { items: [{ ORDER_NO: "A", Q: 1 }, { ORDER_NO: "B", Q: 2 }, { ORDER_NO: "A", Q: 3 }], record: { ORDER_NO: "A", lines: [{ n: 1 }] } };
  it("returns the dataset array, a nested array and a jexl-filtered join", () => {
    expect(evaluateSource("items", ctx)).toHaveLength(3);
    expect(evaluateSource("record.lines", ctx)).toEqual([{ n: 1 }]);
    expect(evaluateSource("items[.ORDER_NO == record.ORDER_NO]", ctx).map((r) => (r as { Q: number }).Q)).toEqual([1, 3]);
  });
  it("treats null/undefined as empty and rejects a non-array with a clear message", () => {
    expect(evaluateSource("record.missing", ctx)).toEqual([]);
    expect(() => evaluateSource("record.ORDER_NO", ctx)).toThrow(/source is not an array/);
    expect(() => evaluateSource("record.", ctx)).toThrow(ExpressionError);
  });
});

describe("usesPageVars", () => {
  it("detects page-dependent variables as whole words only", () => {
    expect(usesPageVars("{{ page }} / {{ total }}")).toBe(true);
    expect(usesPageVars("{{ sum(pageRows, 'Q') }}")).toBe(true);
    expect(usesPageVars("{{ row.pages }} {{ copyright }}")).toBe(false);
    expect(usesPageVars("plain")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- expression-phase2`
Expected: FAIL — `avg` 미등록(`ExpressionError`), `../expression/source` 없음.

- [ ] **Step 3: engine.ts 수정**

`packages/core/src/expression/engine.ts`에서:

(a) `createJexl()` 안 `j.addFunction("count", …)` 다음에 추가:
```ts
  j.addFunction("avg", (rows: unknown, field: string) => { const ns = numericValues(rows, field); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null; });
  j.addFunction("min", (rows: unknown, field: string) => { const ns = numericValues(rows, field); return ns.length ? Math.min(...ns) : null; });
  j.addFunction("max", (rows: unknown, field: string) => { const ns = numericValues(rows, field); return ns.length ? Math.max(...ns) : null; });
```

(b) `function toNumber` 아래에 추가:
```ts
/** 숫자로 볼 수 있는 값만 모은다. null·undefined·빈 문자열·불리언·NaN 문자열은 건너뛴다 (sum과 달리 0으로 세지 않는다) */
function numericValues(rows: unknown, field: string): number[] {
  if (!Array.isArray(rows)) return [];
  const key = checkKey(field) as string;
  const out: number[] = [];
  for (const r of rows) {
    const v = (r as Record<string, unknown> | null | undefined)?.[key];
    if (v === null || v === undefined || v === "" || typeof v === "boolean") continue;
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
```

(c) `const engine = createJexl();` 아래에 캐시를 두고 `evaluate`를 바꾼다:
```ts
type Compiled = ReturnType<JexlInstance["compile"]>;
const MAX_CACHE = 2000;
/** 표현식 문자열 → guardAst를 거친 컴파일 결과. jexl Expression은 AST를 한 번만 만들고 재사용하므로 행 1만 건도 파싱은 한 번이다 */
const compiled = new Map<string, Compiled>();

function compileCached(expression: string): Compiled {
  let c = compiled.get(expression);
  if (!c) {
    c = engine.compile(expression);   // 구문 오류를 확실히 던지게 한다
    guardAst(c._getAst());            // 금지 노드는 여기서 던지고, 필터 키 검사는 AST에 남는다
    if (compiled.size >= MAX_CACHE) compiled.clear();
    compiled.set(expression, c);
  }
  return c;
}

export function evaluate(expression: string, context: DataContext): unknown {
  const code = expression.replace(STRING_LITERAL_RE, "''");   // 문자열 리터럴 안의 단어는 식별자가 아니다
  const unboundGlobal = [...code.matchAll(FORBIDDEN_ROOT_RE)].some((m) => !Object.hasOwn(context, m[2]));
  if (FORBIDDEN_KEY_RE.test(code) || unboundGlobal) {
    throw new ExpressionError(expression, "forbidden identifier");
  }
  let result: unknown;
  try {
    result = compileCached(expression).evalSync(context);
  } catch (e) {
    throw new ExpressionError(expression, e);
  }
  if (isForbiddenResult(result)) throw new ExpressionError(expression, "forbidden value");
  return result;
}
```
(기존 `evaluate` 본문의 `engine.compile`·`guardAst`·`evalSync` 세 줄이 `compileCached(...).evalSync`로 바뀐 것 외에는 같다. `guardAst`가 실패한 표현식은 캐시에 들어가지 않으므로 다음 호출도 같은 오류를 낸다.)

- [ ] **Step 4: source.ts 작성**

`packages/core/src/expression/source.ts`:
```ts
import { evaluate, ExpressionError, type DataContext } from "./engine";

/** 소스 표현식(table.source, repeater.source, repeat.source)을 평가해 배열로 돌려준다. null·undefined → []. 배열이 아니면 오류 */
export function evaluateSource(expr: string, ctx: DataContext): unknown[] {
  const v = evaluate(expr, ctx);
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new ExpressionError(expr, "source is not an array");
  return v;
}

/** 페이지 조립 시점에만 정해지는 변수. 이를 참조하지 않는 셀·항목은 조각 생성 시 값을 캐시할 수 있다 */
export const PAGE_VARS_RE = /\b(page|total|sheet|sheets|copy|copies|pageRows)\b/;
export function usesPageVars(template: string): boolean { return PAGE_VARS_RE.test(template); }
```

`packages/core/src/index.ts`에 `export * from "./expression/source";`를 `./expression/template` 줄 다음에 추가한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm --filter @daport/core typecheck`
Expected: PASS (1단계 `expression.test.ts`의 보안 테스트 포함).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/expression/engine.ts packages/core/src/expression/source.ts packages/core/src/index.ts packages/core/src/__tests__/expression-phase2.test.ts
git commit -m "feat(core): avg/min/max 함수, 표현식 컴파일 캐시, 소스 표현식 평가"
```

---

### Task 5: core 필드 추론

**Files:**
- Create: `packages/core/src/data/infer.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./data/infer"`)
- Test: `packages/core/src/__tests__/infer.test.ts`

**Interfaces:**
- Produces: `FieldType`, `FieldNode`, `inferFields(rows, { sampleSize = 200, maxDepth = 5 })`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/infer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { inferFields } from "../data/infer";

describe("inferFields", () => {
  it("unions keys of the first rows in first-seen order and types primitives, dates, objects and arrays", () => {
    const f = inferFields([
      { NO: "A-1", QTY: 3, OK: true, DT: "2026-09-17", TS: "2026-09-17T05:02:00.000Z", D: new Date(0), NOTE: null, meta: { a: 1 }, items: [{ n: 1 }, { n: 2, m: "x" }] },
      { NO: "A-2", EXTRA: 1 },
    ]);
    expect(f.map((n) => [n.name, n.type])).toEqual([
      ["NO", "string"], ["QTY", "number"], ["OK", "boolean"], ["DT", "date"], ["TS", "date"], ["D", "date"], ["NOTE", "null"],
      ["meta", "object"], ["items", "array"], ["EXTRA", "number"],
    ]);
    expect(f.find((n) => n.name === "meta")?.children).toEqual([{ name: "a", path: "meta.a", type: "number" }]);
    expect(f.find((n) => n.name === "items")?.children).toEqual([{ name: "n", path: "items.n", type: "number" }, { name: "m", path: "items.m", type: "string" }]);
  });
  it("picks the most common non-null type, string on a tie", () => {
    expect(inferFields([{ v: 1 }, { v: null }, { v: 2 }, { v: "x" }])[0].type).toBe("number");
    expect(inferFields([{ v: 1 }, { v: "x" }])[0].type).toBe("string");
    expect(inferFields([{ v: null }, { v: undefined }])[0].type).toBe("null");
  });
  it("only looks at sampleSize rows and stops at maxDepth", () => {
    expect(inferFields([{ a: 1 }, { b: 2 }], { sampleSize: 1 }).map((n) => n.name)).toEqual(["a"]);
    const deep = inferFields([{ l1: { l2: { l3: 1 } } }], { maxDepth: 1 });
    expect(deep[0].children?.[0]).toEqual({ name: "l2", path: "l1.l2", type: "object" });   // children 없음
  });
  it("accepts a single object and returns [] for non-objects", () => {
    expect(inferFields({ a: 1 })).toEqual([{ name: "a", path: "a", type: "number" }]);
    expect(inferFields("x")).toEqual([]);
    expect(inferFields([1, 2])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- infer`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/core/src/data/infer.ts`:
```ts
export type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
export type FieldNode = { name: string; path: string; type: FieldType; children?: FieldNode[] };

/** ISO 8601 날짜·일시 (2026-09-17, 2026-09-17T05:02:00Z, 2026-09-17 05:02:00+09:00 등) */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

function typeOf(v: unknown): FieldType {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Date) return "date";
  switch (typeof v) {
    case "number": return "number";
    case "boolean": return "boolean";
    case "string": return DATE_RE.test(v) ? "date" : "string";
    case "object": return "object";
    default: return "string";
  }
}

/** null이 아닌 가장 흔한 타입. 동률이면 string. 전부 null이면 null */
function pickType(counts: Map<FieldType, number>): FieldType {
  let best: FieldType | null = null, bestN = -1, tie = false;
  for (const [t, n] of counts) {
    if (t === "null") continue;
    if (n > bestN) { best = t; bestN = n; tie = false; }
    else if (n === bestN) tie = true;
  }
  if (best === null) return "null";
  return tie ? "string" : best;
}

function inferObjects(objs: Record<string, unknown>[], prefix: string, depth: number, maxDepth: number): FieldNode[] {
  const order: string[] = [];
  const counts = new Map<string, Map<FieldType, number>>();
  const nested = new Map<string, unknown[]>();     // object·array 값 (하위 필드 추론용)
  for (const o of objs) {
    for (const [k, v] of Object.entries(o)) {
      if (!counts.has(k)) { order.push(k); counts.set(k, new Map()); nested.set(k, []); }
      const t = typeOf(v);
      const c = counts.get(k)!;
      c.set(t, (c.get(t) ?? 0) + 1);
      if (t === "object" || t === "array") nested.get(k)!.push(v);
    }
  }
  return order.map((name) => {
    const type = pickType(counts.get(name)!);
    const path = prefix ? `${prefix}.${name}` : name;
    const node: FieldNode = { name, path, type };
    if (depth < maxDepth) {
      const vals = nested.get(name)!;
      if (type === "object") node.children = inferObjects(vals.filter(isObject), path, depth + 1, maxDepth);
      if (type === "array") node.children = inferObjects(vals.flatMap((a) => (Array.isArray(a) ? a.filter(isObject) : [])), path, depth + 1, maxDepth);
    }
    return node;
  });
}

/**
 * 행 배열(또는 객체 하나)의 앞 sampleSize행에서 필드 트리를 추론한다. 순수 함수.
 * 키는 처음 본 순서, 타입은 null이 아닌 가장 흔한 타입(동률이면 string). object·array는 깊이 maxDepth까지 하위 필드를 가진다
 */
export function inferFields(rows: unknown, opts: { sampleSize?: number; maxDepth?: number } = {}): FieldNode[] {
  const { sampleSize = 200, maxDepth = 5 } = opts;
  const list = Array.isArray(rows) ? rows.slice(0, sampleSize) : isObject(rows) ? [rows] : [];
  return inferObjects(list.filter(isObject), "", 0, maxDepth);
}
```

`packages/core/src/index.ts`에 `export * from "./data/infer";`를 마지막 줄에 추가한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm --filter @daport/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/data/infer.ts packages/core/src/index.ts packages/core/src/__tests__/infer.test.ts
git commit -m "feat(core): 샘플 행에서 필드 트리 추론"
```

---
### Task 6: renderer 흐름 타입, 측정 캐시, 한도 오류, Page 필드 추가

**Files:**
- Modify: `packages/renderer/src/layout/types.ts`
- Create: `packages/renderer/src/layout/errors.ts`, `packages/renderer/src/text/cache.ts`, `packages/renderer/src/flow/types.ts`
- Modify: `packages/renderer/src/layout/layout.ts` (반환 페이지에 `copyIndex: 0, pageInCopy: 0`만 추가)
- Modify: `packages/renderer/src/index.ts` (재export)
- Test: `packages/renderer/src/__tests__/cache.test.ts`; 골든 스냅샷 갱신

**Interfaces:**
- Consumes: 1단계 `wrapText`, `Style`, `PlacedItem`.
- Produces: `PlacedBase`의 `instance? clipped? role? overflow?`, `Page.copyIndex`, `Page.pageInCopy`; `LayoutLimitError`, `MAX_PAGES`; `MeasureCache`, `createMeasureCache`; `Region`, `BlockKind`, `PageFlowContext`, `Block`, `FlowInput`, `FlowPlacement`, `FlowPage`, `FlowOptions`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/renderer/src/__tests__/cache.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import * as measure from "../text/measure";
import { createMeasureCache } from "../text/cache";
import { LayoutLimitError, MAX_PAGES } from "../layout/errors";

describe("createMeasureCache", () => {
  it("returns wrapText's result and calls wrapText once per distinct (text,size,bold,width)", () => {
    const spy = vi.spyOn(measure, "wrapText");
    const c = createMeasureCache();
    const a = c.wrap("가나다 라마바", 10, false, 20);
    expect(a).toEqual(measure.wrapText("가나다 라마바", 10, false, 20));
    c.wrap("가나다 라마바", 10, false, 20);
    c.wrap("가나다 라마바", 10, true, 20);
    c.wrap("가나다 라마바", 10, false, 21);
    expect(spy.mock.calls.length).toBe(4);   // 위 직접 호출 1 + 캐시 미스 3
    spy.mockRestore();
  });
  it("does not share entries between caches", () => {
    const spy = vi.spyOn(measure, "wrapText");
    createMeasureCache().wrap("x", 10, false, 10);
    createMeasureCache().wrap("x", 10, false, 10);
    expect(spy.mock.calls.length).toBe(2);
    spy.mockRestore();
  });
});

describe("LayoutLimitError", () => {
  it("has code LAYOUT_LIMIT and a default limit of 2000 pages", () => {
    const e = new LayoutLimitError(2001);
    expect(e.code).toBe("LAYOUT_LIMIT");
    expect(e.message).toContain("2001");
    expect(e).toBeInstanceOf(Error);
    expect(MAX_PAGES).toBe(2000);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/renderer test -- cache`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 타입·오류·캐시 작성**

`packages/renderer/src/layout/types.ts` 전체:
```ts
import type { Style } from "@daport/core";

type PlacedBase = {
  elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string;
  /** 반복으로 생긴 항목의 인스턴스 경로. 예 "cards#3", "t1#12", 중첩 "cards#3/t2#0". 템플릿 요소 id는 elementId에 남는다 */
  instance?: string;
  /** clip으로 잘린 흐름 요소의 flowBox에 표시 */
  clipped?: boolean;
  /** flowBox: 표·반복 영역 전체 영역(선택·히트용). cell: 표 셀 텍스트. border: 표 테두리. template: 반복 영역 첫 항목 자리 */
  role?: "flowBox" | "cell" | "border" | "template";
  /** 빈 페이지보다 큰 조각을 잘라 단독 배치했을 때 flowBox에 표시 */
  overflow?: boolean;
};

export type PlacedText = PlacedBase & { kind: "text"; lines: string[]; lineHeight: number; overflow: boolean };
export type PlacedImage = PlacedBase & { kind: "image"; src: string; fit: "contain" | "cover" | "stretch" };
export type PlacedLine = PlacedBase & { kind: "line"; x2: number; y2: number };
export type PlacedRect = PlacedBase & { kind: "rect" };
export type PlacedPlaceholder = PlacedBase & { kind: "placeholder"; label: string };

export type PlacedItem = PlacedText | PlacedImage | PlacedLine | PlacedRect | PlacedPlaceholder;

/** index는 전체 문서 기준(0부터). copyIndex는 몇 번째 부(0부터, repeat 없으면 0), pageInCopy는 부 안의 페이지(0부터) */
export type Page = { index: number; width: number; height: number; items: PlacedItem[]; copyIndex: number; pageInCopy: number };
```

`packages/renderer/src/layout/errors.ts`:
```ts
export const MAX_PAGES = 2000;

/** 전체 페이지 수가 상한을 넘었다. 라우트는 400 { code: "LAYOUT_LIMIT" }로 바꾼다 */
export class LayoutLimitError extends Error {
  readonly code = "LAYOUT_LIMIT";
  constructor(pages: number, limit: number = MAX_PAGES) {
    super(`layout produced ${pages} pages, more than the limit of ${limit}`);
    this.name = "LayoutLimitError";
  }
}
```

`packages/renderer/src/text/cache.ts`:
```ts
import { wrapText } from "./measure";

export type MeasureCache = { wrap(text: string, fontSize: number, bold: boolean, width: number): string[] };

/** 줄바꿈 결과를 (text, fontSize, bold, width)로 캐시한다. layout() 호출마다 새로 만들어 호출 사이에 메모리를 붙들지 않는다 */
export function createMeasureCache(): MeasureCache {
  const map = new Map<string, string[]>();
  return {
    wrap(text, fontSize, bold, width) {
      const key = `${fontSize}|${bold ? 1 : 0}|${width}|${text}`;
      let lines = map.get(key);
      if (!lines) { lines = wrapText(text, fontSize, bold, width); map.set(key, lines); }
      return lines;
    },
  };
}
```

`packages/renderer/src/flow/types.ts`:
```ts
import type { PlacedItem } from "../layout/types";
import type { MeasureCache } from "../text/cache";

export type Region = { x: number; y: number; w: number; h: number };
export type BlockKind = "header" | "row" | "groupHeader" | "groupFooter" | "pageFooter" | "footer";
/** 페이지 조립 시점에 정해지는 값. paint가 받는다 */
export type PageFlowContext = { page: number; total: number; sheet: number; sheets: number; copy: number; copies: number; pageRows: unknown[] };
export type Block = {
  kind: BlockKind;
  height: number;                 // mm. 조각 생성 시 확정
  keepWithNext: boolean;          // 그룹 머리: 다음 조각과 같은 페이지에 둔다
  rows: unknown[];                // 이 조각이 담은 데이터 행(pageRows 계산용). 머리·소계는 []
  paint(origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[];
};
export type FlowInput = { header?: Block; pageFooter?: Block; body: Block[]; footer?: Block };
export type FlowPlacement = { block: Block; y: number; overflow: boolean };   // y는 영역 상단 기준
export type FlowPage = { placements: FlowPlacement[]; pageRows: unknown[]; overflow: boolean; truncated: boolean };
export type FlowOptions = { measure: MeasureCache; onExpressionError: "blank" | "fail"; instancePrefix?: string };
```

`packages/renderer/src/layout/layout.ts`의 마지막 줄을 바꾼다:
```ts
  return [{ index: 0, width: report.page.width, height: report.page.height, items, copyIndex: 0, pageInCopy: 0 }];
```

`packages/renderer/src/index.ts`에 추가:
```ts
export * from "./layout/errors";
export * from "./text/cache";
export * from "./flow/types";
```

- [ ] **Step 4: 통과 확인과 스냅샷 갱신**

Run: `pnpm --filter @daport/renderer test -- -u && pnpm --filter @daport/renderer test && pnpm typecheck`
Expected: PASS. `git diff packages/renderer/src/__tests__/__snapshots__/golden.test.ts.snap`에 `"copyIndex": 0`·`"pageInCopy": 0` 두 줄만 추가돼야 한다(다른 변화가 있으면 되돌리고 원인을 찾는다).

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src
git commit -m "feat(renderer): 흐름 엔진 타입, 줄바꿈 측정 캐시, 페이지 상한 오류, Page 부·페이지 번호 필드"
```

---

### Task 7: renderer paginate와 불변식 테스트

**Files:**
- Create: `packages/renderer/src/flow/paginate.ts`
- Modify: `packages/renderer/src/index.ts` (`export * from "./flow/paginate"`)
- Test: `packages/renderer/src/__tests__/paginate.test.ts`, `packages/renderer/src/__tests__/paginate.property.test.ts`

**Interfaces:**
- Consumes: T6 `Block`, `FlowInput`, `FlowPage`, `Region`.
- Produces: `paginate(input, { first, next, repeatHeader, clip }): FlowPage[]`.

- [ ] **Step 1: 단위 테스트 작성**

`packages/renderer/src/__tests__/paginate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { paginate } from "../flow/paginate";
import type { Block, BlockKind } from "../flow/types";

const blk = (kind: BlockKind, height: number, extra: Partial<Block> = {}): Block =>
  ({ kind, height, keepWithNext: false, rows: kind === "row" ? [{ h: height }] : [], paint: () => [], ...extra });
const rows = (...hs: number[]) => hs.map((h) => blk("row", h));
const first = { x: 0, y: 50, w: 100, h: 40 }, next = { x: 0, y: 50, w: 100, h: 60 };
const kinds = (p: { placements: { block: Block }[] }) => p.placements.map((x) => x.block.kind);

describe("paginate", () => {
  it("stacks rows and moves to the next region when the remaining height is short", () => {
    const pages = paginate({ body: rows(10, 10, 10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: false });
    expect(pages).toHaveLength(2);
    expect(pages[0].placements.map((p) => p.y)).toEqual([0, 10, 20, 30]);
    expect(pages[1].placements.map((p) => p.y)).toEqual([0, 10]);
    expect(pages[0].pageRows).toEqual([{ h: 10 }, { h: 10 }, { h: 10 }, { h: 10 }]);
  });
  it("puts the header first on page 1 and, with repeatHeader, on every page", () => {
    const header = blk("header", 7);
    const pages = paginate({ header, body: rows(10, 10, 10, 10, 10) }, { first, next, repeatHeader: true, clip: false });
    expect(pages.map(kinds)).toEqual([["header", "row", "row", "row"], ["header", "row", "row"]]);
    const once = paginate({ header, body: rows(10, 10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: false });
    expect(kinds(once[1])[0]).toBe("row");
  });
  it("reserves the page footer at the bottom of each page and paints it with that page's rows", () => {
    const pageFooter = blk("pageFooter", 8);
    const pages = paginate({ pageFooter, body: rows(10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: false });
    expect(pages).toHaveLength(2);                                   // 40 - 8 = 32 → 3행
    expect(pages[0].placements.at(-1)).toMatchObject({ block: pageFooter, y: 32 });
    expect(pages[0].pageRows).toHaveLength(3);
    expect(pages[1].placements.at(-1)).toMatchObject({ block: pageFooter, y: 52 });
  });
  it("keeps a keepWithNext block with the following block, moving both to the next page", () => {
    const gh = blk("groupHeader", 8, { keepWithNext: true });
    const pages = paginate({ body: [...rows(10, 10, 10), gh, ...rows(10)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["row", "row", "row"], ["groupHeader", "row"]]);
  });
  it("keeps a chain of nested group headers together", () => {
    const outer = blk("groupHeader", 8, { keepWithNext: true }), inner = blk("groupHeader", 8, { keepWithNext: true });
    const pages = paginate({ body: [...rows(10, 10), outer, inner, ...rows(10)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["row", "row"], ["groupHeader", "groupHeader", "row"]]);
  });
  it("unbundles a chain that cannot fit even an empty page", () => {
    const gh = blk("groupHeader", 30, { keepWithNext: true });
    const pages = paginate({ body: [gh, blk("row", 40)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["groupHeader"], ["row"]]);
    expect(pages[0].placements[0].overflow).toBe(false);
  });
  it("places a block taller than an empty page alone and marks overflow", () => {
    const pages = paginate({ body: [...rows(10), blk("row", 100), ...rows(10)] }, { first, next, repeatHeader: false, clip: false });
    expect(pages.map(kinds)).toEqual([["row"], ["row"], ["row"]]);
    expect(pages[1].placements[0].overflow).toBe(true);
    expect(pages[1].overflow).toBe(true);
    expect(pages[0].overflow).toBe(false);
  });
  it("puts the footer after the last row, on a new page when there is no room", () => {
    const footer = blk("footer", 10);
    const fits = paginate({ body: rows(10, 10), footer }, { first, next, repeatHeader: false, clip: false });
    expect(fits.map(kinds)).toEqual([["row", "row", "footer"]]);
    const spills = paginate({ body: rows(10, 10, 10, 10), footer }, { first, next, repeatHeader: false, clip: false });
    expect(spills.map(kinds)).toEqual([["row", "row", "row", "row"], ["footer"]]);
  });
  it("clip keeps only the first region's blocks and marks truncated", () => {
    const pages = paginate({ body: rows(10, 10, 10, 10, 10, 10) }, { first, next, repeatHeader: false, clip: true });
    expect(pages).toHaveLength(1);
    expect(pages[0].placements).toHaveLength(4);
    expect(pages[0].truncated).toBe(true);
    expect(paginate({ body: rows(10) }, { first, next, repeatHeader: false, clip: true })[0].truncated).toBe(false);
  });
  it("produces one page for an empty body (header and page footer only)", () => {
    const pages = paginate({ header: blk("header", 7), pageFooter: blk("pageFooter", 5), body: [] }, { first, next, repeatHeader: true, clip: false });
    expect(pages).toHaveLength(1);
    expect(kinds(pages[0])).toEqual(["header", "pageFooter"]);
    expect(paginate({ body: [] }, { first, next, repeatHeader: false, clip: false })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 속성 기반 불변식 테스트 작성**

`packages/renderer/src/__tests__/paginate.property.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { paginate } from "../flow/paginate";
import type { Block, FlowInput } from "../flow/types";

/** 시드 고정 PRNG (mulberry32). 실패한 반복의 seed를 메시지에 남겨 재현한다 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const EPS = 1e-6;

type Gen = { input: FlowInput; first: { x: number; y: number; w: number; h: number }; next: { x: number; y: number; w: number; h: number }; repeatHeader: boolean };

function generate(seed: number): Gen {
  const r = rng(seed);
  const body: Block[] = [];
  const n = int(r, 0, 60);
  let rowNo = 0;
  for (let i = 0; i < n; i++) {
    const kind = r() < 0.2 ? "groupHeader" : r() < 0.1 ? "groupFooter" : "row";
    const height = int(r, 1, 30);
    body.push({ kind, height, keepWithNext: kind === "groupHeader" && r() < 0.8, rows: kind === "row" ? [{ no: rowNo++ }] : [], paint: () => [] });
  }
  const header = r() < 0.6 ? { kind: "header" as const, height: int(r, 3, 12), keepWithNext: false, rows: [], paint: () => [] } : undefined;
  const pageFooter = r() < 0.4 ? { kind: "pageFooter" as const, height: int(r, 3, 10), keepWithNext: false, rows: [], paint: () => [] } : undefined;
  const footer = r() < 0.4 ? { kind: "footer" as const, height: int(r, 3, 15), keepWithNext: false, rows: [], paint: () => [] } : undefined;
  return {
    input: { header, pageFooter, body, footer },
    first: { x: 0, y: 0, w: 100, h: int(r, 15, 120) },
    next: { x: 0, y: 0, w: 100, h: int(r, 40, 120) },
    repeatHeader: r() < 0.5,
  };
}

describe("paginate invariants", () => {
  it("hold for 300 seeded random inputs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const g = generate(seed);
      const pages = paginate(g.input, { first: g.first, next: g.next, repeatHeader: g.repeatHeader, clip: false });
      const msg = `seed ${seed}`;
      const footerH = g.input.pageFooter?.height ?? 0;
      const freshAvail = g.next.h - footerH - (g.repeatHeader && g.input.header ? g.input.header.height : 0);

      // 1. 모든 본문 조각이 정확히 한 번, 원래 순서대로
      const placedBody = pages.flatMap((p) => p.placements.map((x) => x.block)).filter((b) => b.kind !== "header" && b.kind !== "pageFooter");
      const expected = g.input.footer ? [...g.input.body, g.input.footer] : g.input.body;
      expect(placedBody, msg).toEqual(expected);

      pages.forEach((p, pi) => {
        const region = pi === 0 ? g.first : g.next;
        // 2. 조각이 영역 하단(페이지 소계 예약분 제외)을 넘지 않는다. overflow 표시된 조각만 예외
        for (const pl of p.placements) {
          if (pl.block.kind === "pageFooter") { expect(pl.y, msg).toBeCloseTo(region.h - footerH); continue; }
          if (!pl.overflow) expect(pl.y + pl.block.height, msg).toBeLessThanOrEqual(region.h - footerH + EPS);
          else expect(pl.block.height, msg).toBeGreaterThan(freshAvail - EPS);   // overflow는 빈 페이지에도 안 들어갈 때만
        }
        // 3. 머리행은 첫 페이지 맨 위, repeatHeader면 모든 페이지 맨 위
        if (g.input.header && (pi === 0 || g.repeatHeader)) expect(p.placements[0]?.block, msg).toBe(g.input.header);
        if (g.input.header && !g.repeatHeader && pi > 0) expect(p.placements.some((x) => x.block === g.input.header), msg).toBe(false);
        // 4. keepWithNext 조각이 페이지의 마지막 본문 조각이 아니다 (묶음이 빈 페이지에도 안 들어가는 경우만 예외)
        const bodyPl = p.placements.filter((x) => x.block.kind !== "header" && x.block.kind !== "pageFooter");
        const last = bodyPl.at(-1);
        if (last?.block.keepWithNext && last.block !== expected.at(-1)) {
          const i = expected.indexOf(last.block);
          let j = i, need = 0;
          while (j < expected.length && expected[j].keepWithNext) { need += expected[j].height; j++; }
          if (j < expected.length) need += expected[j].height;
          expect(need, msg).toBeGreaterThan(freshAvail - EPS);
        }
        // 5. pageRows = 이 페이지 row 조각들의 행 합집합
        expect(p.pageRows, msg).toEqual(bodyPl.flatMap((x) => x.block.rows));
      });
      // 6. 페이지 수 상한: 조각마다 한 페이지 이상 쓰지 않는다 (첫 영역이 작아 비는 첫 페이지 하나만 예외)
      expect(pages.length, msg).toBeLessThanOrEqual(Math.max(1, expected.length) + 1);
    }
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/renderer test -- paginate`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: paginate 구현**

`packages/renderer/src/flow/paginate.ts`:
```ts
import type { FlowInput, FlowPage, FlowPlacement, Region } from "./types";

const EPS = 1e-6;

/**
 * 조각을 영역에 차례로 나눠 담는다 (스펙 5.2).
 * 1. header는 첫 페이지 맨 위, repeatHeader면 모든 페이지 맨 위.
 * 2. pageFooter가 있으면 페이지 하단에 그 높이를 예약하고 마지막에 놓는다.
 * 3. 남은 높이보다 큰 조각은 다음 페이지로.
 * 4. keepWithNext 조각은 바로 뒤 조각(연쇄 포함)과 함께 옮긴다. 묶음이 빈 페이지에도 안 들어가면 푼다.
 * 5. 조각 하나가 빈 페이지보다 크면 단독 배치하고 overflow를 표시한다(무한 페이지 방지).
 * 6. clip이면 첫 영역에 들어가는 조각까지만 두고 truncated를 표시한다.
 * 7. footer는 본문 마지막 조각으로 취급한다(자리가 없으면 새 페이지).
 */
export function paginate(input: FlowInput, opts: { first: Region; next: Region; repeatHeader: boolean; clip: boolean }): FlowPage[] {
  const { header, pageFooter } = input;
  const body = input.footer ? [...input.body, input.footer] : input.body;
  const footerH = pageFooter?.height ?? 0;
  // 빈 이어지는 페이지에 본문 조각을 놓을 수 있는 높이. 묶음·조각이 여기에도 안 들어가면 규칙 4의 풀기·규칙 5의 잘림이 된다
  const freshAvail = opts.next.h - footerH - (opts.repeatHeader && header ? header.height : 0);
  const pages: FlowPage[] = [];
  let i = 0;
  while (i < body.length || pages.length === 0) {
    const region = pages.length === 0 ? opts.first : opts.next;
    const placements: FlowPlacement[] = [];
    let y = 0;
    if (header && (pages.length === 0 || opts.repeatHeader)) { placements.push({ block: header, y: 0, overflow: false }); y = header.height; }
    const headerCount = placements.length;
    const avail = region.h - footerH;
    let pageOverflow = false;
    while (i < body.length) {
      const b = body[i];
      // keepWithNext 연쇄: b부터 keepWithNext가 아닌 첫 조각까지 한 묶음
      let j = i, need = b.height;
      while (body[j].keepWithNext && j + 1 < body.length) { j++; need += body[j].height; }
      const room = avail - y;
      if (need <= room + EPS) {
        for (let k = i; k <= j; k++) { placements.push({ block: body[k], y, overflow: false }); y += body[k].height; }
        i = j + 1;
        continue;
      }
      if (j > i && need <= freshAvail + EPS) break;                       // 규칙 4: 묶음째 다음 페이지로
      // 묶음이 빈 페이지에도 안 들어가면 풀고 b 하나만 본다
      const empty = placements.length === headerCount;
      if (b.height <= room + EPS) { placements.push({ block: b, y, overflow: false }); y += b.height; i++; continue; }
      if (!empty) break;                                                   // 규칙 3: 다음 페이지로
      if (pages.length === 0 && b.height <= freshAvail + EPS) break;       // 첫 영역만 작은 것이면 다음 페이지로 (첫 페이지는 비어 있어도 된다)
      placements.push({ block: b, y, overflow: true });                    // 규칙 5: 빈 페이지보다 큰 조각은 단독 배치
      y += b.height; pageOverflow = true; i++;
    }
    const pageRows = placements.flatMap((p) => p.block.rows);
    if (pageFooter) placements.push({ block: pageFooter, y: region.h - footerH, overflow: false });
    const truncated = opts.clip && i < body.length;
    pages.push({ placements, pageRows, overflow: pageOverflow, truncated });
    if (truncated) break;
  }
  return pages;
}
```

`packages/renderer/src/index.ts`에 `export * from "./flow/paginate";`를 추가한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/renderer test -- paginate && pnpm --filter @daport/renderer typecheck`
Expected: 단위 10개·불변식 1개 PASS. 불변식이 실패하면 메시지의 seed로 `generate(seed)`를 재현해 고친다.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/flow/paginate.ts packages/renderer/src/index.ts packages/renderer/src/__tests__/paginate.test.ts packages/renderer/src/__tests__/paginate.property.test.ts
git commit -m "feat(renderer): 공용 페이지 나누기 paginate와 시드 고정 불변식 테스트"
```

---

### Task 8: datasource 패키지와 executeDatasets (static·요청 data)

**Files:**
- Create: `packages/datasource/package.json`, `packages/datasource/tsconfig.json`, `packages/datasource/src/index.ts`, `packages/datasource/src/types.ts`, `packages/datasource/src/execute.ts`, `packages/datasource/src/secrets.ts`
- Test: `packages/datasource/src/__tests__/execute.test.ts`, `packages/datasource/src/__tests__/secrets.test.ts`

**Interfaces:**
- Consumes: core `Report`, `DataContext`, `resolveParams`, `rowsProxy`, `FieldType`.
- Produces: 공용 규약의 `types.ts` 전부, `executeDatasets`, `toRows`, `envSecrets`. http·sql 분기는 이 태스크에서 "커넥터 미설정" 실패만 낸다(T9·T12가 채운다).

- [ ] **Step 1: 패키지 골격**

`packages/datasource/package.json`:
```json
{
  "name": "@daport/datasource",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@daport/core": "workspace:*"
  }
}
```

`packages/datasource/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Run: `pnpm install` (워크스페이스 링크 생성).

- [ ] **Step 2: 실패 테스트 작성**

`packages/datasource/src/__tests__/execute.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { executeDatasets, toRows, DatasetFailure } from "../index";

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 },
  params: [{ name: "no", type: "string", required: true }, { name: "qty", type: "number", default: "3" }],
  datasets: [
    { name: "cert", type: "static", rows: [{ A: 1 }] },
    { name: "items", type: "static", rows: [{ A: 2 }, { A: 3 }] },
    { name: "orders", type: "http", url: "https://mes.example.com/x" },
    { name: "lines", type: "sql", connection: "mes", query: "SELECT 1" },
  ]});
const run = (opts: Partial<Parameters<typeof executeDatasets>[1]> = {}) =>
  executeDatasets(report, { params: { no: "A" }, connectors: {}, secrets: () => undefined, ...opts });

describe("executeDatasets", () => {
  it("normalizes params, loads static rows as rowsProxy arrays and reports unconfigured http/sql as errors", async () => {
    const { context, errors } = await run();
    expect(context.params).toEqual({ no: "A", qty: 3 });
    expect((context.cert as { A: number }).A).toBe(1);               // ds.FIELD
    expect((context.items as unknown[]).length).toBe(2);
    expect(errors.map((e) => [e.dataset, e.code])).toEqual([["orders", "HOST_NOT_ALLOWED"], ["lines", "SQL_NOT_CONFIGURED"]]);
    expect(context.orders).toBeUndefined();
  });
  it("prefers request data over dataset definitions and includes data-only names", async () => {
    const { context, errors } = await run({ data: { items: [{ A: 9 }], orders: { id: 1 }, lines: [], extra: [{ X: 1 }] } });
    expect(errors).toEqual([]);
    expect((context.items as { A: number }[]).map((r) => r.A)).toEqual([9]);
    expect(context.orders).toEqual([{ id: 1 }]);                      // 객체는 [객체]
    expect((context.extra as { X: number }).X).toBe(1);
  });
  it("throws on a missing required param (the caller answers 400)", async () => {
    await expect(run({ params: {} })).rejects.toThrow(/missing required param: no/);
  });
  it("rejects data whose rows are not objects with BAD_DATA and keeps going", async () => {
    const { context, errors } = await run({ data: { items: [1, 2], orders: "x", lines: [] } });
    expect(errors.map((e) => [e.dataset, e.code])).toEqual([["items", "BAD_DATA"], ["orders", "BAD_DATA"]]);
    expect(context.items).toBeUndefined();
    expect(context.lines).toEqual([]);
  });
  it("applies limits.maxRows to request data too", async () => {
    const { errors } = await run({ data: { items: [{ A: 1 }, { A: 2 }], orders: [], lines: [] }, limits: { maxRows: 1 } });
    expect(errors).toEqual([{ dataset: "items", code: "TOO_MANY_ROWS", message: "2 rows, more than the limit of 1" }]);
  });
});

describe("toRows", () => {
  it("wraps an object, keeps an object array, rejects the rest", () => {
    expect(toRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    for (const bad of [null, 1, "s", [1], [{ a: 1 }, null], undefined]) expect(() => toRows(bad)).toThrow(DatasetFailure);
  });
});
```

`packages/datasource/src/__tests__/secrets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { envSecrets } from "../secrets";

describe("envSecrets", () => {
  it("reads DAPORT_SECRET_<NAME> only for upper-case names", () => {
    const s = envSecrets({ DAPORT_SECRET_MES_TOKEN: "t0k", DAPORT_SECRET_x: "no", OTHER: "o" });
    expect(s("MES_TOKEN")).toBe("t0k");
    expect(s("x")).toBeUndefined();
    expect(s("OTHER")).toBeUndefined();
    expect(s("../etc")).toBeUndefined();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/datasource test`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 구현**

`packages/datasource/src/types.ts`:
```ts
import type { FieldType } from "@daport/core";

export type DatasetErrorCode =
  | "TIMEOUT" | "HOST_NOT_ALLOWED" | "HTTP_STATUS" | "BAD_JSON" | "ROWS_PATH" | "TOO_LARGE" | "TOO_MANY_ROWS"
  | "SQL_NOT_CONFIGURED" | "SQL_ERROR" | "BAD_DATA";
export type DatasetError = { dataset: string; code: DatasetErrorCode; message: string };

/** 데이터셋 하나의 실행 실패. executeDatasets가 errors 항목으로 바꾼다 */
export class DatasetFailure extends Error {
  constructor(readonly code: DatasetErrorCode, message: string) {
    super(message);
    this.name = "DatasetFailure";
  }
}

export type Limits = { timeoutMs: number; maxBytes: number; maxRows: number };
export const DEFAULT_LIMITS: Limits = { timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024, maxRows: 10_000 };

export type HttpRequest = { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string };
/** 파싱된 JSON을 돌려준다. 실패는 DatasetFailure */
export interface HttpConnector { request(req: HttpRequest, limits: Limits): Promise<unknown> }

/**
 * SQL 커넥터 규격. 결과는 순수 JSON(날짜는 ISO 8601 문자열, 큰 수는 문자열 허용)이어야 한다.
 * 직접 연결 구현과 공장 안 중계 에이전트가 같은 규격을 쓴다 (docs/superpowers/research/2026-09-17-oracle-connectivity.md)
 */
export interface SqlConnector {
  query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal }):
    Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }>;
}
export type Connectors = { http?: HttpConnector; sql?: Record<string, SqlConnector> };   // sql은 connection 이름별
export type SecretResolver = (name: string) => string | undefined;
```

`packages/datasource/src/secrets.ts`:
```ts
import type { SecretResolver } from "./types";

const NAME_RE = /^[A-Z0-9_]+$/;

/** `secrets.이름`은 DAPORT_SECRET_<이름> 환경변수에서만 읽는다 */
export function envSecrets(env: Record<string, string | undefined> = process.env): SecretResolver {
  return (name) => (NAME_RE.test(name) ? env[`DAPORT_SECRET_${name}`] : undefined);
}
```

`packages/datasource/src/execute.ts`:
```ts
import { resolveParams, rowsProxy, type Report, type DataContext, type Dataset } from "@daport/core";
import { DatasetFailure, DEFAULT_LIMITS, type Connectors, type DatasetError, type Limits, type SecretResolver } from "./types";

export type ExecuteOptions = {
  params: Record<string, unknown>;
  data?: Record<string, unknown>;        // 요청에 함께 온 데이터. 있으면 데이터셋 정의보다 우선
  connectors: Connectors;
  secrets: SecretResolver;
  limits?: Partial<Limits>;
};

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** 객체 → [객체], 객체 배열 → 그대로. 그 밖은 BAD_DATA (rowsProxy는 객체 행을 전제한다) */
export function toRows(value: unknown): Record<string, unknown>[] {
  if (isObject(value)) return [value];
  if (Array.isArray(value) && value.every(isObject)) return value;
  throw new DatasetFailure("BAD_DATA", "rows must be an object or an array of objects");
}

function checkRows(rows: Record<string, unknown>[], limits: Limits): Record<string, unknown>[] {
  if (rows.length > limits.maxRows) throw new DatasetFailure("TOO_MANY_ROWS", `${rows.length} rows, more than the limit of ${limits.maxRows}`);
  return rows;
}

/** 데이터셋 정의 하나를 실행한다. http·sql은 T12·T9가 채운다 */
async function runDataset(ds: Dataset, params: Record<string, unknown>, opts: ExecuteOptions, limits: Limits): Promise<Record<string, unknown>[]> {
  switch (ds.type) {
    case "static": return ds.rows;
    case "http": throw new DatasetFailure("HOST_NOT_ALLOWED", "http connector not configured");
    case "sql": throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  }
}

/** 실패 → errors 항목. 비밀값 마스킹은 T12가 http 분기에 더한다 */
function toError(dataset: string, e: unknown, fallback: DatasetError["code"]): DatasetError {
  if (e instanceof DatasetFailure) return { dataset, code: e.code, message: e.message };
  return { dataset, code: fallback, message: e instanceof Error ? e.message : String(e) };
}

/**
 * 파라미터를 정규화하고 데이터셋마다 컨텍스트 값을 만든다 (스펙 6.1).
 * 필수 파라미터 누락은 던진다(요청 오류). 데이터셋 실패는 errors에 모으고 나머지는 계속한다
 */
export async function executeDatasets(report: Report, opts: ExecuteOptions): Promise<{ context: DataContext; errors: DatasetError[] }> {
  const limits: Limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const params = resolveParams(report, opts.params);
  const context: DataContext = { params };
  const errors: DatasetError[] = [];
  const data = opts.data ?? {};
  for (const ds of report.datasets) {
    try {
      const rows = Object.hasOwn(data, ds.name) ? toRows(data[ds.name]) : await runDataset(ds, params, opts, limits);
      context[ds.name] = rowsProxy(checkRows(rows, limits));
    } catch (e) {
      errors.push(toError(ds.name, e, ds.type === "sql" ? "SQL_ERROR" : "BAD_DATA"));
    }
  }
  for (const [name, value] of Object.entries(data)) {
    if (report.datasets.some((ds) => ds.name === name)) continue;
    try { context[name] = rowsProxy(checkRows(toRows(value), limits)); }
    catch (e) { errors.push(toError(name, e, "BAD_DATA")); }
  }
  return { context, errors };
}
```

`packages/datasource/src/index.ts`:
```ts
export * from "./types";
export * from "./execute";
export * from "./secrets";
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/datasource test && pnpm --filter @daport/datasource typecheck`
Expected: PASS (`runDataset`의 `params`·`opts` 미사용 경고는 없다 — `noUnusedParameters`가 꺼져 있다).

- [ ] **Step 6: Commit**

```bash
git add packages/datasource pnpm-lock.yaml
git commit -m "feat(datasource): 패키지 골격, executeDatasets(static·요청 data 우선), 비밀값 환경변수 해석"
```

---

### Task 9: datasource SQL 커넥터 경계

**Files:**
- Create: `packages/datasource/src/sql.ts`
- Modify: `packages/datasource/src/execute.ts` (sql 분기), `packages/datasource/src/index.ts`
- Test: `packages/datasource/src/__tests__/sql.test.ts`

**Interfaces:**
- Consumes: T8 `SqlConnector`, `DatasetFailure`, `executeDatasets`.
- Produces: `extractBinds(sql, params)`, `runSql(ds, params, connectors, limits)`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/datasource/src/__tests__/sql.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { parseReport } from "@daport/core";
import { executeDatasets, extractBinds, type SqlConnector } from "../index";

describe("extractBinds", () => {
  it("returns only :names present in params, ignoring string literals and ::casts", () => {
    const sql = "SELECT * FROM T WHERE NO = :orderNo AND DT >= :from AND X = ':notABind' AND Y = :missing";
    expect(extractBinds(sql, { orderNo: "A", from: "2026-01-01", extra: 1 })).toEqual({ orderNo: "A", from: "2026-01-01" });
    expect(extractBinds("SELECT CAST(a AS b) FROM T", { a: 1 })).toEqual({});
  });
});

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 },
  params: [{ name: "orderNo", type: "string" }],
  datasets: [{ name: "lines", type: "sql", connection: "mes", query: "SELECT NO, QTY FROM LINES WHERE NO = :orderNo" }] });

describe("executeDatasets sql", () => {
  it("passes sql, binds and limits to the named connector and wraps the rows", async () => {
    const query = vi.fn<SqlConnector["query"]>().mockResolvedValue({ rows: [{ NO: "A", QTY: 2 }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }] });
    const { context, errors } = await executeDatasets(report, { params: { orderNo: "A" }, connectors: { sql: { mes: { query } } }, secrets: () => undefined, limits: { timeoutMs: 5 } });
    expect(errors).toEqual([]);
    expect(query).toHaveBeenCalledWith("SELECT NO, QTY FROM LINES WHERE NO = :orderNo", { orderNo: "A" }, expect.objectContaining({ timeoutMs: 5, maxRows: 10_000 }));
    expect((context.lines as { QTY: number }).QTY).toBe(2);
  });
  it("reports SQL_NOT_CONFIGURED without a connector for that connection", async () => {
    const { errors } = await executeDatasets(report, { params: {}, connectors: { sql: { other: { query: vi.fn() } } }, secrets: () => undefined });
    expect(errors).toEqual([{ dataset: "lines", code: "SQL_NOT_CONFIGURED", message: 'sql connection "mes" is not configured' }]);
  });
  it("reports SQL_ERROR for a connector failure and TOO_MANY_ROWS for oversized results", async () => {
    const failing: SqlConnector = { query: async () => { throw new Error("ORA-00942: table or view does not exist"); } };
    expect((await executeDatasets(report, { params: {}, connectors: { sql: { mes: failing } }, secrets: () => undefined })).errors[0])
      .toEqual({ dataset: "lines", code: "SQL_ERROR", message: "ORA-00942: table or view does not exist" });
    const big: SqlConnector = { query: async () => ({ rows: [{ a: 1 }, { a: 2 }], columns: [] }) };
    expect((await executeDatasets(report, { params: {}, connectors: { sql: { mes: big } }, secrets: () => undefined, limits: { maxRows: 1 } })).errors[0].code).toBe("TOO_MANY_ROWS");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/datasource test -- sql`
Expected: FAIL — `extractBinds` 없음.

- [ ] **Step 3: 구현**

`packages/datasource/src/sql.ts`:
```ts
import type { SqlDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type Limits } from "./types";

const STRING_LITERAL_RE = /'(?:[^']|'')*'/g;
const BIND_RE = /(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g;   // ::cast는 제외

/** 쿼리의 :이름 중 params에 있는 값만 이름으로 넘긴다. 문자열 결합은 하지 않는다 */
export function extractBinds(sql: string, params: Record<string, unknown>): Record<string, unknown> {
  const binds: Record<string, unknown> = {};
  for (const m of sql.replace(STRING_LITERAL_RE, "''").matchAll(BIND_RE)) {
    const name = m[1];
    if (Object.hasOwn(params, name)) binds[name] = params[name];
  }
  return binds;
}

export async function runSql(ds: SqlDataset, params: Record<string, unknown>, connectors: Connectors, limits: Limits): Promise<Record<string, unknown>[]> {
  const conn = connectors.sql?.[ds.connection];
  if (!conn) throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  const res = await conn.query(ds.query, extractBinds(ds.query, params), { timeoutMs: limits.timeoutMs, maxRows: limits.maxRows, signal: AbortSignal.timeout(limits.timeoutMs) });
  return res.rows;
}
```

`packages/datasource/src/execute.ts`에서 import를 추가하고 sql 분기를 바꾼다:
```ts
import { runSql } from "./sql";
// …
    case "sql": return runSql(ds, params, opts.connectors, limits);
```

`packages/datasource/src/index.ts`에 `export * from "./sql";` 추가.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/datasource test && pnpm --filter @daport/datasource typecheck`
Expected: PASS. T8의 "reports unconfigured http/sql" 테스트도 같은 메시지라 그대로 통과.

- [ ] **Step 5: Commit**

```bash
git add packages/datasource/src
git commit -m "feat(datasource): SQL 커넥터 규격, 바인드 추출, 미설정·실패 오류"
```

---
## 웨이브 2

### Task 10: renderer 표 흐름 조각 (tableFlow)

**Files:**
- Create: `packages/renderer/src/flow/groups.ts`, `packages/renderer/src/flow/table.ts`
- Modify: `packages/renderer/src/index.ts` (`export * from "./flow/groups"`, `export * from "./flow/table"`)
- Test: `packages/renderer/src/__tests__/groups.test.ts`, `packages/renderer/src/__tests__/table-flow.test.ts`

**Interfaces:**
- Consumes: T1 `TableElement`, `TableCell`, `mergeStyle`, `StyleSchema`; T4 `evaluateSource`, `usesPageVars`, `evaluate`, `interpolate`, `ExpressionError`; T6 `Block`, `FlowInput`, `FlowOptions`, `PlacedItem`; T7 `paginate`(테스트에서만); 1단계 `lineHeightMm`.
- Produces:
  ```ts
  // flow/groups.ts — 표와 반복 영역이 함께 쓰는 그룹 구간 계산
  export type GroupRun = { level: number; start: number; end: number; key: unknown; index: number };
  export type GroupContext = { key: unknown; rows: unknown[]; index: number; level: number };
  export function sameKey(a: unknown, b: unknown): boolean;            // 객체는 JSON 문자열로 비교
  export function computeGroupRuns(keys: unknown[][], count: number): GroupRun[][];   // keys[level][i] → runs[level]
  export function runsByRow(runs: GroupRun[][], count: number): GroupRun[][];         // [level][i] → 그 행이 속한 run
  export function groupContext(run: GroupRun, rows: unknown[]): GroupContext;         // run마다 한 번만 만든다
  // flow/table.ts
  export function tableFlow(el: TableElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] };
  export function tableWidth(el: TableElement): number;   // 열 너비 합
  ```
  인스턴스 문자열: 머리 `${prefix}${id}#h`, 행 `${prefix}${id}#${index}`, 그룹 머리 `${prefix}${id}#g${level}h${runIndex}`, 그룹 소계 `…#g${level}f${runIndex}`, 페이지 소계 `…#pf`, 합계 `…#f`.
  항목: 셀 텍스트 `role: "cell"`, 테두리 `role: "border"`(border `all`은 셀마다 rect, `rows`는 조각 아래 line). `elementId`는 표 id.

- [ ] **Step 1: groups 테스트 작성**

`packages/renderer/src/__tests__/groups.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeGroupRuns, runsByRow, groupContext, sameKey } from "../flow/groups";

describe("groups", () => {
  it("splits consecutive equal keys into runs, inner levels restarting at outer boundaries", () => {
    const keys = [["A", "A", "B", "B", "B", "A"], [1, 1, 1, 2, 2, 1]];   // 바깥, 안쪽
    const runs = computeGroupRuns(keys, 6);
    expect(runs[0].map((r) => [r.start, r.end, r.key, r.index])).toEqual([[0, 2, "A", 0], [2, 5, "B", 1], [5, 6, "A", 2]]);
    expect(runs[1].map((r) => [r.start, r.end, r.key, r.index])).toEqual([[0, 2, 1, 0], [2, 3, 1, 1], [3, 5, 2, 2], [5, 6, 1, 3]]);
    const byRow = runsByRow(runs, 6);
    expect(byRow[1][2]).toBe(runs[1][1]);
    expect(byRow[0][5].index).toBe(2);
  });
  it("returns no runs for zero rows or zero levels", () => {
    expect(computeGroupRuns([], 3)).toEqual([]);
    expect(computeGroupRuns([[]], 0)).toEqual([[]]);
  });
  it("groupContext slices rows once per run and compares object keys by value", () => {
    const run = { level: 0, start: 1, end: 3, key: { k: 1 }, index: 0 };
    const rows = [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }];
    const g = groupContext(run, rows);
    expect(g).toEqual({ key: { k: 1 }, rows: [{ n: 1 }, { n: 2 }], index: 0, level: 0 });
    expect(groupContext(run, rows)).toBe(g);
    expect(sameKey({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameKey(null, undefined)).toBe(false);
    expect(sameKey("1", 1)).toBe(false);
  });
});
```

- [ ] **Step 2: table-flow 테스트 작성**

`packages/renderer/src/__tests__/table-flow.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, type TableElement } from "@daport/core";
import { tableFlow, tableWidth } from "../flow/table";
import { paginate } from "../flow/paginate";
import { createMeasureCache } from "../text/cache";
import type { PageFlowContext } from "../flow/types";

const page = { width: 210, height: 297 };
const mkTable = (extra: Record<string, unknown> = {}): TableElement => {
  const r = parseReport({ id: "r", version: 1, page, elements: [{ id: "t", type: "table", x: 10, y: 20, w: 100, h: 60, source: "items",
    columns: [{ header: "품목", value: "{{ row.NAME }}", w: 40 }, { header: "수량", value: "{{ row.QTY }}", w: 30, align: "right" }], ...extra }] });
  return r.elements[0] as TableElement;
};
const items = [{ NAME: "A", QTY: 1, CAT: "x" }, { NAME: "B", QTY: 2, CAT: "x" }, { NAME: "C", QTY: 3, CAT: "y" }];
const opts = () => ({ measure: createMeasureCache(), onExpressionError: "blank" as const });
const pctx: PageFlowContext = { page: 1, total: 1, sheet: 1, sheets: 1, copy: 1, copies: 1, pageRows: [] };
const texts = (its: { kind: string; lines?: string[] }[]) => its.filter((i) => i.kind === "text").map((i) => (i as { lines: string[] }).lines.join(""));

describe("tableFlow", () => {
  it("builds header, one row block per row with cells, borders and instances", () => {
    const f = tableFlow(mkTable(), { params: {}, items }, opts());
    expect(f.rows).toBe(items);
    expect(f.header?.kind).toBe("header");
    expect(f.header?.height).toBe(7);
    expect(f.body.map((b) => b.kind)).toEqual(["row", "row", "row"]);
    expect(f.body[0].height).toBe(6);
    expect(f.body[0].rows).toEqual([items[0]]);
    const painted = f.body[1].paint({ x: 10, y: 50 }, pctx);
    expect(painted.map((i) => [i.kind, i.role])).toEqual([["rect", "border"], ["text", "cell"], ["rect", "border"], ["text", "cell"]]);
    expect(painted[1]).toMatchObject({ elementId: "t", instance: "t#1", x: 10, y: 50, w: 40, h: 6, lines: ["B"], style: { align: "left" } });
    expect(painted[3]).toMatchObject({ x: 50, w: 30, lines: ["2"], style: { align: "right" } });
    expect(texts(f.header!.paint({ x: 0, y: 0 }, pctx))).toEqual(["품목", "수량"]);
    expect(f.header!.paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ instance: "t#h" });
    expect(tableWidth(mkTable())).toBe(70);
  });
  it("draws one line per block for border rows and nothing for none", () => {
    const rows = tableFlow(mkTable({ border: "rows" }), { params: {}, items }, opts()).body[0].paint({ x: 10, y: 20 }, pctx);
    expect(rows.map((i) => i.kind)).toEqual(["text", "text", "line"]);
    expect(rows[2]).toMatchObject({ x: 10, y: 26, x2: 80, y2: 26 });
    expect(tableFlow(mkTable({ border: "none" }), { params: {}, items }, opts()).body[0].paint({ x: 0, y: 0 }, pctx).map((i) => i.kind)).toEqual(["text", "text"]);
  });
  it("grows a row to fit wrapped text and applies headerStyle and cell style overrides", () => {
    const long = [{ NAME: "가나다라마바사아자차카타파하 가나다라마바사아자차카타파하", QTY: 1 }];
    const f = tableFlow(mkTable({ headerStyle: { bold: true, fill: "#eee" } }), { params: {}, items: long }, opts());
    expect(f.body[0].height).toBeGreaterThan(6);
    const [, head] = f.header!.paint({ x: 0, y: 0 }, pctx);
    expect(head.style).toMatchObject({ bold: true, fill: "#eee" });
  });
  it("emits group headers/footers around consecutive keys, keepWithNext on headers, with group context", () => {
    const f = tableFlow(mkTable({ groups: [{ by: "row.CAT", header: [{ value: "분류 {{ group.key }} ({{ count(group.rows) }})", span: "all", style: { bold: true } }],
      footer: [{ value: "" }, { value: "소계 {{ sum(group.rows, 'QTY') }}" }] }] }), { params: {}, items }, opts());
    expect(f.body.map((b) => b.kind)).toEqual(["groupHeader", "row", "row", "groupFooter", "groupHeader", "row", "groupFooter"]);
    expect(f.body[0].keepWithNext).toBe(true);
    expect(f.body[0].rows).toEqual([]);
    expect(texts(f.body[0].paint({ x: 0, y: 0 }, pctx))).toEqual(["분류 x (2)"]);
    expect(f.body[0].paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ w: 70, instance: "t#g0h0", style: { bold: true } });
    expect(texts(f.body[3].paint({ x: 0, y: 0 }, pctx))).toEqual(["", "소계 3"]);
    expect(texts(f.body[6].paint({ x: 0, y: 0 }, pctx))).toEqual(["", "소계 3"]);
    expect(f.body[6].paint({ x: 0, y: 0 }, pctx)[3]).toMatchObject({ instance: "t#g0f1" });
  });
  it("nests two group levels (outer first) and gives rows the innermost group", () => {
    const rows = [{ A: 1, B: "p" }, { A: 1, B: "q" }, { A: 2, B: "q" }];
    const f = tableFlow(mkTable({ columns: [{ header: "", value: "{{ group.key }}/{{ group.level }}", w: 50 }],
      groups: [{ by: "row.A", header: [{ value: "A{{ group.key }}" }] }, { by: "row.B", header: [{ value: "B{{ group.key }}" }] }] }), { params: {}, items: rows }, opts());
    expect(f.body.map((b) => b.kind)).toEqual(["groupHeader", "groupHeader", "row", "groupHeader", "row", "groupHeader", "groupHeader", "row"]);
    expect(texts(f.body[2].paint({ x: 0, y: 0 }, pctx))).toEqual(["p/1"]);
    expect(f.body[1].keepWithNext && f.body[0].keepWithNext).toBe(true);
  });
  it("paints the page footer with that page's rows and the table footer with all rows", () => {
    const f = tableFlow(mkTable({ pageFooter: [{ value: "페이지 {{ page }}/{{ total }} 소계 {{ sum(pageRows, 'QTY') }}", span: "all" }], footer: [{ value: "합계 {{ sum(rows, 'QTY') }}", span: "all" }] }),
      { params: {}, items }, opts());
    expect(f.pageFooter?.kind).toBe("pageFooter");
    expect(f.footer?.kind).toBe("footer");
    expect(texts(f.pageFooter!.paint({ x: 0, y: 0 }, { ...pctx, page: 2, total: 3, pageRows: items.slice(0, 2) }))).toEqual(["페이지 2/3 소계 3"]);
    expect(texts(f.footer!.paint({ x: 0, y: 0 }, pctx))).toEqual(["합계 6"]);
    expect(f.pageFooter!.paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ instance: "t#pf" });
  });
  it("isolates a cell expression error to that cell in blank mode and throws in fail mode", () => {
    const bad = mkTable({ columns: [{ header: "", value: "{{ row. }}", w: 30 }, { header: "", value: "{{ row.NAME }}", w: 30 }] });
    const painted = tableFlow(bad, { params: {}, items }, opts()).body[0].paint({ x: 0, y: 0 }, pctx);
    expect(painted[1]).toMatchObject({ lines: ["#ERR"], error: expect.stringContaining("Expression") });
    expect(painted[3]).toMatchObject({ lines: ["A"] });
    expect(painted[3].error).toBeUndefined();
    expect(() => tableFlow(bad, { params: {}, items }, { ...opts(), onExpressionError: "fail" })).toThrow();
  });
  it("throws an ExpressionError for a non-array source (the caller renders #ERR)", () => {
    expect(() => tableFlow(mkTable({ source: "items[0].NAME" }), { params: {}, items }, opts())).toThrow(/source is not an array/);
    expect(tableFlow(mkTable({ source: "missing" }), { params: {}, items }, opts()).body).toEqual([]);
  });
  it("uses the instance prefix for nested tables", () => {
    const f = tableFlow(mkTable(), { params: {}, items }, { ...opts(), instancePrefix: "cards#3/" });
    expect(f.body[0].paint({ x: 0, y: 0 }, pctx)[1]).toMatchObject({ instance: "cards#3/t#0" });
  });
  it("works end to end with paginate: 500 rows over several pages with repeated header", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ NAME: `n${i}`, QTY: i, CAT: i % 2 ? "a" : "b" }));
    const el = mkTable();
    const f = tableFlow(el, { params: {}, items: many }, opts());
    const pages = paginate(f, { first: { x: el.x, y: el.y, w: el.w, h: el.h }, next: { x: el.x, y: el.y, w: el.w, h: 297 - 10 - el.y }, repeatHeader: true, clip: false });
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.every((p) => p.placements[0].block.kind === "header")).toBe(true);
    expect(pages.flatMap((p) => p.pageRows)).toEqual(many);
  });
  it("lays out 10k rows in under 1 second (3 seconds on CI)", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ NAME: `품목 ${i}`, QTY: i * 3, CAT: `c${i % 7}` }));
    const el = mkTable({ groups: [{ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }] }] });
    const t0 = performance.now();
    const f = tableFlow(el, { params: {}, items: many }, opts());
    const pages = paginate(f, { first: { x: el.x, y: el.y, w: el.w, h: el.h }, next: { x: el.x, y: el.y, w: el.w, h: 267 }, repeatHeader: true, clip: false });
    for (const p of pages) for (const pl of p.placements) pl.block.paint({ x: 0, y: pl.y }, { ...pctx, pageRows: p.pageRows });
    expect(performance.now() - t0).toBeLessThan(process.env.CI ? 3000 : 1000);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/renderer test -- groups table-flow`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: groups.ts 구현**

`packages/renderer/src/flow/groups.ts`:
```ts
export type GroupRun = { level: number; start: number; end: number; key: unknown; index: number };
export type GroupContext = { key: unknown; rows: unknown[]; index: number; level: number };

const keyOf = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
/** 그룹 키 비교. 객체는 JSON 문자열로, 그 밖은 === (문자열 "1"과 숫자 1은 다르다) */
export function sameKey(a: unknown, b: unknown): boolean { return keyOf(a) === keyOf(b); }

/**
 * 데이터 순서대로 연속된 같은 키를 구간으로 나눈다(자동 정렬 없음). 바깥 레벨의 경계는 안쪽 레벨의 경계이기도 하다.
 * keys[level][i]는 i번째 행의 level 그룹 키
 */
export function computeGroupRuns(keys: unknown[][], count: number): GroupRun[][] {
  return keys.map((_, level) => {
    const runs: GroupRun[] = [];
    let start = 0;
    for (let i = 1; i <= count; i++) {
      const boundary = i === count || keys.slice(0, level + 1).some((k) => !sameKey(k[i], k[i - 1]));
      if (boundary) { runs.push({ level, start, end: i, key: keys[level][start], index: runs.length }); start = i; }
    }
    return runs;
  });
}

/** [level][i] → i번째 행이 속한 구간 */
export function runsByRow(runs: GroupRun[][], count: number): GroupRun[][] {
  return runs.map((levelRuns) => {
    const byRow: GroupRun[] = new Array(count);
    for (const run of levelRuns) for (let i = run.start; i < run.end; i++) byRow[i] = run;
    return byRow;
  });
}

const contexts = new WeakMap<GroupRun, GroupContext>();
/** 표현식의 group 변수. rows 조각은 구간마다 한 번만 만든다 (1만 행에서 행마다 slice하지 않기 위해) */
export function groupContext(run: GroupRun, rows: unknown[]): GroupContext {
  let g = contexts.get(run);
  if (!g) { g = { key: run.key, rows: rows.slice(run.start, run.end), index: run.index, level: run.level }; contexts.set(run, g); }
  return g;
}
```

- [ ] **Step 5: table.ts 구현**

`packages/renderer/src/flow/table.ts`:
```ts
import { interpolate, evaluate, evaluateSource, usesPageVars, mergeStyle, StyleSchema, ExpressionError,
  type DataContext, type Style, type TableElement, type TableCell } from "@daport/core";
import { lineHeightMm } from "../text/measure";
import type { PlacedItem, PlacedLine, PlacedRect, PlacedText } from "../layout/types";
import type { Block, BlockKind, FlowInput, FlowOptions } from "./types";
import { computeGroupRuns, runsByRow, groupContext, type GroupRun } from "./groups";

/** 한 조각(행)의 셀. x는 표 왼쪽 기준, value는 템플릿 원문 */
type Cell = { x: number; w: number; value: string; style: Style };
type Measured = { lines: string[]; error?: string };

const DEFAULT_STYLE = StyleSchema.parse({});

export function tableWidth(el: TableElement): number { return el.columns.reduce((a, c) => a + c.w, 0); }

function columnOffsets(el: TableElement): number[] {
  const xs: number[] = []; let x = 0;
  for (const c of el.columns) { xs.push(x); x += c.w; }
  return xs;
}

/** 열 하나에 셀 하나인 행(머리행·데이터 행). 정렬은 열 align, 없으면 열 style.align */
function columnCells(el: TableElement, kind: "header" | "row"): Cell[] {
  const xs = columnOffsets(el);
  return el.columns.map((c, i) => ({
    x: xs[i], w: c.w, value: kind === "header" ? c.header : c.value,
    style: mergeStyle(c.style, kind === "header" ? el.headerStyle : undefined, c.align ? { align: c.align } : undefined),
  }));
}

/** span이 있는 셀 배열(그룹 머리·소계·페이지 소계·합계). span 합이 열 수보다 적으면 남은 열은 빈 셀. 넘치는 셀은 버린다 */
function spanCells(el: TableElement, cells: TableCell[]): Cell[] {
  const xs = columnOffsets(el);
  const out: Cell[] = [];
  let c = 0;
  for (const cell of cells) {
    if (c >= el.columns.length) break;
    const span = cell.span === "all" ? el.columns.length - c : Math.min(cell.span, el.columns.length - c);
    const col = el.columns[c];
    const align = cell.align ?? col.align;
    out.push({ x: xs[c], w: el.columns.slice(c, c + span).reduce((a, k) => a + k.w, 0), value: cell.value,
      style: mergeStyle(col.style, cell.style, align ? { align } : undefined) });
    c += span;
  }
  for (; c < el.columns.length; c++) out.push({ x: xs[c], w: el.columns[c].w, value: "", style: el.columns[c].style });
  return out;
}

function measureCell(cell: Cell, ctx: DataContext, opts: FlowOptions): Measured {
  let text: string;
  try {
    text = interpolate(cell.value, ctx);
  } catch (e) {
    if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
    return { lines: ["#ERR"], error: e.message };
  }
  const inner = Math.max(0, cell.w - cell.style.padding * 2);
  return { lines: cell.style.wrap ? opts.measure.wrap(text, cell.style.fontSize, cell.style.bold, inner) : text.split(/\r?\n/) };
}

const borderStyle = (el: TableElement): Style => ({ ...DEFAULT_STYLE, stroke: el.borderStyle.stroke, strokeWidth: el.borderStyle.strokeWidth });

/**
 * 셀 행 하나를 조각으로 만든다. 높이 = max(minHeight, 셀별 줄 수 × 줄 높이 + padding × 2)로 생성 시 확정한다.
 * 페이지 의존 변수를 쓰지 않는 셀은 여기서 잰 줄을 paint에서 그대로 쓴다(스펙 R6)
 */
function makeBlock(el: TableElement, kind: BlockKind, cells: Cell[], ctx: DataContext, minHeight: number, keepWithNext: boolean,
  rows: unknown[], opts: FlowOptions, instance: string): Block {
  const measured = cells.map((c) => measureCell(c, ctx, opts));
  const dynamic = cells.map((c) => usesPageVars(c.value));
  let height = minHeight;
  cells.forEach((c, i) => { height = Math.max(height, measured[i].lines.length * lineHeightMm(c.style.fontSize, c.style.lineHeight) + c.style.padding * 2); });
  const width = tableWidth(el);
  const bstyle = borderStyle(el);
  return {
    kind, height, keepWithNext, rows,
    paint(origin, pageCtx) {
      const items: PlacedItem[] = [];
      const pctx = dynamic.some(Boolean) ? { ...ctx, ...pageCtx } : null;
      cells.forEach((c, i) => {
        const m = pctx && dynamic[i] ? measureCell(c, pctx, opts) : measured[i];
        const x = origin.x + c.x, y = origin.y;
        if (el.border === "all") items.push({ kind: "rect", elementId: el.id, role: "border", instance, x, y, w: c.w, h: height, style: bstyle } satisfies PlacedRect);
        const text: PlacedText = { kind: "text", elementId: el.id, role: "cell", instance, x, y, w: c.w, h: height, style: c.style,
          lines: m.lines, lineHeight: lineHeightMm(c.style.fontSize, c.style.lineHeight), overflow: false };
        if (m.error) text.error = m.error;
        items.push(text);
      });
      if (el.border === "rows") {
        const y = origin.y + height;
        items.push({ kind: "line", elementId: el.id, role: "border", instance, x: origin.x, y, w: width, h: 0, x2: origin.x + width, y2: y, style: bstyle } satisfies PlacedLine);
      }
      return items;
    },
  };
}

/** 그룹 키. blank 모드의 표현식 오류는 키 null(한 그룹)로 둔다. 셀이 아니라 #ERR를 보일 곳이 없다 */
function groupKey(by: string, ctx: DataContext, opts: FlowOptions): unknown {
  try { return evaluate(by, ctx); }
  catch (e) { if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e; return null; }
}

/**
 * 표를 조각으로 바꾼다 (스펙 5.1). el은 페이지 절대좌표.
 * 소스 오류는 ExpressionError로 던진다(호출자가 #ERR 한 칸으로 바꾼다). 셀 표현식 오류는 그 셀만 #ERR
 */
export function tableFlow(el: TableElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] } {
  const rows = evaluateSource(el.source, ctx);
  const prefix = `${opts.instancePrefix ?? ""}${el.id}#`;
  const base: DataContext = { ...ctx, rows, pageRows: [] };
  const header = el.columns.length ? makeBlock(el, "header", columnCells(el, "header"), base, el.headerHeight, false, [], opts, `${prefix}h`) : undefined;

  const levels = el.groups.length;
  const keys = el.groups.map((g) => rows.map((row, i) => groupKey(g.by, { ...base, row, index: i }, opts)));
  const runs = computeGroupRuns(keys, rows.length);
  const byRow = runsByRow(runs, rows.length);
  const gctx = (run: GroupRun) => groupContext(run, rows);
  const headerCells = el.groups.map((g) => spanCells(el, g.header));
  const footerCells = el.groups.map((g) => spanCells(el, g.footer));
  const rowCells = columnCells(el, "row");

  const body: Block[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let L = 0; L < levels; L++) {
      const run = byRow[L][i];
      if (run.start === i && el.groups[L].header.length) {
        body.push(makeBlock(el, "groupHeader", headerCells[L], { ...base, row: rows[i], index: i, group: gctx(run) }, el.rowHeight,
          el.groups[L].keepHeaderWithRows, [], opts, `${prefix}g${L}h${run.index}`));
      }
    }
    const group = levels ? gctx(byRow[levels - 1][i]) : undefined;
    body.push(makeBlock(el, "row", rowCells, { ...base, row: rows[i], index: i, group }, el.rowHeight, false, [rows[i]], opts, `${prefix}${i}`));
    for (let L = levels - 1; L >= 0; L--) {
      const run = byRow[L][i];
      if (run.end === i + 1 && el.groups[L].footer.length) {
        body.push(makeBlock(el, "groupFooter", footerCells[L], { ...base, row: rows[i], index: i, group: gctx(run) }, el.rowHeight, false, [], opts, `${prefix}g${L}f${run.index}`));
      }
    }
  }
  // 페이지 소계는 페이지마다 pageRows로 다시 그린다. 높이는 전체 행으로 잰다(페이지 값이 높이를 바꾸지 않는다)
  const pageFooter = el.pageFooter.length ? makeBlock(el, "pageFooter", spanCells(el, el.pageFooter), { ...base, pageRows: rows }, el.rowHeight, false, [], opts, `${prefix}pf`) : undefined;
  const footer = el.footer.length ? makeBlock(el, "footer", spanCells(el, el.footer), base, el.rowHeight, false, [], opts, `${prefix}f`) : undefined;
  return { header, pageFooter, body, footer, rows };
}
```

`packages/renderer/src/index.ts`에 `export * from "./flow/groups";`, `export * from "./flow/table";` 추가.

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter @daport/renderer test && pnpm --filter @daport/renderer typecheck`
Expected: PASS. 성능 테스트가 1초를 넘으면 `measureCell`의 `interpolate` 호출 수를 세어 본다(행 1만 × 열 2 = 2만 회, 그룹 키 1만 회면 정상). 여전히 느리면 T4의 컴파일 캐시가 동작하는지 확인한다.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src
git commit -m "feat(renderer): 표 흐름 조각 — 셀·테두리·그룹 머리·소계·페이지 소계·합계"
```

---

### Task 11: renderer 반복 영역 흐름 조각, 자식 그리기, placeStatic

**Files:**
- Create: `packages/renderer/src/layout/place.ts`, `packages/renderer/src/flow/paint.ts`, `packages/renderer/src/flow/children.ts`, `packages/renderer/src/flow/repeater.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/src/__tests__/place.test.ts`, `packages/renderer/src/__tests__/repeater-flow.test.ts`

**Interfaces:**
- Consumes: T2 `RepeaterElement`, `RepeaterBand`; T4 `evaluateSource`; T6 타입; T7 `paginate`; T10 `tableFlow`, `groups.ts`; 1단계 `flatten`, `wrapText`, `lineHeightMm`.
- Produces:
  ```ts
  // layout/place.ts
  export function isVisible(visible: string | undefined, ctx: DataContext): boolean;
  export function errorItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, message: string, instance?: string): PlacedText;
  export function placeStatic(el: FlatElement, ctx: DataContext, opts: { onExpressionError: "blank" | "fail"; instance?: string }): PlacedItem[];   // 0 또는 1개. table·repeater면 던진다
  // flow/paint.ts
  export function flowBoxItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, flags: { clipped?: boolean; overflow?: boolean; instance?: string }): PlacedRect;
  export function paintFlowPage(page: FlowPage, origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[];
  export function paintClipped(el: TableElement, ctx: DataContext, opts: FlowOptions, pageCtx: PageFlowContext, instance?: string): PlacedItem[];   // clip 표: 첫 영역 조각만. 소스 오류는 #ERR 한 칸
  // flow/children.ts
  export function paintChildren(children: Element[], origin: { x: number; y: number }, ctx: DataContext, opts: FlowOptions & { instance: string; pageCtx: PageFlowContext }): PlacedItem[];
  // flow/repeater.ts
  export function repeaterFlow(el: RepeaterElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] };
  export function itemsPerRow(el: RepeaterElement): number;   // list 1, grid max(1, floor((w + gap0) / (item.w + gap0)))
  ```
  반복 영역 항목의 인스턴스는 `${prefix}${id}#${index}`, 자식 항목은 그 값을 `instance`로 갖고 `elementId`는 자식 id. 첫 항목(index 0)의 자리에 `role: "template"` rect를 하나 둔다. 그룹 밴드는 `${prefix}${id}#g${level}h${runIndex}` / `…f…`.

- [ ] **Step 1: place 테스트 작성**

`packages/renderer/src/__tests__/place.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { flatten } from "../layout/flatten";
import { placeStatic, errorItem, isVisible } from "../layout/place";

const page = { width: 100, height: 50 };
const flat = (els: unknown[]) => flatten(parseReport({ id: "r", version: 1, page, elements: els as never }).elements);
const ctx = { params: {}, order: { NAME: "ACME", HIDE: true } };

describe("placeStatic", () => {
  it("places text, pageNumber, image, line, rect, barcode and ref like layout did, with an instance", () => {
    const els = flat([
      { id: "t", type: "text", x: 1, y: 2, w: 40, h: 8, value: "{{ order.NAME }}" },
      { id: "p", type: "pageNumber", x: 0, y: 0, w: 10, h: 5 },
      { id: "i", type: "image", x: 0, y: 0, w: 10, h: 5, src: "asset://{{ order.NAME }}" },
      { id: "l", type: "line", x: 0, y: 0, w: 5, h: 0, x2: 5, y2: 0 },
      { id: "r", type: "rect", x: 0, y: 0, w: 5, h: 5 },
      { id: "b", type: "barcode", x: 0, y: 0, w: 5, h: 5, format: "qr", value: "x" },
      { id: "c", type: "ref", x: 0, y: 0, w: 5, h: 5, ref: "hdr" },
    ]);
    const items = els.flatMap((el) => placeStatic(el, { ...ctx, page: 2, total: 3 }, { onExpressionError: "blank", instance: "cards#1" }));
    expect(items.map((i) => i.kind)).toEqual(["text", "text", "image", "line", "rect", "placeholder", "placeholder"]);
    expect(items[0]).toMatchObject({ lines: ["ACME"], instance: "cards#1", x: 1, y: 2 });
    expect(items[1]).toMatchObject({ lines: ["2 / 3"] });
    expect(items[2]).toMatchObject({ src: "asset://ACME" });
    expect(items[5]).toMatchObject({ label: "barcode:qr" });
  });
  it("returns [] for hidden elements and #ERR for expression errors in blank mode, throws in fail mode", () => {
    const [hidden, bad] = flat([
      { id: "h", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "{{ !order.HIDE }}" },
      { id: "bad", type: "text", x: 3, y: 4, w: 10, h: 5, value: "{{ order. }}" },
    ]);
    expect(placeStatic(hidden, ctx, { onExpressionError: "blank" })).toEqual([]);
    expect(placeStatic(bad, ctx, { onExpressionError: "blank" })[0]).toMatchObject({ kind: "text", lines: ["#ERR"], x: 3, y: 4, error: expect.stringContaining("Expression") });
    expect(() => placeStatic(bad, ctx, { onExpressionError: "fail" })).toThrow();
  });
  it("throws for flow elements", () => {
    const [t] = flat([{ id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] }]);
    expect(() => placeStatic(t, ctx, { onExpressionError: "blank" })).toThrow(/flow element/);
  });
  it("errorItem and isVisible behave like phase 1", () => {
    expect(errorItem({ id: "x", x: 1, y: 1, w: 5, h: 5, style: flat([{ id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 }])[0].style }, "boom", "i#0")).toMatchObject({ lines: ["#ERR"], error: "boom", instance: "i#0" });
    expect(isVisible(undefined, ctx)).toBe(true);
    expect(isVisible("", ctx)).toBe(true);
    expect(isVisible("!order.HIDE", ctx)).toBe(false);
    expect(isVisible("{{ order.HIDE }}", ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: repeater-flow 테스트 작성**

`packages/renderer/src/__tests__/repeater-flow.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, type RepeaterElement } from "@daport/core";
import { repeaterFlow, itemsPerRow } from "../flow/repeater";
import { paintChildren } from "../flow/children";
import { paginate } from "../flow/paginate";
import { createMeasureCache } from "../text/cache";
import type { PageFlowContext } from "../flow/types";

const page = { width: 210, height: 297 };
const mk = (extra: Record<string, unknown> = {}): RepeaterElement => parseReport({ id: "r", version: 1, page, elements: [
  { id: "cards", type: "repeater", x: 10, y: 40, w: 190, h: 240, source: "lots",
    item: { w: 60, h: 35, children: [{ id: "nm", type: "text", x: 2, y: 2, w: 50, h: 6, value: "{{ item.NAME }} #{{ index }}" }] }, ...extra }] }).elements[0] as RepeaterElement;
const lots = [{ NAME: "L1", LINE: "A" }, { NAME: "L2", LINE: "A" }, { NAME: "L3", LINE: "B" }, { NAME: "L4", LINE: "B" }, { NAME: "L5", LINE: "B" }];
const opts = () => ({ measure: createMeasureCache(), onExpressionError: "blank" as const });
const pctx: PageFlowContext = { page: 1, total: 1, sheet: 1, sheets: 1, copy: 1, copies: 1, pageRows: [] };
const texts = (its: { kind: string; lines?: string[] }[]) => its.filter((i) => i.kind === "text").map((i) => (i as { lines: string[] }).lines.join(""));

describe("repeaterFlow", () => {
  it("list: one row block per item, item height + vertical gap, children at item origin with instances", () => {
    const f = repeaterFlow(mk({ gap: [0, 2] }), { params: {}, lots }, opts());
    expect(f.rows).toBe(lots);
    expect(f.body.map((b) => [b.kind, b.height, b.rows.length])).toEqual(Array(5).fill(["row", 37, 1]));
    const items = f.body[1].paint({ x: 10, y: 100 }, pctx);
    expect(items.map((i) => [i.kind, i.role])).toEqual([["text", undefined]]);
    expect(items[0]).toMatchObject({ elementId: "nm", instance: "cards#1", x: 12, y: 102, lines: ["L2 #1"] });
    const first = f.body[0].paint({ x: 10, y: 40 }, pctx);
    expect(first[0]).toMatchObject({ kind: "rect", role: "template", elementId: "cards", instance: "cards#0", x: 10, y: 40, w: 60, h: 35 });
    expect(first[1]).toMatchObject({ elementId: "nm", instance: "cards#0" });
  });
  it("grid: floor((w + gap) / (item.w + gap)) items per row block, left to right", () => {
    const el = mk({ layout: "grid", gap: [5, 5] });
    expect(itemsPerRow(el)).toBe(3);                                  // (190 + 5) / (60 + 5) = 3
    expect(itemsPerRow(mk({ layout: "grid", item: { w: 500, h: 10, children: [] } }))).toBe(1);
    const f = repeaterFlow(el, { params: {}, lots }, opts());
    expect(f.body.map((b) => b.rows.length)).toEqual([3, 2]);
    const xs = f.body[0].paint({ x: 10, y: 40 }, pctx).filter((i) => i.kind === "text").map((i) => i.x);
    expect(xs).toEqual([12, 77, 142]);
    expect(f.body[0].height).toBe(40);
  });
  it("groups: header/footer bands with group context, rows restart at group boundaries, header keepWithNext", () => {
    const f = repeaterFlow(mk({ layout: "grid", groups: [{ by: "item.LINE",
      header: { h: 8, children: [{ id: "gh", type: "text", x: 0, y: 0, w: 100, h: 6, value: "라인 {{ group.key }} ({{ count(group.rows) }})" }] },
      footer: { h: 6, children: [{ id: "gf", type: "text", x: 0, y: 0, w: 100, h: 6, value: "끝 {{ group.index }}" }] } }] }), { params: {}, lots }, opts());
    expect(f.body.map((b) => [b.kind, b.rows.length])).toEqual([["groupHeader", 0], ["row", 2], ["groupFooter", 0], ["groupHeader", 0], ["row", 3], ["groupFooter", 0]]);
    expect(f.body[0].keepWithNext).toBe(true);
    expect(f.body[0].height).toBe(8);
    expect(texts(f.body[0].paint({ x: 0, y: 0 }, pctx))).toEqual(["라인 A (2)"]);
    expect(f.body[0].paint({ x: 0, y: 0 }, pctx)[0]).toMatchObject({ elementId: "gh", instance: "cards#g0h0" });
    expect(texts(f.body[5].paint({ x: 0, y: 0 }, pctx))).toEqual(["끝 1"]);
  });
  it("isolates an item expression error to that child and throws for a non-array source", () => {
    const f = repeaterFlow(mk({ item: { w: 60, h: 20, children: [
      { id: "bad", type: "text", x: 0, y: 0, w: 10, h: 5, value: "{{ item. }}" }, { id: "ok", type: "text", x: 0, y: 5, w: 10, h: 5, value: "{{ item.NAME }}" }] } }), { params: {}, lots }, opts());
    const [, bad, ok] = f.body[0].paint({ x: 0, y: 0 }, pctx);
    expect(bad).toMatchObject({ elementId: "bad", lines: ["#ERR"] });
    expect(ok).toMatchObject({ elementId: "ok", lines: ["L1"] });
    expect(() => repeaterFlow(mk({ source: "lots[0]" }), { params: {}, lots }, opts())).toThrow(/source is not an array/);
  });
  it("paints a clip table inside an item with a nested instance prefix and a flowBox", () => {
    const f = repeaterFlow(mk({ item: { w: 100, h: 30, children: [
      { id: "t2", type: "table", x: 0, y: 0, w: 80, h: 20, source: "item.lines", overflow: "clip", columns: [{ header: "N", value: "{{ row.n }}", w: 40 }] }] } }),
      { params: {}, lots: [{ lines: [{ n: 1 }, { n: 2 }] }] }, opts());
    const items = f.body[0].paint({ x: 10, y: 40 }, pctx);
    expect(items[1]).toMatchObject({ kind: "rect", role: "flowBox", elementId: "t2", instance: "cards#0", x: 10, y: 40, w: 80, h: 20 });
    expect(items.filter((i) => i.role === "cell").map((i) => i.instance)).toEqual(["cards#0/t2#h", "cards#0/t2#0", "cards#0/t2#1"]);
  });
  it("works with paginate over several pages", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ NAME: `L${i}`, LINE: "A" }));
    const el = mk({ layout: "grid" });
    const pages = paginate(repeaterFlow(el, { params: {}, lots: many }, opts()), { first: { x: el.x, y: el.y, w: el.w, h: el.h }, next: { x: el.x, y: el.y, w: el.w, h: 247 }, repeatHeader: false, clip: false });
    expect(pages.length).toBe(3);                                       // 14 줄 × 35mm: 6 + 7 + 1
    expect(pages.flatMap((p) => p.pageRows)).toEqual(many);
  });
});

describe("paintChildren", () => {
  it("merges page context into the child context and offsets groups", () => {
    const el = mk({ item: { w: 60, h: 20, children: [{ id: "g", type: "group", x: 5, y: 5, w: 20, h: 10, children: [{ id: "pn", type: "pageNumber", x: 1, y: 1, w: 10, h: 5 }] }] } });
    const items = paintChildren(el.item.children, { x: 100, y: 200 }, { params: {} }, { ...opts(), instance: "cards#0", pageCtx: { ...pctx, page: 3, total: 9 } });
    expect(items[0]).toMatchObject({ elementId: "pn", instance: "cards#0", x: 106, y: 206, lines: ["3 / 9"] });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/renderer test -- place repeater-flow`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: place.ts 작성**

`packages/renderer/src/layout/place.ts`:
```ts
import { interpolate, evaluate, evaluateTemplateValue, hasTemplate, ExpressionError, type DataContext, type Style } from "@daport/core";
import type { FlatElement } from "./flatten";
import { wrapText, lineHeightMm } from "../text/measure";
import type { PlacedItem, PlacedText } from "./types";

type Box = { id: string; x: number; y: number; w: number; h: number; style: Style };

function textItem(el: Box, text: string, instance?: string): PlacedText {
  const inner = Math.max(0, el.w - el.style.padding * 2);
  const lines = el.style.wrap ? wrapText(text, el.style.fontSize, el.style.bold, inner) : text.split(/\r?\n/);
  const lh = lineHeightMm(el.style.fontSize, el.style.lineHeight);
  const overflow = lines.length * lh > el.h - el.style.padding * 2 + 1e-6;
  const item: PlacedText = { kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style, lines, lineHeight: lh, overflow };
  if (instance !== undefined) item.instance = instance;
  return item;
}

/** 표현식 오류를 그 요소 자리의 #ERR 텍스트로 바꾼다 */
export function errorItem(el: Box, message: string, instance?: string): PlacedText {
  const item: PlacedText = { kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style,
    lines: ["#ERR"], lineHeight: lineHeightMm(el.style.fontSize, el.style.lineHeight), overflow: false, error: message };
  if (instance !== undefined) item.instance = instance;
  return item;
}

/** visible 표현식: "{{ }}"가 있으면 템플릿 값, 없으면 맨 표현식으로 평가한다. 미지정·빈 문자열은 항상 표시 */
export function isVisible(visible: string | undefined, ctx: DataContext): boolean {
  if (visible === undefined || visible.trim() === "") return true;
  return Boolean(hasTemplate(visible) ? evaluateTemplateValue(visible, ctx) : evaluate(visible, ctx));
}

/**
 * 고정 요소 하나를 배치한다. 숨김이면 [], 표현식 오류는 blank 모드에서 #ERR 항목, fail 모드에서 던진다.
 * 흐름 요소(table·repeater)는 받지 않는다 — 호출자가 흐름으로 처리한다
 */
export function placeStatic(el: FlatElement, ctx: DataContext, opts: { onExpressionError: "blank" | "fail"; instance?: string }): PlacedItem[] {
  if (el.type === "table" || el.type === "repeater") throw new Error(`flow element ${el.id} cannot be placed statically`);
  try {
    // 조상 그룹(바깥부터) → 요소 자신 순서의 AND. 그룹 visible 오류는 자손마다 각자의 #ERR 항목이 된다
    if (!el.ancestorsVisible.every((v) => isVisible(v, ctx)) || !isVisible(el.visible, ctx)) return [];
    const base: PlacedItem = { kind: "rect", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style };
    if (opts.instance !== undefined) base.instance = opts.instance;
    switch (el.type) {
      case "text": return [textItem(el, interpolate(el.value, ctx), opts.instance)];
      case "pageNumber": return [textItem(el, interpolate(el.format, ctx), opts.instance)];
      case "image": return [{ ...base, kind: "image", src: interpolate(el.src, ctx), fit: el.fit }];
      case "line": return [{ ...base, kind: "line", x2: el.x2, y2: el.y2 }];
      case "rect": return [base];
      case "barcode": return [{ ...base, kind: "placeholder", label: `barcode:${el.format}` }];
      case "ref": return [{ ...base, kind: "placeholder", label: `ref:${el.ref}` }];
    }
  } catch (e) {
    // 표현식 오류만 요소 단위로 격리한다. 렌더러 자체 오류는 모드와 무관하게 그대로 던진다
    if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
    return [errorItem(el, e.message, opts.instance)];
  }
}
```

- [ ] **Step 5: flow/paint.ts, flow/children.ts, flow/repeater.ts 작성**

`packages/renderer/src/flow/paint.ts`:
```ts
import { ExpressionError, StyleSchema, type DataContext, type Style, type TableElement } from "@daport/core";
import type { PlacedItem, PlacedRect } from "../layout/types";
import { errorItem } from "../layout/place";
import { paginate } from "./paginate";
import { tableFlow } from "./table";
import type { FlowOptions, FlowPage, PageFlowContext } from "./types";

const DEFAULT_STYLE: Style = StyleSchema.parse({});

/** 표·반복 영역 전체 영역의 선택·히트용 항목. 채움·선 없음 */
export function flowBoxItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, flags: { clipped?: boolean; overflow?: boolean; instance?: string }): PlacedRect {
  const item: PlacedRect = { kind: "rect", elementId: el.id, role: "flowBox", x: el.x, y: el.y, w: el.w, h: el.h, style: { ...DEFAULT_STYLE, fill: undefined, stroke: undefined } };
  if (flags.clipped) item.clipped = true;
  if (flags.overflow) item.overflow = true;
  if (flags.instance !== undefined) item.instance = flags.instance;
  return item;
}

/** 나눠진 한 페이지의 조각들을 origin(영역 좌상단 절대좌표) 기준으로 칠한다 */
export function paintFlowPage(page: FlowPage, origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[] {
  const ctx = { ...pageCtx, pageRows: page.pageRows };
  return page.placements.flatMap((pl) => pl.block.paint({ x: origin.x, y: origin.y + pl.y }, ctx));
}

/** overflow "clip" 표: 첫 영역에 들어가는 조각까지만 그린다. 소스 오류는 #ERR 한 칸 */
export function paintClipped(el: TableElement, ctx: DataContext, opts: FlowOptions, pageCtx: PageFlowContext, instance?: string): PlacedItem[] {
  let input: ReturnType<typeof tableFlow>;
  try {
    input = tableFlow(el, ctx, { ...opts, instancePrefix: instance !== undefined ? `${instance}/` : opts.instancePrefix });
  } catch (e) {
    if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
    return [errorItem(el, e.message, instance)];
  }
  const region = { x: el.x, y: el.y, w: el.w, h: el.h };
  const [page] = paginate(input, { first: region, next: region, repeatHeader: el.repeatHeader, clip: true });
  return [flowBoxItem(el, { clipped: page.truncated, overflow: page.overflow, instance }), ...paintFlowPage(page, { x: el.x, y: el.y }, pageCtx)];
}
```

`packages/renderer/src/flow/children.ts`:
```ts
import type { DataContext, Element } from "@daport/core";
import { flatten } from "../layout/flatten";
import { placeStatic } from "../layout/place";
import type { PlacedItem } from "../layout/types";
import { paintClipped } from "./paint";
import type { FlowOptions, PageFlowContext } from "./types";

/**
 * 반복 영역 항목·그룹 밴드의 자식을 origin 기준 절대좌표로 그린다. 페이지 값은 컨텍스트에 합친다.
 * 스키마가 템플릿 안의 repeater와 continue 표를 막으므로 여기서 table은 항상 clip이다
 */
export function paintChildren(children: Element[], origin: { x: number; y: number }, ctx: DataContext,
  opts: FlowOptions & { instance: string; pageCtx: PageFlowContext }): PlacedItem[] {
  const full: DataContext = { ...ctx, ...opts.pageCtx };
  const items: PlacedItem[] = [];
  for (const el of flatten(children, origin.x, origin.y)) {
    if (el.type === "table") items.push(...paintClipped(el, full, opts, opts.pageCtx, opts.instance));
    else if (el.type === "repeater") continue;   // 스키마가 막는다. 방어적으로 건너뛴다
    else items.push(...placeStatic(el, full, { onExpressionError: opts.onExpressionError, instance: opts.instance }));
  }
  return items;
}
```

`packages/renderer/src/flow/repeater.ts`:
```ts
import { evaluate, evaluateSource, ExpressionError, StyleSchema, type DataContext, type RepeaterBand, type RepeaterElement, type Style } from "@daport/core";
import type { PlacedItem, PlacedRect } from "../layout/types";
import { paintChildren } from "./children";
import { computeGroupRuns, runsByRow, groupContext, type GroupRun } from "./groups";
import type { Block, FlowInput, FlowOptions } from "./types";

const DEFAULT_STYLE: Style = StyleSchema.parse({});

/** list는 1, grid는 한 줄에 들어가는 항목 수(최소 1) */
export function itemsPerRow(el: RepeaterElement): number {
  if (el.layout === "list") return 1;
  return Math.max(1, Math.floor((el.w + el.gap[0]) / (el.item.w + el.gap[0])));
}

function groupKey(by: string, ctx: DataContext, opts: FlowOptions): unknown {
  try { return evaluate(by, ctx); }
  catch (e) { if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e; return null; }
}

/**
 * 반복 영역을 조각으로 바꾼다 (스펙 5.1). list는 항목마다, grid는 한 줄마다 row 조각. 그룹 경계에서 줄을 끊는다(R7).
 * 소스 오류는 ExpressionError로 던진다
 */
export function repeaterFlow(el: RepeaterElement, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] } {
  const rows = evaluateSource(el.source, ctx);
  const prefix = `${opts.instancePrefix ?? ""}${el.id}#`;
  const base: DataContext = { ...ctx, rows, pageRows: [] };
  const perRow = itemsPerRow(el);
  const stepX = el.item.w + el.gap[0];

  const levels = el.groups.length;
  const keys = el.groups.map((g) => rows.map((item, i) => groupKey(g.by, { ...base, item, index: i }, opts)));
  const runs = computeGroupRuns(keys, rows.length);
  const byRow = runsByRow(runs, rows.length);
  const gctx = (run: GroupRun) => groupContext(run, rows);

  const rowBlock = (indices: number[]): Block => ({
    kind: "row", height: el.item.h + el.gap[1], keepWithNext: false, rows: indices.map((i) => rows[i]),
    paint(origin, pageCtx) {
      const items: PlacedItem[] = [];
      indices.forEach((i, k) => {
        const x = origin.x + k * stepX, y = origin.y;
        const instance = `${prefix}${i}`;
        // 첫 항목 자리는 캔버스의 템플릿 편집 영역이다 (파란 점선은 캔버스가 role로 그린다)
        if (i === 0) items.push({ kind: "rect", elementId: el.id, role: "template", instance, x, y, w: el.item.w, h: el.item.h, style: DEFAULT_STYLE } satisfies PlacedRect);
        const group = levels ? gctx(byRow[levels - 1][i]) : undefined;
        items.push(...paintChildren(el.item.children, { x, y }, { ...base, item: rows[i], index: i, group }, { ...opts, instance, pageCtx }));
      });
      return items;
    },
  });
  const bandBlock = (kind: "groupHeader" | "groupFooter", band: RepeaterBand, run: GroupRun, instance: string): Block => ({
    kind, height: band.h, keepWithNext: kind === "groupHeader", rows: [],
    paint(origin, pageCtx) {
      return paintChildren(band.children, origin, { ...base, item: rows[run.start], index: run.start, group: gctx(run) }, { ...opts, instance, pageCtx });
    },
  });

  const body: Block[] = [];
  let buffer: number[] = [];
  const flush = () => { if (buffer.length) { body.push(rowBlock(buffer)); buffer = []; } };
  for (let i = 0; i < rows.length; i++) {
    for (let L = 0; L < levels; L++) {
      const run = byRow[L][i];
      if (run.start === i) { flush(); if (el.groups[L].header) body.push(bandBlock("groupHeader", el.groups[L].header, run, `${prefix}g${L}h${run.index}`)); }
    }
    buffer.push(i);
    if (buffer.length === perRow) flush();
    for (let L = levels - 1; L >= 0; L--) {
      const run = byRow[L][i];
      if (run.end === i + 1) { flush(); if (el.groups[L].footer) body.push(bandBlock("groupFooter", el.groups[L].footer, run, `${prefix}g${L}f${run.index}`)); }
    }
  }
  flush();
  return { body, rows };
}
```

`packages/renderer/src/index.ts`에 추가:
```ts
export * from "./layout/place";
export * from "./flow/paint";
export * from "./flow/children";
export * from "./flow/repeater";
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter @daport/renderer test && pnpm --filter @daport/renderer typecheck`
Expected: PASS. 순환 import 주의: `flow/paint.ts → flow/table.ts`, `flow/children.ts → flow/paint.ts`, `flow/repeater.ts → flow/children.ts`. `layout/layout.ts`는 아직 이들을 쓰지 않는다.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/src
git commit -m "feat(renderer): 반복 영역 흐름 조각, 항목 자식 그리기, 고정 요소 배치 분리"
```

---
### Task 12: datasource http 커넥터, 비밀값, 허용 호스트, 한도

**Files:**
- Create: `packages/datasource/src/http.ts`
- Modify: `packages/datasource/src/execute.ts` (http 분기), `packages/datasource/src/index.ts`
- Test: `packages/datasource/src/__tests__/http.test.ts`

**Interfaces:**
- Consumes: T3 `HttpDataset`; T8 `HttpConnector`, `Limits`, `DatasetFailure`, `SecretResolver`; core `evaluate`, `interpolate`.
- Produces: `parseAllowList`, `createFetchHttpConnector`, `buildHttpRequest`, `pickRows`, `maskSecrets`, `runHttp(ds, params, connectors, secrets, limits)`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/datasource/src/__tests__/http.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { parseReport, type HttpDataset } from "@daport/core";
import { executeDatasets, parseAllowList, createFetchHttpConnector, buildHttpRequest, pickRows, maskSecrets, DatasetFailure, DEFAULT_LIMITS } from "../index";

const ds = (extra: Partial<HttpDataset> = {}): HttpDataset => ({ name: "orders", type: "http", method: "GET", url: "https://mes.example.com/api/orders/{{ params.no }}", headers: {}, ...extra });
const secrets = (name: string) => ({ MES_TOKEN: "s3cr3t" } as Record<string, string>)[name];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeFetch = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => vi.fn((url: URL | RequestInfo, init?: RequestInit) => impl(String(url), init ?? {})) as unknown as typeof fetch;
const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };

describe("parseAllowList", () => {
  it("splits, trims, lower-cases and drops empties", () => {
    expect(parseAllowList(" MES.example.com, api.local:8080 ,,")).toEqual(["mes.example.com", "api.local:8080"]);
    expect(parseAllowList(undefined)).toEqual([]);
  });
});

describe("buildHttpRequest", () => {
  it("encodes url template values, leaves header/body values raw, and reports used secrets", () => {
    const { request, usedSecrets } = buildHttpRequest(ds({ method: "POST", url: "https://h/{{ params.no }}?q={{ params.q }}", headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}" }, body: "{\"lot\": \"{{ params.q }}\"}" }),
      { no: "A/1", q: "a b&c" }, secrets);
    expect(request).toEqual({ method: "POST", url: "https://h/A%2F1?q=a%20b%26c", headers: { Authorization: "Bearer s3cr3t" }, body: "{\"lot\": \"a b&c\"}" });
    expect(usedSecrets).toEqual(["s3cr3t"]);
  });
  it("omits the body for GET and resolves a missing secret to an empty string", () => {
    const { request, usedSecrets } = buildHttpRequest(ds({ headers: { X: "{{ secrets.NOPE }}" }, body: "ignored" }), { no: 1 }, secrets);
    expect(request.body).toBeUndefined();
    expect(request.headers.X).toBe("");
    expect(usedSecrets).toEqual([]);
  });
});

describe("pickRows", () => {
  it("follows a dot path, wraps an object, rejects non-object rows and missing paths", () => {
    expect(pickRows({ data: { items: [{ a: 1 }] } }, "data.items")).toEqual([{ a: 1 }]);
    expect(pickRows({ a: 1 }, undefined)).toEqual([{ a: 1 }]);
    expect(pickRows([{ a: 1 }], "")).toEqual([{ a: 1 }]);
    for (const [j, p] of [[{ data: 1 }, "data.items"], [[1, 2], undefined], ["x", undefined], [null, "a"]] as const) {
      expect(() => pickRows(j, p)).toThrow(DatasetFailure);
      try { pickRows(j, p); } catch (e) { expect((e as DatasetFailure).code).toBe("ROWS_PATH"); }
    }
  });
});

describe("maskSecrets", () => {
  it("replaces every used secret value with ***", () => {
    expect(maskSecrets("HTTP 401 for Bearer s3cr3t (s3cr3t)", ["s3cr3t", ""])).toBe("HTTP 401 for Bearer *** (***)");
  });
});

describe("createFetchHttpConnector", () => {
  it("rejects hosts outside the allow list without calling fetch, and non-http schemes", async () => {
    const f = fakeFetch(() => json([]));
    const c = createFetchHttpConnector({ allow: ["mes.example.com"], fetch: f });
    await expect(c.request({ method: "GET", url: "https://other.example.com/x", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(c.request({ method: "GET", url: "ftp://mes.example.com/x", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(c.request({ method: "GET", url: "not a url", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    expect(f).not.toHaveBeenCalled();
    const empty = createFetchHttpConnector({ allow: [], fetch: f });
    await expect(empty.request({ method: "GET", url: "https://mes.example.com/x", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
  it("matches host:port entries and passes method, headers, body, redirect manual and a timeout signal", async () => {
    const f = fakeFetch(() => json({ ok: 1 }));
    const c = createFetchHttpConnector({ allow: ["api.local:8080"], fetch: f });
    await expect(c.request({ method: "POST", url: "http://API.local:8080/q", headers: { A: "1" }, body: "{}" }, limits)).resolves.toEqual({ ok: 1 });
    const init = (f as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0][1];
    expect(init).toMatchObject({ method: "POST", headers: { A: "1" }, body: "{}", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("reports HTTP_STATUS for non-2xx including redirects, BAD_JSON for invalid bodies", async () => {
    const c = (r: Response) => createFetchHttpConnector({ allow: ["h"], fetch: fakeFetch(() => r) });
    await expect(c(json({}, 500)).request({ method: "GET", url: "https://h/", headers: {} }, limits)).rejects.toMatchObject({ code: "HTTP_STATUS", message: "HTTP 500" });
    await expect(c(new Response(null, { status: 302, headers: { location: "https://x" } })).request({ method: "GET", url: "https://h/", headers: {} }, limits)).rejects.toMatchObject({ code: "HTTP_STATUS", message: "HTTP 302" });
    await expect(c(new Response("<html>", { status: 200 })).request({ method: "GET", url: "https://h/", headers: {} }, limits)).rejects.toMatchObject({ code: "BAD_JSON" });
  });
  it("stops reading past maxBytes with TOO_LARGE and reports TIMEOUT when the signal fires", async () => {
    const big = createFetchHttpConnector({ allow: ["h"], fetch: fakeFetch(() => new Response("x".repeat(2000), { status: 200 })) });
    await expect(big.request({ method: "GET", url: "https://h/", headers: {} }, { ...limits, maxBytes: 1000 })).rejects.toMatchObject({ code: "TOO_LARGE" });
    const slow = createFetchHttpConnector({ allow: ["h"], fetch: fakeFetch((_u, init) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) });
    await expect(slow.request({ method: "GET", url: "https://h/", headers: {} }, { ...limits, timeoutMs: 20 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("executeDatasets http", () => {
  const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, params: [{ name: "no" }],
    datasets: [{ name: "orders", type: "http", url: "https://mes.example.com/o/{{ params.no }}", headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}" }, rowsPath: "data" }] });
  it("runs the request through the connector and applies rowsPath and maxRows", async () => {
    const f = fakeFetch((url) => json({ data: [{ NO: url }, { NO: "2" }] }));
    const connectors = { http: createFetchHttpConnector({ allow: ["mes.example.com"], fetch: f }) };
    const ok = await executeDatasets(report, { params: { no: "A" }, connectors, secrets });
    expect(ok.errors).toEqual([]);
    expect((ok.context.orders as { NO: string }).NO).toBe("https://mes.example.com/o/A");
    const capped = await executeDatasets(report, { params: { no: "A" }, connectors, secrets, limits: { maxRows: 1 } });
    expect(capped.errors[0].code).toBe("TOO_MANY_ROWS");
  });
  it("masks secret values in error messages and never puts secrets in the context", async () => {
    const f = fakeFetch(() => { throw new Error("connect failed for Bearer s3cr3t"); });
    const { context, errors } = await executeDatasets(report, { params: { no: "A" }, connectors: { http: createFetchHttpConnector({ allow: ["mes.example.com"], fetch: f }) }, secrets });
    expect(errors[0].message).toContain("***");
    expect(errors[0].message).not.toContain("s3cr3t");
    expect(JSON.stringify(context)).not.toContain("s3cr3t");
    expect(context.secrets).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/datasource test -- http`
Expected: FAIL — export 없음.

- [ ] **Step 3: http.ts 구현**

`packages/datasource/src/http.ts`:
```ts
import { evaluate, interpolate, type HttpDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type HttpConnector, type HttpRequest, type Limits, type SecretResolver } from "./types";

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;
const SECRET_REF_RE = /\bsecrets\.([A-Za-z0-9_]+)/g;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** DAPORT_HTTP_ALLOW: 쉼표 구분 host 또는 host:port. 소문자로 정규화 */
export function parseAllowList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
}

/** 오류 메시지에서 비밀값 문자열을 ***로 바꾼다 */
export function maskSecrets(message: string, values: string[]): string {
  let out = message;
  for (const v of values) if (v !== "") out = out.split(v).join("***");
  return out;
}

/**
 * 데이터셋 정의와 파라미터로 요청을 만든다. URL 템플릿 값은 encodeURIComponent, 헤더·본문은 그대로.
 * secrets는 템플릿에 나오는 이름만 미리 읽어 평탄한 객체로 넣는다(레이아웃 컨텍스트에는 절대 들어가지 않는다)
 */
export function buildHttpRequest(ds: HttpDataset, params: Record<string, unknown>, secrets: SecretResolver): { request: HttpRequest; usedSecrets: string[] } {
  const templates = [ds.url, ...Object.values(ds.headers), ds.body ?? ""];
  const secretObj: Record<string, string> = {};
  for (const t of templates) for (const m of t.matchAll(SECRET_REF_RE)) secretObj[m[1]] = secrets(m[1]) ?? "";
  const tctx = { params, secrets: secretObj };
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const url = ds.url.replace(TEMPLATE_RE, (_m, expr: string) => encodeURIComponent(str(evaluate(expr, tctx))));
  const headers = Object.fromEntries(Object.entries(ds.headers).map(([k, v]) => [k, interpolate(v, tctx)]));
  const request: HttpRequest = { method: ds.method, url, headers };
  if (ds.method === "POST" && ds.body !== undefined) request.body = interpolate(ds.body, tctx);
  return { request, usedSecrets: Object.values(secretObj).filter((v) => v !== "") };
}

/** rowsPath(점 경로)를 따라간 값을 행 배열로. 객체는 [객체], 그 밖은 ROWS_PATH */
export function pickRows(json: unknown, rowsPath: string | undefined): Record<string, unknown>[] {
  let v: unknown = json;
  for (const seg of (rowsPath ?? "").split(".")) {
    if (seg === "") continue;
    if (!isObject(v)) throw new DatasetFailure("ROWS_PATH", `no rows at "${rowsPath}"`);
    v = v[seg];
  }
  if (Array.isArray(v)) {
    if (!v.every(isObject)) throw new DatasetFailure("ROWS_PATH", "rows are not objects");
    return v;
  }
  if (isObject(v)) return [v];
  throw new DatasetFailure("ROWS_PATH", `no rows at "${rowsPath ?? ""}"`);
}

function toFailure(e: unknown, signal: AbortSignal): DatasetFailure {
  if (e instanceof DatasetFailure) return e;
  const name = (e as { name?: string } | null)?.name;
  if (signal.aborted || name === "TimeoutError" || name === "AbortError") return new DatasetFailure("TIMEOUT", "request timed out");
  return new DatasetFailure("HTTP_STATUS", e instanceof Error ? e.message : String(e));
}

/** 응답 본문을 스트림으로 읽으며 maxBytes를 넘으면 중단한다 */
async function readLimited(res: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new DatasetFailure("TOO_LARGE", `response larger than ${maxBytes} bytes`); }
      chunks.push(value);
    }
  } catch (e) {
    throw toFailure(e, signal);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** 전역 fetch 기반 커넥터. 허용 호스트, 리다이렉트 거부, 타임아웃, 응답 크기 한도를 적용한다 */
export function createFetchHttpConnector(opts: { allow: string[]; fetch?: typeof fetch }): HttpConnector {
  const allowed = new Set(opts.allow.map((h) => h.toLowerCase()));
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async request(req, limits) {
      let url: URL;
      try { url = new URL(req.url); } catch { throw new DatasetFailure("HOST_NOT_ALLOWED", `invalid url: ${req.url}`); }
      const okScheme = url.protocol === "http:" || url.protocol === "https:";
      if (!okScheme || !(allowed.has(url.host.toLowerCase()) || allowed.has(url.hostname.toLowerCase()))) {
        throw new DatasetFailure("HOST_NOT_ALLOWED", `host not allowed: ${url.host}`);
      }
      const signal = AbortSignal.timeout(limits.timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, { method: req.method, headers: req.headers, body: req.body, redirect: "manual", signal });
      } catch (e) {
        throw toFailure(e, signal);
      }
      if (!res.ok) throw new DatasetFailure("HTTP_STATUS", `HTTP ${res.status}`);   // 3xx도 manual이라 여기로 온다
      const text = await readLimited(res, limits.maxBytes, signal);
      try { return JSON.parse(text) as unknown; } catch { throw new DatasetFailure("BAD_JSON", "response is not valid JSON"); }
    },
  };
}

export async function runHttp(ds: HttpDataset, params: Record<string, unknown>, connectors: Connectors, secrets: SecretResolver, limits: Limits): Promise<Record<string, unknown>[]> {
  if (!connectors.http) throw new DatasetFailure("HOST_NOT_ALLOWED", "http connector not configured");
  const { request, usedSecrets } = buildHttpRequest(ds, params, secrets);
  try {
    return pickRows(await connectors.http.request(request, limits), ds.rowsPath);
  } catch (e) {
    const message = maskSecrets(e instanceof Error ? e.message : String(e), usedSecrets);
    throw new DatasetFailure(e instanceof DatasetFailure ? e.code : "HTTP_STATUS", message);
  }
}
```

`packages/datasource/src/execute.ts`에서 import 추가 후 http 분기를 바꾼다:
```ts
import { runHttp } from "./http";
// …
    case "http": return runHttp(ds, params, opts.connectors, opts.secrets, limits);
```

`packages/datasource/src/index.ts`에 `export * from "./http";` 추가.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/datasource test && pnpm --filter @daport/datasource typecheck`
Expected: PASS. T8의 "reports unconfigured http/sql" 테스트는 `connectors: {}`라 `HOST_NOT_ALLOWED`가 그대로다.

- [ ] **Step 5: Commit**

```bash
git add packages/datasource/src
git commit -m "feat(datasource): http 커넥터 — 허용 호스트, 리다이렉트 거부, 타임아웃·크기·행 한도, 비밀값 마스킹"
```

---

### Task 13: studio 스토어 트리 탐색 교체, 데이터·반복·보기 상태, sampleContext

**Files:**
- Modify: `apps/studio/src/editor/store.ts`, `apps/studio/src/lib/data.ts`, `apps/studio/src/lib/assets.ts`, `apps/studio/src/editor/canvas/Canvas.tsx`(import 한 줄)
- Test: `apps/studio/src/editor/__tests__/store.test.ts`(추가), `apps/studio/src/lib/__tests__/data.test.ts`(교체), `apps/studio/src/lib/__tests__/assets.test.ts`(신규)

**Interfaces:**
- Consumes: T2 `walkElements`, `childArrays`; T3 `Report.sample`, `Report.repeat`, `Report.datasets`.
- Produces: 공용 규약 studio 절의 스토어 상태·액션, `sampleContext(report)`.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/store.test.ts` 끝에 추가:
```ts
describe("editor store (phase 2)", () => {
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "lots", type: "static", rows: [{ NAME: "L1" }] }], elements: [
    { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
    { id: "cards", type: "repeater", x: 0, y: 20, w: 100, h: 80, source: "lots", item: { w: 50, h: 20, children: [{ id: "nm", type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.NAME }}" }] },
      groups: [{ by: "item.LINE", header: { h: 5, children: [{ id: "gh", type: "rect", x: 0, y: 0, w: 5, h: 5 }] } }] },
  ]});
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(rep); });

  it("finds and updates template children, and reports their parent repeater", () => {
    expect(store.getState().findElement("nm")).toMatchObject({ type: "text" });
    store.getState().updateElement("nm", { w: 30 });
    expect(store.getState().findElement("nm")).toMatchObject({ w: 30 });
    expect(store.getState().findParentRepeater("nm")).toBe("cards");
    expect(store.getState().findParentRepeater("gh")).toBe("cards");
    expect(store.getState().findParentRepeater("a")).toBeUndefined();
    expect(store.getState().allocateId("nm")).toBe("nm-1");
  });
  it("adds into a repeater band, deletes and duplicates template children with fresh ids", () => {
    const el = ElementSchema.parse({ id: "n2", type: "rect", x: 0, y: 0, w: 1, h: 1 });
    store.getState().addElement(el, { into: { repeaterId: "cards", band: "item" } });
    const cards = () => store.getState().findElement("cards") as Extract<Element, { type: "repeater" }>;
    expect(cards().item.children.map((c) => c.id)).toEqual(["nm", "n2"]);
    store.getState().addElement(ElementSchema.parse({ id: "n3", type: "rect", x: 0, y: 0, w: 1, h: 1 }), { into: { repeaterId: "cards", band: "groupHeader", groupIndex: 0 } });
    expect(cards().groups[0].header?.children.map((c) => c.id)).toEqual(["gh", "n3"]);
    store.getState().select(["nm"]);
    store.getState().duplicateSelected();
    expect(cards().item.children.map((c) => c.id)).toEqual(["nm", "nm-1", "n2"]);
    store.getState().select(["nm-1", "n3"]);
    store.getState().deleteSelected();
    expect(cards().item.children.map((c) => c.id)).toEqual(["nm", "n2"]);
    expect(cards().groups[0].header?.children.map((c) => c.id)).toEqual(["gh"]);
    store.getState().select(["cards"]);
    store.getState().duplicateSelected();
    const copy = store.getState().findElement("cards-1") as Extract<Element, { type: "repeater" }>;
    expect(copy.item.children.map((c) => c.id)).toEqual(["nm-1", "n2-1"]);
    expect(store.getState().replaceReport(JSON.parse(JSON.stringify(store.getState().report)))).toBe(true);
  });
  it("sets sample, datasets, params and repeat as undoable edits", () => {
    store.getState().setSample({ params: { no: "A" }, data: { lots: [{ NAME: "S" }] }, capturedAt: "2026-09-17T00:00:00.000Z" });
    expect(store.getState().report.sample?.data).toEqual({ lots: [{ NAME: "S" }] });
    expect(store.getState().dirty).toBe(true);
    store.getState().setRepeat({ source: "lots", as: "record" });
    expect(store.getState().report.repeat).toEqual({ source: "lots", as: "record" });
    store.getState().setRepeat(undefined);
    expect(store.getState().report.repeat).toBeUndefined();
    store.getState().setDatasets([...store.getState().report.datasets, { name: "o", type: "http", url: "https://x", method: "GET", headers: {} }]);
    expect(store.getState().report.datasets).toHaveLength(2);
    store.getState().setParams([{ name: "no", type: "string", required: true }]);
    expect(store.getState().report.params[0].name).toBe("no");
    store.getState().undo(); store.getState().undo(); store.getState().undo(); store.getState().undo();
    expect(store.getState().report.sample?.params).toEqual({ no: "A" });
    store.getState().undo();
    expect(store.getState().report.sample).toBeUndefined();
  });
  it("keeps view and liveData outside history", () => {
    expect(store.getState().view).toEqual({ copyIndex: 0, pageInCopy: 0 });
    store.getState().setView({ pageInCopy: 2 });
    expect(store.getState().view).toEqual({ copyIndex: 0, pageInCopy: 2 });
    store.getState().setLiveData(true);
    expect(store.getState().liveData).toBe(true);
    expect(store.getState().dirty).toBe(false);
    store.getState().undo();
    expect(store.getState().view.pageInCopy).toBe(2);
  });
});
```
(파일 상단의 import에 `describe, it, expect, beforeEach`와 `parseReport, ElementSchema, type Element`가 이미 있다.)

`apps/studio/src/lib/__tests__/data.test.ts` 전체 교체:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { sampleParams, sampleContext } from "../data";

const base = { id: "r", version: 1, page: { width: 10, height: 10 } };
const report = parseReport({ ...base, params: [
  { name: "lot", type: "string", required: true },
  { name: "qty", type: "number" },
  { name: "dt", type: "date", default: "2026-09-16" },
]});

describe("sampleParams", () => {
  it("uses the default, 0 for numbers and {name} otherwise", () => {
    expect(sampleParams(report)).toEqual({ lot: "{lot}", qty: 0, dt: "2026-09-16" });
  });
});

describe("sampleContext", () => {
  it("falls back to sampleParams and static rows without a sample", () => {
    const r = parseReport({ ...base, params: [{ name: "qty", type: "number", default: "5" }], datasets: [
      { name: "s", type: "static", rows: [{ A: 1 }] }, { name: "h", type: "http", url: "https://x" }] });
    const ctx = sampleContext(r);
    expect(ctx.params).toEqual({ qty: 5 });
    expect((ctx.s as { A: number }).A).toBe(1);
    expect(ctx.h).toEqual([]);
  });
  it("prefers sample params (merged over placeholders) and sample data, and includes data-only names", () => {
    const r = parseReport({ ...base, params: [{ name: "lot" }, { name: "qty", type: "number" }], datasets: [{ name: "s", type: "static", rows: [{ A: 1 }] }],
      sample: { params: { lot: "L9" }, data: { s: [{ A: 2 }], extra: { X: 1 }, junk: "x" }, capturedAt: "2026-09-17T00:00:00.000Z" } });
    const ctx = sampleContext(r);
    expect(ctx.params).toEqual({ lot: "L9", qty: 0 });
    expect((ctx.s as { A: number }).A).toBe(2);
    expect(ctx.extra).toEqual([{ X: 1 }]);
    expect(ctx.junk).toEqual([]);
  });
});
```

`apps/studio/src/lib/__tests__/assets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { resolveAssetUrls } from "../assets";

describe("resolveAssetUrls", () => {
  it("rewrites asset:// in groups and repeater templates without touching the input", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, elements: [
      { id: "i", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://a" },
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "i2", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://b" }] },
      { id: "rp", type: "repeater", x: 0, y: 0, w: 1, h: 1, source: "s", item: { w: 1, h: 1, children: [{ id: "i3", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://c" }] },
        groups: [{ by: "item.k", footer: { h: 1, children: [{ id: "i4", type: "image", x: 0, y: 0, w: 1, h: 1, src: "http://keep" }] } }] },
    ]});
    const out = resolveAssetUrls(r, "https://o");
    const srcs: string[] = [];
    const walk = (els: typeof out.elements) => { for (const e of els) { if (e.type === "image") srcs.push(e.src); if (e.type === "group") walk(e.children); if (e.type === "repeater") { walk(e.item.children); for (const g of e.groups) { if (g.header) walk(g.header.children); if (g.footer) walk(g.footer.children); } } } };
    walk(out.elements);
    expect(srcs).toEqual(["https://o/api/assets/a", "https://o/api/assets/b", "https://o/api/assets/c", "http://keep"]);
    expect((r.elements[0] as { src: string }).src).toBe("asset://a");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- store data assets`
Expected: FAIL — `findParentRepeater`, `setSample` 등 없음, `sampleContext` 없음, 템플릿 안 asset 미변환.

- [ ] **Step 3: store.ts 교체**

`apps/studio/src/editor/store.ts` 전체:
```ts
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import { safeParseReport, walkElements, childArrays, collectIds, type Report, type Element, type Page } from "@daport/core";
import { createHistory, commit, undo, redo, type History } from "./history";

export type Problem = { path: string; message: string };
export type View = { copyIndex: number; pageInCopy: number };
export type BandTarget = { repeaterId: string; band: "item" | "groupHeader" | "groupFooter"; groupIndex?: number };

export type EditorState = {
  history: History<Report>;
  report: Report;
  selection: string[];
  problems: Problem[];
  dirty: boolean;
  mode: "design" | "preview";
  /** 캔버스가 보이는 부·페이지. 히스토리 밖 */
  view: View;
  /** 미리보기·PDF에 sample.data를 보내지 않고 서버 데이터셋을 실행한다. 히스토리 밖 */
  liveData: boolean;
  // queries
  findElement(id: string): Element | undefined;
  allocateId(base: string): string;   // 트리 전체에서 비어 있는 `${base}-n`
  findParentRepeater(id: string): string | undefined;   // id가 어떤 repeater 템플릿(항목·그룹 밴드) 안에 있으면 그 repeater id
  // mutations
  select(ids: string[]): void;
  toggleSelect(id: string): void;
  updateElement(id: string, patch: Partial<Element>): void;
  moveSelected(dx: number, dy: number): void;
  resizeElement(id: string, box: { x: number; y: number; w: number; h: number }): void;
  addElement(el: Element, opts?: { into?: BandTarget }): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  updatePage(patch: Partial<Page>): void;
  replaceReport(candidate: unknown): boolean;
  undo(): void;
  redo(): void;
  setMode(m: "design" | "preview"): void;
  /** saved는 저장 요청에 실어 보낸 모델이다. 요청 중에 편집이 있었으면(참조가 다르면) dirty로 남긴다 */
  markSaved(saved: Report): void;
  setView(v: Partial<View>): void;
  setLiveData(v: boolean): void;
  setSample(sample: Report["sample"]): void;
  setDatasets(datasets: Report["datasets"]): void;
  setParams(params: Report["params"]): void;
  setRepeat(repeat: Report["repeat"] | undefined): void;
};

function newId(base: string, report: Report): string {
  const ids = collectIds(report.elements);
  let n = 1; let id = `${base}-${n}`;
  while (ids.has(id)) { n++; id = `${base}-${n}`; }
  return id;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * 선의 경계 상자. 선의 x/y는 시작점이고 x2/y2는 끝점이라, 오른쪽→왼쪽·아래→위로 그린 선은 x/y가 상자의 왼쪽·위가 아니다.
 * 요소(그룹 상대좌표)와 layout 결과(절대좌표) 모두에 쓴다
 */
export function lineBox(l: { x: number; y: number; x2: number; y2: number }): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(l.x, l.x2), y: Math.min(l.y, l.y2), w: Math.abs(l.x2 - l.x), h: Math.abs(l.y2 - l.y) };
}

/**
 * 한 축의 끝점 좌표 p를 옛 구간 [from, from+size]에서 새 구간 [to, to+nsize]로 비례해 옮긴다. 선의 끝점은 늘 구간 끝에 있으므로
 * 왼쪽(위) 끝점은 새 왼쪽(위) 끝에 남아 방향이 유지된다. 길이 0인 축(가로선의 높이 등)은 비율이 없으므로 끝점을 제자리에 두되
 * 새 구간 안으로만 당긴다. 그래야 가로선의 n/s 핸들이 선을 기울이거나 한쪽 핸들만 선을 옮기지 않는다
 */
function mapAxis(p: number, from: number, size: number, to: number, nsize: number): number {
  return size === 0 ? Math.min(Math.max(p, to), to + nsize) : to + ((p - from) / size) * nsize;
}

/** repeater 밴드의 자식 배열. 없으면 최상위 elements (잘못된 대상이면 조용히 최상위에 넣는다) */
function bandOf(r: Report, into: BandTarget): Element[] {
  let found: Element[] | undefined;
  walkElements(r.elements, (el) => {
    if (el.id !== into.repeaterId || el.type !== "repeater") return;
    const g = el.groups[into.groupIndex ?? 0];
    found = into.band === "item" ? el.item.children : into.band === "groupHeader" ? g?.header?.children : g?.footer?.children;
    return true;
  });
  return found ?? r.elements;
}

export function createEditorStore(initial: Report) {
  return createStore<EditorState>((set, get) => {
    const apply = (mutate: (r: Report) => void) => {
      // 선의 w/h는 끝점에서 정해진다. X2·Y2 편집(패널·JSON)이나 추가·교체 뒤에도 선택 상자와 그린 선이 어긋나지 않게 모든 편집 뒤에 맞춘다
      const h = commit(get().history, (r) => {
        mutate(r);
        walkElements(r.elements, (el) => { if (el.type === "line") { const b = lineBox(el); el.w = round(b.w); el.h = round(b.h); } });
      });
      if (h !== get().history) set({ history: h, report: h.present, dirty: true, problems: [] });
    };
    const pruneSelection = () => set({ selection: get().selection.filter((id) => !!get().findElement(id)) });
    const travel = (step: (h: History<Report>) => History<Report>) => {
      const h = step(get().history);
      if (h === get().history) return;   // 되돌릴 것이 없으면 dirty를 바꾸지 않는다
      // 편집기 텍스트가 스토어 텍스트로 바뀌므로 이전 텍스트의 검증 오류는 더 이상 맞지 않는다
      set({ history: h, report: h.present, dirty: true, problems: [] });
      pruneSelection();
    };
    return {
      history: createHistory(initial), report: initial, selection: [], problems: [], dirty: false, mode: "design",
      view: { copyIndex: 0, pageInCopy: 0 }, liveData: false,
      findElement: (id) => { let found: Element | undefined; walkElements(get().report.elements, (el) => { if (el.id === id) { found = el; return true; } }); return found; },
      allocateId: (base) => newId(base, get().report),
      findParentRepeater: (id) => {
        let found: string | undefined;
        walkElements(get().report.elements, (el, _p, _i, ancestors) => { if (el.id === id) { found = ancestors.find((a) => a.type === "repeater")?.id; return true; } });
        return found;
      },
      select: (ids) => set({ selection: ids }),
      toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
      updateElement: (id, patch) => apply((r) => { walkElements(r.elements, (el) => { if (el.id === id) { Object.assign(el, patch); return true; } }); }),
      moveSelected: (dx, dy) => apply((r) => { const sel = new Set(get().selection); walkElements(r.elements, (el) => {
        if (sel.has(el.id)) { el.x = round(el.x + dx); el.y = round(el.y + dy); if (el.type === "line") { el.x2 = round(el.x2 + dx); el.y2 = round(el.y2 + dy); } } }); }),
      // box는 새 경계 상자다. 선은 두 끝점을 옛 상자에서 새 상자로 옮기고 w/h는 apply가 끝점에서 다시 계산한다
      resizeElement: (id, box) => apply((r) => { walkElements(r.elements, (el) => { if (el.id !== id) return;
        if (el.type === "line") {
          const old = lineBox(el);
          el.x = round(mapAxis(el.x, old.x, old.w, box.x, box.w)); el.x2 = round(mapAxis(el.x2, old.x, old.w, box.x, box.w));
          el.y = round(mapAxis(el.y, old.y, old.h, box.y, box.h)); el.y2 = round(mapAxis(el.y2, old.y, old.h, box.y, box.h));
          return true;
        }
        el.x = round(box.x); el.y = round(box.y); el.w = round(box.w); el.h = round(box.h); return true; }); }),
      addElement: (el, opts) => { apply((r) => { (opts?.into ? bandOf(r, opts.into) : r.elements).push(el); }); set({ selection: [el.id] }); },
      duplicateSelected: () => {
        const ids: string[] = [];
        apply((r) => {
          const sel = new Set(get().selection);
          const used = collectIds(r.elements);
          const alloc = (base: string) => { let n = 1; while (used.has(`${base}-${n}`)) n++; used.add(`${base}-${n}`); return `${base}-${n}`; };
          // 복사본은 원본과 같은 부모 배열(그룹 자식·반복 영역 템플릿 포함)의 바로 뒤에 넣는다. 자식의 x/y는 부모 기준이라 최상위로 옮기면 위치가 틀어진다
          const inserts: { parent: Element[]; idx: number; copy: Element }[] = [];
          walkElements(r.elements, (el, parent, idx) => {
            if (!sel.has(el.id)) return;
            const c = structuredClone(el) as Element;
            c.id = alloc(el.id); c.x = round(c.x + 5); c.y = round(c.y + 5);
            if (c.type === "line") { c.x2 = round(c.x2 + 5); c.y2 = round(c.y2 + 5); }
            for (const arr of childArrays(c)) walkElements(arr, (d) => { d.id = alloc(d.id); });   // 복사한 자손도 새 id (중복 id는 검증 실패)
            ids.push(c.id); inserts.push({ parent, idx, copy: c });
          });
          // 같은 부모 안에서는 뒤쪽 인덱스부터 넣어야 앞쪽 인덱스가 밀리지 않는다 (walk는 부모마다 인덱스 오름차순으로 방문)
          for (const { parent, idx, copy } of inserts.reverse()) parent.splice(idx + 1, 0, copy);
        });
        set({ selection: ids });
      },
      deleteSelected: () => {
        apply((r) => {
          const sel = new Set(get().selection);
          const prune = (els: Element[]) => { for (let i = els.length - 1; i >= 0; i--) { if (sel.has(els[i].id)) els.splice(i, 1); else for (const arr of childArrays(els[i])) prune(arr); } };
          prune(r.elements);
        });
        set({ selection: [] });
      },
      updatePage: (patch) => apply((r) => { Object.assign(r.page, patch); }),
      replaceReport: (candidate) => {
        const res = safeParseReport(candidate);
        if (!res.success) { set({ problems: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }); return false; }
        // 저장 URL이 id로 정해지므로 id를 바꾸면 다른 레포트를 덮어쓴다
        if (res.data.id !== initial.id) { set({ problems: [{ path: "id", message: "id는 바꿀 수 없습니다" }] }); return false; }
        // 모델이 그대로여도(잘못 고친 값을 원래대로 되돌린 경우) 텍스트는 이제 올바르므로 오류를 지운다. apply는 바뀔 때만 지운다
        set({ problems: [] });
        apply((r) => { Object.assign(r, res.data); for (const k of Object.keys(r)) if (!(k in res.data)) delete (r as any)[k]; });
        pruneSelection();
        return true;
      },
      undo: () => travel(undo),
      redo: () => travel(redo),
      setMode: (mode) => set({ mode }),
      markSaved: (saved) => set({ dirty: get().report !== saved }),   // 커밋·undo·redo는 늘 새 객체를 만든다
      setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
      setLiveData: (liveData) => set({ liveData }),
      setSample: (sample) => apply((r) => { if (sample) r.sample = sample; else delete r.sample; }),
      setDatasets: (datasets) => apply((r) => { r.datasets = datasets; }),
      setParams: (params) => apply((r) => { r.params = params; }),
      setRepeat: (repeat) => apply((r) => { if (repeat) r.repeat = repeat; else delete r.repeat; }),
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;
export const EditorContext = createContext<EditorStore | null>(null);
export function useEditor<T>(selector: (s: EditorState) => T): T {
  const store = useContext(EditorContext);
  if (!store) throw new Error("EditorContext missing");
  return useStore(store, selector);
}
```

- [ ] **Step 4: data.ts, assets.ts, Canvas import 수정**

`apps/studio/src/lib/data.ts` 전체:
```ts
import { resolveParams, rowsProxy, type Report, type DataContext } from "@daport/core";

/** 편집용 파라미터 값: 기본값, 없으면 숫자는 0, 그 밖은 `{이름}` */
export function sampleParams(report: Report): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of report.params) params[p.name] = p.default ?? (p.type === "number" ? 0 : `{${p.name}}`);
  return params;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const asRows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : isObject(v) ? [v] : []);

/**
 * 캔버스가 그리는 컨텍스트 (스펙 7.4). sample.params를 자리표시 값 위에 얹고, sample.data가 있으면 그 행, 없으면 static 행,
 * 그 밖은 빈 배열. sample.data에만 있는 이름도 넣는다. 필수 파라미터가 비어도 캔버스는 그려야 하므로 검사하지 않는다
 */
export function sampleContext(report: Report): DataContext {
  const params = resolveParams(report, { ...sampleParams(report), ...report.sample?.params }, { checkRequired: false });
  const ctx: DataContext = { params };
  const data = report.sample?.data ?? {};
  for (const ds of report.datasets) ctx[ds.name] = rowsProxy(Object.hasOwn(data, ds.name) ? asRows(data[ds.name]) : ds.type === "static" ? ds.rows : []);
  for (const [name, v] of Object.entries(data)) if (!(name in ctx)) ctx[name] = rowsProxy(asRows(v));
  return ctx;
}
```

`apps/studio/src/lib/assets.ts` 전체:
```ts
import { walkElements, type Report } from "@daport/core";

/** asset://id를 studio의 /api/assets/id로 바꾼 복제본. 그룹·반복 영역 템플릿 자식까지 */
export function resolveAssetUrls(report: Report, baseUrl: string): Report {
  const clone = structuredClone(report);
  walkElements(clone.elements, (el) => {
    if (el.type === "image" && el.src.startsWith("asset://")) el.src = `${baseUrl}/api/assets/${el.src.slice("asset://".length)}`;
  });
  return clone;
}
```

`apps/studio/src/editor/canvas/Canvas.tsx`에서 `import { resolveDataSync } from "@/lib/data";`를 `import { sampleContext } from "@/lib/data";`로, `const data = useMemo(() => resolveDataSync(report), [report]);`를 `const data = useMemo(() => sampleContext(report), [report]);`로 바꾼다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS (기존 store·Canvas·panels 테스트 포함).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): 스토어 트리 탐색을 core walkElements로, 데이터·반복·보기 상태 액션, sampleContext"
```

---
## 웨이브 3

### Task 14: renderer 페이지 조립 (흐름·clip·repeat·번호·상한·instance)

**Files:**
- Modify: `packages/renderer/src/layout/layout.ts` (전체 교체), `packages/renderer/src/paint/Paint.tsx`(key·data 속성), `packages/renderer/src/__tests__/layout.test.ts`(placeholder 테스트 1개 수정)
- Test: `packages/renderer/src/__tests__/layout-phase2.test.ts`, `packages/renderer/src/__tests__/paint.test.tsx`(1개 추가); 골든 스냅샷 갱신

**Interfaces:**
- Consumes: T6 `LayoutLimitError`, `MAX_PAGES`, `createMeasureCache`; T7 `paginate`; T10 `tableFlow`; T11 `repeaterFlow`, `placeStatic`, `isVisible`, `errorItem`, `flowBoxItem`, `paintFlowPage`, `paintClipped`.
- Produces: `layout(report, data, opts?: { maxPages?: number }): Page[]` — 스펙 5.3 그대로. 1단계 시그니처 호환.

- [ ] **Step 1: 실패 테스트 작성**

`packages/renderer/src/__tests__/layout-phase2.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { LayoutLimitError } from "../layout/errors";

const page = { width: 100, height: 100, margin: [5, 5, 5, 5] as [number, number, number, number] };
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const table = (extra: Record<string, unknown> = {}) => ({ id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }], ...extra });
const mk = (elements: unknown[], extra: Record<string, unknown> = {}) => parseReport({ id: "r", version: 1, page, elements, ...extra });
const ids = (items: { elementId: string }[]) => items.map((i) => i.elementId);
const cells = (items: { role?: string; instance?: string }[]) => items.filter((i) => i.role === "cell").map((i) => i.instance);
const textOf = (items: { kind: string; elementId: string; lines?: string[] }[], id: string) => (items.find((i) => i.elementId === id && i.kind === "text") as { lines: string[] }).lines.join("");

describe("layout (phase 2)", () => {
  it("splits a long table across pages: 3 rows in the first region, then page.height - margin.bottom - y", () => {
    const pages = layout(mk([table()]), { params: {}, items: rows(20) });
    expect(pages.map((p) => [p.index, p.copyIndex, p.pageInCopy])).toEqual([[0, 0, 0], [1, 0, 1], [2, 0, 2]]);
    expect(cells(pages[0].items)).toEqual(["t#h", "t#0", "t#1", "t#2"]);
    expect(cells(pages[1].items).length).toBe(12);                       // 머리 + 11행
    expect(cells(pages[2].items)).toEqual(["t#h", "t#14", "t#15", "t#16", "t#17", "t#18", "t#19"]);
    expect(pages[0].items[0]).toMatchObject({ kind: "rect", role: "flowBox", elementId: "t", x: 5, y: 20, w: 60, h: 30 });
    expect(pages[0].items.find((i) => i.instance === "t#0")).toMatchObject({ y: 27 });   // 20 + 머리 7
  });
  it("places fixed elements by flow: once on the first page, every on all, last on the last, with page/total", () => {
    const pages = layout(mk([table(),
      { id: "once", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "every", type: "pageNumber", x: 0, y: 90, w: 30, h: 5, flow: "every" },
      { id: "last", type: "text", x: 0, y: 0, w: 10, h: 5, value: "끝", flow: "last" },
    ]), { params: {}, items: rows(20) });
    expect(ids(pages[0].items).filter((i) => i !== "t")).toEqual(["once", "every"]);
    expect(ids(pages[1].items).filter((i) => i !== "t")).toEqual(["every"]);
    expect(ids(pages[2].items).filter((i) => i !== "t")).toEqual(["every", "last"]);
    expect(textOf(pages[1].items, "every")).toBe("2 / 3");
  });
  it("ignores the flow value of a continue table and omits it on pages beyond its own", () => {
    const pages = layout(mk([table({ flow: "last" }), { id: "cards", type: "repeater", x: 5, y: 60, w: 60, h: 30, source: "lots", layout: "list",
      item: { w: 60, h: 25, children: [{ id: "nm", type: "text", x: 0, y: 0, w: 20, h: 5, value: "{{ item.N }}" }] } }]), { params: {}, items: rows(20), lots: rows(2) });
    expect(pages).toHaveLength(3);
    expect(ids(pages[0].items)).toContain("cards");
    expect(pages[0].items.filter((i) => i.elementId === "nm").map((i) => i.instance)).toEqual(["cards#0"]);   // 30mm 영역에 25mm 항목 하나
    expect(pages[1].items.filter((i) => i.elementId === "nm").map((i) => i.instance)).toEqual(["cards#1"]);
    expect(ids(pages[2].items)).not.toContain("cards");
    expect(ids(pages[2].items)).toContain("t");
  });
  it("repeat: one copy per record with page/total per copy and sheet/sheets/copy/copies overall", () => {
    const r = mk([table({ source: "record.items" }), { id: "pn", type: "pageNumber", x: 0, y: 90, w: 60, h: 5, flow: "every", format: "{{ page }}/{{ total }} {{ sheet }}/{{ sheets }} {{ copy }}/{{ copies }} {{ record.NO }}" }],
      { repeat: { source: "ships" } });
    const pages = layout(r, { params: {}, ships: [{ NO: "A", items: rows(5) }, { NO: "B", items: rows(1) }] });
    expect(pages.map((p) => [p.index, p.copyIndex, p.pageInCopy])).toEqual([[0, 0, 0], [1, 0, 1], [2, 1, 0]]);
    expect(pages.map((p) => textOf(p.items, "pn"))).toEqual(["1/2 1/3 1/2 A", "2/2 2/3 1/2 A", "1/1 3/3 2/2 B"]);
    expect(cells(pages[2].items)).toEqual(["t#h", "t#0"]);
  });
  it("repeat with zero records: one page with #NODATA at the margin corner and record undefined", () => {
    const pages = layout(mk([{ id: "v", type: "text", x: 0, y: 0, w: 10, h: 5, value: "[{{ record.NO }}]" }], { repeat: { source: "ships" } }), { params: {}, ships: [] });
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ kind: "text", elementId: "__nodata", x: 5, y: 5, lines: ["#NODATA"] });
    expect(textOf(pages[0].items, "v")).toBe("[]");
  });
  it("repeat source error: #ERR item in blank mode, throws in fail mode", () => {
    const bad = mk([], { repeat: { source: "ships." } });
    expect(layout(bad, { params: {} })[0].items[0]).toMatchObject({ elementId: "__repeat", lines: ["#ERR"], error: expect.stringContaining("Expression") });
    expect(() => layout({ ...bad, onExpressionError: "fail" }, { params: {} })).toThrow();
  });
  it("source error or non-array on a flow element becomes one #ERR item in its place (blank) or throws (fail)", () => {
    const pages = layout(mk([table({ source: "items[0]" }), { id: "ok", type: "rect", x: 0, y: 0, w: 1, h: 1 }]), { params: {}, items: rows(2) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ elementId: "t", lines: ["#ERR"], x: 5, y: 20, error: expect.stringContaining("not an array") });
    expect(ids(pages[0].items)).toEqual(["t", "ok"]);
    expect(() => layout(mk([table({ source: "items[0]" })], { onExpressionError: "fail" }), { params: {}, items: rows(2) })).toThrow();
  });
  it("skips a hidden flow element and one whose ancestor group is hidden", () => {
    const pages = layout(mk([table({ visible: "false" }), { id: "g", type: "group", x: 0, y: 0, w: 100, h: 100, visible: "{{ 1 == 2 }}", children: [table({ id: "t2" })] }]), { params: {}, items: rows(20) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toEqual([]);
  });
  it("clip table: fixed element following flow rules, first region only, flowBox clipped", () => {
    const pages = layout(mk([table({ overflow: "clip", flow: "every" }), table({ id: "t2", overflow: "clip", source: "items[.N < 2]" })]), { params: {}, items: rows(20) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ role: "flowBox", elementId: "t", clipped: true });
    expect(cells(pages[0].items).filter((i) => i!.startsWith("t#"))).toEqual(["t#h", "t#0", "t#1", "t#2"]);
    expect(pages[0].items.find((i) => i.elementId === "t2" && i.role === "flowBox")?.clipped).toBeUndefined();
  });
  it("marks overflow on the flowBox when a block is taller than an empty page", () => {
    const pages = layout(mk([table({ rowHeight: 200 })]), { params: {}, items: rows(2) });
    expect(pages).toHaveLength(2);
    expect(pages[0].items[0]).toMatchObject({ role: "flowBox", overflow: true });
  });
  it("throws LayoutLimitError above maxPages (default 2000) before painting", () => {
    expect(() => layout(mk([table()], {}), { params: {}, items: rows(100) }, { maxPages: 2 })).toThrow(LayoutLimitError);
    const many = mk([], { repeat: { source: "ships" } });
    expect(() => layout(many, { params: {}, ships: Array.from({ length: 2001 }, () => ({})) })).toThrow(LayoutLimitError);
    expect(layout(many, { params: {}, ships: Array.from({ length: 2000 }, () => ({})) })).toHaveLength(2000);
  });
  it("keeps a report without flow elements identical to phase 1 except copyIndex/pageInCopy", () => {
    const pages = layout(mk([{ id: "t", type: "text", x: 5, y: 5, w: 40, h: 10, value: "고객: {{ order.NAME }}" }]), { params: {}, order: { NAME: "ACME" } });
    expect(pages).toEqual([{ index: 0, width: 100, height: 100, copyIndex: 0, pageInCopy: 0, items: [expect.objectContaining({ kind: "text", lines: ["고객: ACME"] })] }]);
  });
});
```

`packages/renderer/src/__tests__/layout.test.ts`의 "keeps declared-only types as placeholders" 테스트를 바꾼다(표는 이제 실제로 그려진다):
```ts
  it("keeps barcode/ref as placeholders and draws a table as a flowBox", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
      { id: "c", type: "ref", x: 0, y: 0, w: 10, h: 5, ref: "hdr" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items.map((i) => i.kind)).toEqual(["placeholder", "rect", "placeholder"]);
    expect(items[1]).toMatchObject({ role: "flowBox", elementId: "t" });
  });
```

`packages/renderer/src/__tests__/paint.test.tsx`에 추가:
```ts
  it("renders repeated instances with unique keys and data-instance/data-role attributes", () => {
    const r = parseReport({ id: "rp", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "cards", type: "repeater", x: 0, y: 0, w: 100, h: 100, source: "lots", item: { w: 50, h: 10, children: [{ id: "nm", type: "text", x: 0, y: 0, w: 20, h: 5, value: "{{ item.N }}" }] } },
    ]});
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(<PaintPages pages={layout(r, { params: {}, lots: [{ N: 1 }, { N: 2 }] })} />);
      expect(html).toContain('data-instance="cards#0"');
      expect(html).toContain('data-instance="cards#1"');
      expect(html).toContain('data-role="flowBox"');
      expect(html).toContain('data-role="template"');
      expect(warn).not.toHaveBeenCalled();   // 중복 key 경고 없음
    } finally {
      warn.mockRestore();
    }
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/renderer test -- layout paint`
Expected: FAIL — 표가 placeholder, 페이지 1장, `copyIndex`만 있음.

- [ ] **Step 3: layout.ts 교체**

`packages/renderer/src/layout/layout.ts` 전체:
```ts
import { evaluateSource, ExpressionError, StyleSchema, type Report, type DataContext, type Style } from "@daport/core";
import { flatten, type FlatElement } from "./flatten";
import { placeStatic, isVisible, errorItem } from "./place";
import { LayoutLimitError, MAX_PAGES } from "./errors";
import type { Page, PlacedItem, PlacedText } from "./types";
import { lineHeightMm } from "../text/measure";
import { createMeasureCache } from "../text/cache";
import { paginate } from "../flow/paginate";
import { tableFlow } from "../flow/table";
import { repeaterFlow } from "../flow/repeater";
import { flowBoxItem, paintFlowPage, paintClipped } from "../flow/paint";
import type { FlowOptions, FlowPage, PageFlowContext, Region } from "../flow/types";

type FlowEl = Extract<FlatElement, { type: "table" | "repeater" }>;
/** 부(copy) 하나의 계획. flows는 흐름 요소 → 나눠진 페이지들 또는 #ERR 항목 */
type CopyPlan = { ctx: DataContext; flows: Map<FlatElement, FlowPage[] | PlacedItem>; nPages: number; extra: PlacedItem[] };

const DEFAULT_STYLE: Style = StyleSchema.parse({});
const isContinueFlow = (el: FlatElement): el is FlowEl => (el.type === "table" || el.type === "repeater") && el.overflow === "continue";

function flowVisible(flow: "once" | "every" | "last", p: number, n: number): boolean {
  return flow === "every" || (flow === "once" ? p === 0 : p === n - 1);
}

function regions(el: FlowEl, report: Report): { first: Region; next: Region } {
  const first = { x: el.x, y: el.y, w: el.w, h: el.h };
  return { first, next: { ...first, h: report.page.height - report.page.margin[2] - el.y } };
}

/** 여백 좌상단의 안내 항목 (#NODATA, repeat 소스 #ERR) */
function marginItem(report: Report, id: string, text: string, error?: string): PlacedText {
  const item: PlacedText = { kind: "text", elementId: id, x: report.page.margin[3], y: report.page.margin[0], w: 60, h: 8, style: DEFAULT_STYLE,
    lines: [text], lineHeight: lineHeightMm(DEFAULT_STYLE.fontSize, DEFAULT_STYLE.lineHeight), overflow: false };
  if (error) item.error = error;
  return item;
}

/** 요소와 조상 그룹의 visible. 오류는 blank 모드에서 #ERR 항목, fail 모드에서 던진다 */
function visibility(el: FlatElement, ctx: DataContext, mode: "blank" | "fail"): boolean | PlacedItem {
  try { return el.ancestorsVisible.every((v) => isVisible(v, ctx)) && isVisible(el.visible, ctx); }
  catch (e) { if (!(e instanceof ExpressionError) || mode === "fail") throw e; return errorItem(el, e.message); }
}

/** overflow "clip" 반복 영역: 첫 영역에 들어가는 조각까지만 */
function paintClippedRepeater(el: Extract<FlatElement, { type: "repeater" }>, ctx: DataContext, opts: FlowOptions, pageCtx: PageFlowContext): PlacedItem[] {
  let input: ReturnType<typeof repeaterFlow>;
  try { input = repeaterFlow(el, ctx, opts); }
  catch (e) { if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e; return [errorItem(el, e.message)]; }
  const region = { x: el.x, y: el.y, w: el.w, h: el.h };
  const [page] = paginate(input, { first: region, next: region, repeatHeader: false, clip: true });
  return [flowBoxItem(el, { clipped: page.truncated, overflow: page.overflow }), ...paintFlowPage(page, { x: el.x, y: el.y }, pageCtx)];
}

/**
 * 순수 레이아웃 (스펙 5.3).
 * 1단계: 부마다 흐름 요소(continue 표·반복 영역)를 paginate하고 부의 페이지 수 = max(요소별 페이지 수, 1)을 정한다.
 * 2단계: 전체 페이지 수(sheets)가 정해진 뒤 페이지마다 고정 요소(flow 규칙)와 흐름 조각을 칠한다.
 * 페이지 상한을 넘으면 LayoutLimitError. 표현식 오류 격리는 1단계 규칙(onExpressionError)과 같다
 */
export function layout(report: Report, data: DataContext, opts: { maxPages?: number } = {}): Page[] {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const mode = report.onExpressionError;
  const fopts: FlowOptions = { measure: createMeasureCache(), onExpressionError: mode };
  const flat = flatten(report.elements);

  // 부 목록: repeat 없으면 1부(record 없음), 0건이면 #NODATA 1부
  let records: unknown[] | undefined;
  let repeatError: PlacedItem | undefined;
  if (report.repeat) {
    try { records = evaluateSource(report.repeat.source, data); }
    catch (e) { if (!(e instanceof ExpressionError) || mode === "fail") throw e; repeatError = marginItem(report, "__repeat", "#ERR", e.message); }
  }
  const copies: { record?: unknown; nodata?: boolean }[] =
    records === undefined ? [{}] : records.length === 0 ? [{ nodata: true }] : records.map((record) => ({ record }));

  // 1단계: 흐름 요소를 나누고 부의 페이지 수를 정한다
  const plans: CopyPlan[] = [];
  let total = 0;
  copies.forEach((c, ci) => {
    const ctx: DataContext = report.repeat ? { ...data, [report.repeat.as]: c.record } : data;
    const flows = new Map<FlatElement, FlowPage[] | PlacedItem>();
    let nPages = 1;
    for (const el of flat) {
      if (!isContinueFlow(el)) continue;
      const vis = visibility(el, ctx, mode);
      if (vis === false) continue;
      if (vis !== true) { flows.set(el, vis); continue; }
      try {
        const input = el.type === "table" ? tableFlow(el, ctx, fopts) : repeaterFlow(el, ctx, fopts);
        const pages = paginate(input, { ...regions(el, report), repeatHeader: el.type === "table" ? el.repeatHeader : false, clip: false });
        if (total + pages.length > maxPages) throw new LayoutLimitError(total + pages.length, maxPages);
        flows.set(el, pages);
        nPages = Math.max(nPages, pages.length);
      } catch (e) {
        if (!(e instanceof ExpressionError) || mode === "fail") throw e;
        flows.set(el, errorItem(el, e.message));   // 소스 오류·배열 아님: 흐름 요소 전체를 #ERR 한 칸
      }
    }
    total += nPages;
    if (total > maxPages) throw new LayoutLimitError(total, maxPages);
    const extra: PlacedItem[] = [];
    if (c.nodata) extra.push(marginItem(report, "__nodata", "#NODATA"));
    if (repeatError && ci === 0) extra.push(repeatError);
    plans.push({ ctx, flows, nPages, extra });
  });

  // 2단계: sheets가 정해졌으니 칠한다
  const pages: Page[] = [];
  plans.forEach((plan, ci) => {
    for (let p = 0; p < plan.nPages; p++) {
      const pageCtx: PageFlowContext = { page: p + 1, total: plan.nPages, sheet: pages.length + 1, sheets: total, copy: ci + 1, copies: plans.length, pageRows: [] };
      const ctx: DataContext = { ...plan.ctx, ...pageCtx };
      const items: PlacedItem[] = p === 0 ? [...plan.extra] : [];
      for (const el of flat) {
        const flow = plan.flows.get(el);
        if (flow) {
          if (!Array.isArray(flow)) { if (p === 0) items.push(flow); continue; }   // #ERR 항목은 첫 페이지에만
          const fp = flow[p];
          if (!fp) continue;                                                       // 이 요소의 페이지가 더 짧으면 그 뒤 페이지에는 없다
          items.push(flowBoxItem(el, { overflow: fp.overflow }), ...paintFlowPage(fp, { x: el.x, y: el.y }, pageCtx));
          continue;
        }
        if (isContinueFlow(el)) continue;                                          // 숨긴 흐름 요소
        if (!flowVisible(el.flow, p, plan.nPages)) continue;
        if (el.type === "table" || el.type === "repeater") {                       // clip: 고정 요소처럼 flow 규칙, 첫 영역만
          const vis = visibility(el, ctx, mode);
          if (vis === false) continue;
          if (vis !== true) { items.push(vis); continue; }
          items.push(...(el.type === "table" ? paintClipped(el, ctx, fopts, pageCtx) : paintClippedRepeater(el, ctx, fopts, pageCtx)));
          continue;
        }
        items.push(...placeStatic(el, ctx, { onExpressionError: mode }));
      }
      pages.push({ index: pages.length, width: report.page.width, height: report.page.height, items, copyIndex: ci, pageInCopy: p });
    }
  });
  return pages;
}
```

- [ ] **Step 4: Paint.tsx 수정**

`packages/renderer/src/paint/Paint.tsx`에서 `common`과 `PaintPage`를 바꾼다:
```tsx
  const common = { className: cls, "data-element-id": item.elementId, "data-instance": item.instance, "data-role": item.role, title: item.error } as const;
```
```tsx
export function PaintPage({ page }: { page: Page }) {
  return (
    <div className="dp-page" data-page-index={page.index}>
      {page.items.map((it, n) => <Item key={`${it.elementId}|${it.instance ?? ""}|${n}`} item={it} />)}
    </div>
  );
}
```
(`data-instance`·`data-role`가 `undefined`면 React가 속성을 내지 않는다.)

- [ ] **Step 5: 통과 확인과 골든 갱신**

Run: `pnpm --filter @daport/renderer test -- -u golden && pnpm --filter @daport/renderer test && pnpm typecheck`
Expected: PASS. 골든 스냅샷 diff에서 `results-table`이 placeholder에서 `flowBox` rect + 머리·3행의 셀·테두리 항목으로 바뀌고, 페이지 수는 1이어야 한다. studio·pdf typecheck도 통과해야 한다(`Page` 필드 추가는 T6에서 이미 반영).

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src
git commit -m "feat(renderer): 페이지 조립 — 흐름 요소 나누기, clip, repeat 부·번호, 페이지 상한, 인스턴스 표시"
```

---

### Task 15: studio 요청 본문 한도, runDatasets, preview/pdf data, sample 라우트

**Files:**
- Create: `apps/studio/src/lib/body.ts`, `apps/studio/src/lib/datasets.ts`, `apps/studio/src/app/api/reports/[id]/sample/route.ts`
- Modify: `apps/studio/src/app/api/reports/[id]/preview/route.ts`, `apps/studio/src/app/api/reports/[id]/pdf/route.ts`, `apps/studio/package.json`(`@daport/datasource` 의존), `apps/studio/.env.example`
- Test: `apps/studio/src/lib/__tests__/body.test.ts`, `apps/studio/src/lib/__tests__/datasets.test.ts`, `apps/studio/src/app/api/reports/__tests__/sample-route.test.ts`, `preview-route.test.ts`·`pdf-route.test.ts`(추가)

**Interfaces:**
- Consumes: T8·T9·T12 `executeDatasets`, `createFetchHttpConnector`, `parseAllowList`, `envSecrets`, `DatasetError`; T5 `inferFields`; T6 `LayoutLimitError`.
- Produces: `readJsonBody`, `MAX_BODY_BYTES`, `runDatasets`, `POST /api/reports/:id/sample`, preview·pdf의 `data` 처리와 400 `{ error, datasetErrors }` / `{ error, code: "LAYOUT_LIMIT" }` / 413.

- [ ] **Step 1: 의존성 추가**

`apps/studio/package.json`의 `dependencies`에 `"@daport/datasource": "workspace:*",`를 `@daport/core` 다음에 넣고 `pnpm install`. `apps/studio/.env.example`에 두 줄 추가:
```
DAPORT_HTTP_ALLOW=mes.example.com,api.local:8080
DAPORT_SECRET_MES_TOKEN=
```

- [ ] **Step 2: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/body.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readJsonBody } from "../body";

const req = (body: string | null, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });

describe("readJsonBody", () => {
  it("parses an object, treats empty and null as {}, rejects non-objects and bad JSON with 400", async () => {
    expect(await readJsonBody(req('{"a":1}'), 100)).toEqual({ ok: true, body: { a: 1 } });
    expect(await readJsonBody(req(null), 100)).toEqual({ ok: true, body: {} });
    expect(await readJsonBody(req("null"), 100)).toEqual({ ok: true, body: {} });
    for (const bad of ["5", '"s"', "[1]", "{oops"]) {
      const r = await readJsonBody(req(bad), 100);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(400);
    }
  });
  it("returns 413 from content-length or from bytes actually read", async () => {
    // fetch의 Request는 content-length를 직접 못 넣을 수 있어 헤더만 가진 객체로 선검사를 본다
    const byHeader = await readJsonBody({ headers: new Headers({ "content-length": "999" }), body: null } as unknown as Request, 100);
    if (!byHeader.ok) expect(byHeader.response.status).toBe(413); else throw new Error("expected 413");
    const byBytes = await readJsonBody(req(JSON.stringify({ s: "x".repeat(200) })), 100);
    if (!byBytes.ok) expect(byBytes.response.status).toBe(413); else throw new Error("expected 413");
  });
});
```

`apps/studio/src/lib/__tests__/datasets.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseReport } from "@daport/core";
import { runDatasets } from "../datasets";

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, datasets: [
  { name: "s", type: "static", rows: [{ A: 1 }] }, { name: "h", type: "http", url: "https://mes.example.com/x" }] });

afterEach(() => vi.unstubAllEnvs());

describe("runDatasets", () => {
  it("runs static datasets and blocks http hosts not in DAPORT_HTTP_ALLOW", async () => {
    vi.stubEnv("DAPORT_HTTP_ALLOW", "");
    const { context, errors } = await runDatasets(report, {});
    expect((context.s as { A: number }).A).toBe(1);
    expect(errors).toEqual([{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: mes.example.com" }]);
  });
  it("prefers request data", async () => {
    const { context, errors } = await runDatasets(report, { data: { h: [{ B: 2 }] } });
    expect(errors).toEqual([]);
    expect((context.h as { B: number }).B).toBe(2);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/sample-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { POST } from "../[id]/sample/route";
import { SAMPLE_ROWS } from "@/lib/datasets";

const report = { id: "qc", version: 1, page: { width: 100, height: 100 }, params: [{ name: "no", required: true }], datasets: [
  { name: "items", type: "static", rows: Array.from({ length: 250 }, (_, i) => ({ N: i, DT: "2026-09-17" })) },
  { name: "h", type: "http", url: "https://nope.example.com/x" },
]};
const call = (body: unknown) => POST(new Request("http://localhost/api/reports/qc/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "qc" }) });

describe("POST /api/reports/[id]/sample", () => {
  it("returns the first 200 rows per dataset, inferred fields, dataset errors and capturedAt", async () => {
    const res = await call({ report, params: { no: "A" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(SAMPLE_ROWS);
    expect(json.fields.items).toEqual([{ name: "N", path: "N", type: "number" }, { name: "DT", path: "DT", type: "date" }]);
    expect(json.data.h).toBeUndefined();
    expect(json.errors).toEqual([{ dataset: "h", code: "HOST_NOT_ALLOWED", message: expect.any(String) }]);
    expect(typeof json.capturedAt).toBe("string");
  });
  it("returns 400 for a missing required param and 404 for an unknown stored report", async () => {
    expect((await call({ report, params: {} })).status).toBe(400);
    expect((await call({ params: {} })).status).toBe(404);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/preview-route.test.ts`에 추가:
```ts
  it("uses request data instead of running datasets, and reports dataset errors as 400 with datasetErrors", async () => {
    const report = { id: "qc", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "h", type: "http", url: "https://nope.example.com/x" }],
      elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "{{ h.NAME }}" }] };
    const ok = await call({ report, params: {}, data: { h: [{ NAME: "from-data" }] } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("from-data");
    const bad = await call({ report, params: {} });
    expect(bad.status).toBe(400);
    expect((await bad.json()).datasetErrors[0]).toMatchObject({ dataset: "h", code: "HOST_NOT_ALLOWED" });
  });
  it("returns 400 LAYOUT_LIMIT above the page limit and 413 for an oversized body", async () => {
    const report = { id: "qc", version: 1, page: { width: 100, height: 100 }, repeat: { source: "ships" } };
    const limit = await call({ report, params: {}, data: { ships: Array.from({ length: 2001 }, () => ({})) } });
    expect(limit.status).toBe(400);
    expect((await limit.json()).code).toBe("LAYOUT_LIMIT");
    // 실제 21MB 본문으로 읽은 바이트 검사를 지난다 (content-length 선검사는 body.test.ts가 본다)
    const big = await POST(new Request("http://localhost/api/reports/qc/preview", { method: "POST", headers: { "content-type": "application/json" }, body: `{"pad":"${"x".repeat(21 * 1024 * 1024)}"}` }), { params: Promise.resolve({ id: "qc" }) });
    expect(big.status).toBe(413);
  });
```

`apps/studio/src/app/api/reports/__tests__/pdf-route.test.ts`에 추가:
```ts
  it("passes request data to the renderer and returns 400 with datasetErrors when a dataset fails", async () => {
    renderPdf.mockResolvedValue(Buffer.from("%PDF-"));
    const withDs = { ...report, datasets: [{ name: "h", type: "http", url: "https://nope.example.com/x" }] };
    expect((await call({ report: withDs, params: { lot: "L1" }, data: { h: [{ A: 1 }] } })).status).toBe(200);
    expect((renderPdf.mock.calls[0][1] as { h: { A: number } }).h.A).toBe(1);
    const bad = await call({ report: withDs, params: { lot: "L1" } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).datasetErrors).toHaveLength(1);
  });
  it("maps LayoutLimitError to 400 LAYOUT_LIMIT", async () => {
    const { LayoutLimitError } = await import("@daport/renderer");
    renderPdf.mockRejectedValue(new LayoutLimitError(2001));
    const res = await call({ report, params: { lot: "L1" } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("LAYOUT_LIMIT");
  });
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter studio test -- body datasets sample preview pdf`
Expected: FAIL — 모듈 없음, 라우트가 `data`를 무시.

- [ ] **Step 4: body.ts, datasets.ts 구현**

`apps/studio/src/lib/body.ts`:
```ts
import { NextResponse } from "next/server";

export const MAX_BODY_BYTES = 20 * 1024 * 1024;   // 스펙 6.5

type Parsed = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };
const fail = (status: number, error: string): Parsed => ({ ok: false, response: NextResponse.json({ error }, { status }) });

/**
 * JSON 객체 본문을 읽는다. content-length 선검사와 읽은 바이트 검사로 413, 구문 오류·객체 아님은 400.
 * 빈 본문과 JSON null은 {}로 본다 (1단계 라우트와 같은 규칙)
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<Parsed> {
  const tooLarge = () => fail(413, `요청 본문이 ${maxBytes} 바이트를 넘습니다`);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return tooLarge(); }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    text = new TextDecoder().decode(all);
  }
  let parsed: unknown = {};
  if (text.trim() !== "") {
    try { parsed = JSON.parse(text); } catch { return fail(400, "요청 본문이 올바른 JSON이 아닙니다"); }
  }
  if (parsed === null) parsed = {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "요청 본문은 JSON 객체여야 합니다");
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** 본문의 선택 객체 필드. 객체가 아니면 undefined */
export function objectField(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = body[key];
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
```

`apps/studio/src/lib/datasets.ts`:
```ts
import type { Report, DataContext } from "@daport/core";
import { executeDatasets, createFetchHttpConnector, parseAllowList, envSecrets, type DatasetError } from "@daport/datasource";

/** 데이터셋마다 샘플로 저장하는 앞 행 수 (스펙 4.6) */
export const SAMPLE_ROWS = 200;

/** 서버 전용. 환경변수의 허용 호스트·비밀값으로 데이터셋을 실행한다. SQL 커넥터는 이후 단계 */
export function runDatasets(report: Report, input: { params?: Record<string, unknown>; data?: Record<string, unknown> }): Promise<{ context: DataContext; errors: DatasetError[] }> {
  return executeDatasets(report, {
    params: input.params ?? {},
    data: input.data,
    connectors: { http: createFetchHttpConnector({ allow: parseAllowList(process.env.DAPORT_HTTP_ALLOW) }) },
    secrets: envSecrets(),
  });
}
```

- [ ] **Step 5: 라우트 교체**

`apps/studio/src/app/api/reports/[id]/preview/route.ts` 전체:
```ts
import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { renderToHtml, LayoutLimitError } from "@daport/renderer";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  try {
    await ready();
    const report = body.report ? parseReport(body.report) : await getStore().get(id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    const origin = new URL(req.url).origin;
    // 요청 data가 있으면 그 데이터셋은 실행하지 않는다 (편집 중 미리보기는 sample.data를 보낸다)
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    const html = renderToHtml(resolveAssetUrls(report, origin), context, { fontBaseUrl: `${origin}/fonts` });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    if (e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`apps/studio/src/app/api/reports/[id]/pdf/route.ts`에서 본문 읽기·데이터 부분을 바꾼다 (contentDisposition·fail·maxDuration은 그대로):
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, ExpressionError, type Report, type DataContext } from "@daport/core";
import { LayoutLimitError } from "@daport/renderer";
import { renderPdf } from "@daport/pdf";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";

export const maxDuration = 60;

const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** RFC 6266/5987: filename에는 ASCII 대체 이름, 한글 이름은 filename*에 UTF-8 퍼센트 인코딩으로 넣는다 */
function contentDisposition(report: Report): string {
  const ascii = `${report.id.replace(/[^\w.-]/g, "_")}.pdf`;
  const utf8 = encodeURIComponent(`${report.name || report.id}.pdf`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  // 스펙 10장: 모델 검증·파라미터·표현식·데이터셋·페이지 상한 오류는 요청 문제(400), 렌더 실패(Chromium 크래시 1회 재시도 후)는 500
  let report: Report | null;
  try {
    await ready();
    report = body.report ? parseReport(body.report) : await getStore().get(id);
  } catch (e) {
    return fail(e, e instanceof ZodError ? 400 : 500);
  }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

  let data: DataContext;
  try {
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    data = context;
  } catch (e) {
    return fail(e, 400);   // 필수 파라미터 누락
  }

  try {
    const origin = new URL(req.url).origin;
    const pdf = await renderPdf(resolveAssetUrls(report, origin), data);
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": contentDisposition(report) } });
  } catch (e) {
    if (e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, e instanceof ExpressionError ? 400 : 500);
  }
}
```

`apps/studio/src/app/api/reports/[id]/sample/route.ts`:
```ts
import { NextResponse } from "next/server";
import { parseReport, inferFields, type FieldNode } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets, SAMPLE_ROWS } from "@/lib/datasets";

// Next는 route.ts의 export를 HTTP 메서드·설정으로 제한하므로 상수는 lib/datasets.ts에 둔다

/** 샘플 가져오기 (스펙 7.5). 성공한 데이터셋만 data·fields에 담고, 실패는 errors로 돌려준다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  try {
    await ready();
    const report = body.report ? parseReport(body.report) : await getStore().get(id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params") });
    const data: Record<string, unknown[]> = {};
    const fields: Record<string, FieldNode[]> = {};
    for (const ds of report.datasets) {
      const rows = context[ds.name];
      if (!Array.isArray(rows)) continue;
      data[ds.name] = rows.slice(0, SAMPLE_ROWS);
      fields[ds.name] = inferFields(data[ds.name]);
    }
    return NextResponse.json({ data, fields, errors, capturedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS (1단계 preview·pdf 테스트 포함. `call(null)`은 `{}` → 404, `call(5)`는 400).

- [ ] **Step 7: Commit**

```bash
git add apps/studio pnpm-lock.yaml
git commit -m "feat(studio): 요청 본문 한도, 데이터셋 실행(runDatasets), preview/pdf 요청 data 우선, sample 라우트"
```

---

### Task 16: studio 데이터 패널, 데이터셋 편집기, 필드 트리, 샘플 가져오기

**Files:**
- Create: `apps/studio/src/editor/data/bindings.ts`(타입·DRAG_MIME·sourceDataset만), `apps/studio/src/editor/data/FieldTree.tsx`, `apps/studio/src/editor/data/DatasetEditor.tsx`, `apps/studio/src/editor/data/DataPanel.tsx`
- Modify: `apps/studio/src/editor/Editor.tsx` (왼쪽 패널 탭: 요소 | 데이터)
- Test: `apps/studio/src/editor/data/__tests__/FieldTree.test.tsx`, `apps/studio/src/editor/data/__tests__/DatasetEditor.test.tsx`, `apps/studio/src/editor/data/__tests__/DataPanel.test.tsx`

**Interfaces:**
- Consumes: T5 `inferFields`, `FieldNode`, `FieldType`; T13 `setSample`, `setDatasets`, `setParams`; T15 `POST /api/reports/:id/sample` 응답.
- Produces:
  ```ts
  // bindings.ts (T20이 resolveDrop을 더한다)
  export const DRAG_MIME = "application/x-daport-field";
  export type DragField = { dataset: string; path: string; type: FieldType; isArray: boolean; children?: FieldNode[] };
  export function sourceDataset(source: string): string | undefined;
  // FieldTree.tsx
  export function FieldTree({ dataset, nodes }: { dataset: string; nodes: FieldNode[] }): JSX.Element;   // 노드 <li draggable data-path>. dragstart에 DRAG_MIME JSON
  // DatasetEditor.tsx
  export function DatasetEditor({ dataset, onChange, onRemove }: { dataset: Dataset; onChange: (ds: Dataset) => void; onRemove: () => void }): JSX.Element;
  // DataPanel.tsx
  export function DataPanel({ reportId }: { reportId: string }): JSX.Element;
  ```

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/data/__tests__/FieldTree.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { FieldTree } from "../FieldTree";
import { DRAG_MIME } from "../bindings";

afterEach(cleanup);

const nodes = [
  { name: "NO", path: "NO", type: "string" as const },
  { name: "items", path: "items", type: "array" as const, children: [{ name: "QTY", path: "items.QTY", type: "number" as const }] },
];

describe("FieldTree", () => {
  it("renders nested nodes with type markers and toggles children", () => {
    const { getByText, queryByText } = render(<FieldTree dataset="orders" nodes={nodes} />);
    expect(getByText("NO")).toBeTruthy();
    expect(getByText("QTY")).toBeTruthy();                       // 첫 단계는 펼쳐져 있다
    fireEvent.click(getByText("items"));
    expect(queryByText("QTY")).toBeNull();
  });
  it("puts a DragField JSON on dragstart", () => {
    const { getByText } = render(<FieldTree dataset="orders" nodes={nodes} />);
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: "" };
    fireEvent.dragStart(getByText("QTY"), { dataTransfer });
    expect(JSON.parse(data[DRAG_MIME])).toEqual({ dataset: "orders", path: "items.QTY", type: "number", isArray: false });
    fireEvent.dragStart(getByText("items"), { dataTransfer });
    expect(JSON.parse(data[DRAG_MIME])).toMatchObject({ path: "items", type: "array", isArray: true, children: [{ name: "QTY" }] });
    fireEvent.dragStart(getByText("orders"), { dataTransfer });                       // 루트 노드 = 데이터셋 자체
    expect(JSON.parse(data[DRAG_MIME])).toMatchObject({ dataset: "orders", path: "", type: "array", isArray: true, children: [{ name: "NO" }, { name: "items" }] });
  });
  it("shows the root with a hint when there are no fields", () => {
    const { getByText } = render(<FieldTree dataset="empty" nodes={[]} />);
    expect(getByText("empty")).toBeTruthy();
    expect(getByText(/필드 없음/)).toBeTruthy();
  });
});
```

`apps/studio/src/editor/data/__tests__/DatasetEditor.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { DatasetEditor } from "../DatasetEditor";

afterEach(cleanup);

describe("DatasetEditor", () => {
  it("static: commits valid JSON object arrays and shows an error otherwise", () => {
    const onChange = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(<DatasetEditor dataset={{ name: "s", type: "static", rows: [{ A: 1 }] }} onChange={onChange} onRemove={() => {}} />);
    const ta = getByLabelText("행(JSON)") as HTMLTextAreaElement;
    expect(ta.value).toContain('"A": 1');
    fireEvent.change(ta, { target: { value: "[{\"A\": 2}]" } });
    expect(onChange).toHaveBeenLastCalledWith({ name: "s", type: "static", rows: [{ A: 2 }] });
    fireEvent.change(ta, { target: { value: "[1]" } });
    expect(getByText(/객체 배열/)).toBeTruthy();
    fireEvent.change(ta, { target: { value: "{" } });
    expect(getByText(/JSON/)).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(getByLabelText("이름"), { target: { value: "s2" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "s2" }));
    expect(queryByText("커넥터 미설정")).toBeNull();
  });
  it("http: edits method, url, headers (Key: value lines), body only for POST, rowsPath", () => {
    const onChange = vi.fn();
    const ds = { name: "o", type: "http" as const, method: "GET" as const, url: "https://x", headers: { A: "1" } };
    const { getByLabelText, queryByLabelText, rerender } = render(<DatasetEditor dataset={ds} onChange={onChange} onRemove={() => {}} />);
    expect((getByLabelText("헤더") as HTMLTextAreaElement).value).toBe("A: 1");
    expect(queryByLabelText("본문")).toBeNull();
    fireEvent.change(getByLabelText("method"), { target: { value: "POST" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...ds, method: "POST" });
    rerender(<DatasetEditor dataset={{ ...ds, method: "POST" }} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(getByLabelText("본문"), { target: { value: "{}" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...ds, method: "POST", body: "{}" });
    fireEvent.change(getByLabelText("헤더"), { target: { value: "Authorization: Bearer {{ secrets.T }}\nX: y" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { Authorization: "Bearer {{ secrets.T }}", X: "y" } }));
    fireEvent.change(getByLabelText("rowsPath"), { target: { value: "data.items" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rowsPath: "data.items" }));
  });
  it("sql: read-only notice, remove button calls onRemove", () => {
    const onRemove = vi.fn();
    const { getByText, getByRole } = render(<DatasetEditor dataset={{ name: "q", type: "sql", connection: "mes", query: "SELECT 1" }} onChange={() => {}} onRemove={onRemove} />);
    expect(getByText(/커넥터 미설정/)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "삭제" }));
    expect(onRemove).toHaveBeenCalled();
  });
});
```

`apps/studio/src/editor/data/__tests__/DataPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { DataPanel } from "../DataPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, params: [{ name: "no", type: "string" }],
  datasets: [{ name: "items", type: "static", rows: [{ N: 1, DT: "2026-09-17" }] }] });

function setup() {
  const store = createEditorStore(report);
  const utils = render(<EditorContext.Provider value={store}><DataPanel reportId="r" /></EditorContext.Provider>);
  return { store, ...utils };
}

describe("DataPanel", () => {
  beforeEach(() => { vi.spyOn(globalThis, "fetch"); });

  it("lists params with sample values, datasets, and a field tree from static rows", () => {
    const { getByLabelText, getByText, store } = setup();
    fireEvent.change(getByLabelText("no"), { target: { value: "A-1" } });
    expect(store.getState().report.sample?.params).toEqual({ no: "A-1" });
    expect(getByText("items")).toBeTruthy();
    expect(getByText("DT")).toBeTruthy();
  });
  it("adds and removes datasets through the store", () => {
    const { getByRole, getAllByRole, store } = setup();
    fireEvent.click(getByRole("button", { name: "+ static" }));
    expect(store.getState().report.datasets.map((d) => [d.name, d.type])).toEqual([["items", "static"], ["dataset-1", "static"]]);
    fireEvent.click(getByRole("button", { name: "+ http" }));
    expect(store.getState().report.datasets[2]).toMatchObject({ type: "http", name: "dataset-2", method: "GET" });
    fireEvent.click(getAllByRole("button", { name: "삭제" })[0]);
    expect(store.getState().report.datasets.map((d) => d.name)).toEqual(["dataset-1", "dataset-2"]);
  });
  it("fetches a sample, stores data/params as one undoable edit, and shows dataset errors", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({
      data: { items: [{ N: 9, DT: "2026-01-01" }] }, fields: { items: [{ name: "N", path: "N", type: "number" }] },
      errors: [{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: x" }], capturedAt: "2026-09-17T00:00:00.000Z" }), { status: 200 }));
    const { getByRole, getByText, store } = setup();
    store.getState().setSample({ params: { no: "Z" }, data: {}, capturedAt: "2026-01-01T00:00:00.000Z" });
    const before = store.getState().history.past.length;
    fireEvent.click(getByRole("button", { name: "샘플 가져오기" }));
    await waitFor(() => expect(store.getState().report.sample?.data).toEqual({ items: [{ N: 9, DT: "2026-01-01" }] }));
    expect(store.getState().report.sample?.params).toEqual({ no: "Z" });
    expect(store.getState().history.past.length).toBe(before + 1);
    expect(getByText(/HOST_NOT_ALLOWED/)).toBeTruthy();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/reports/r/sample");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ params: { no: "Z" }, report: { id: "r" } });
  });
  it("shows the HTTP error message when the sample request fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ error: "missing required param: no" }), { status: 400 }));
    const { getByRole, findByText } = setup();
    fireEvent.click(getByRole("button", { name: "샘플 가져오기" }));
    expect(await findByText(/missing required param/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- data/`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: bindings.ts(부분), FieldTree.tsx 작성**

`apps/studio/src/editor/data/bindings.ts` (T20이 `resolveDrop`을 이 파일에 더한다):
```ts
import type { FieldNode, FieldType } from "@daport/core";

export const DRAG_MIME = "application/x-daport-field";
/** 필드 트리에서 끄는 항목. children은 배열 노드일 때 원소 필드(표 생성용) */
export type DragField = { dataset: string; path: string; type: FieldType; isArray: boolean; children?: FieldNode[] };

/** 소스 표현식의 루트 식별자. `items` → items, `items[.A == 1]` → items, `record.items` → undefined(레코드 상대), `a.b` → undefined */
export function sourceDataset(source: string): string | undefined {
  const m = source.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(\s*\[.*)?$/s);
  return m ? m[1] : undefined;
}
```

`apps/studio/src/editor/data/FieldTree.tsx`:
```tsx
"use client";
import { useState, type DragEvent } from "react";
import type { FieldNode } from "@daport/core";
import { DRAG_MIME, type DragField } from "./bindings";

const MARK: Record<FieldNode["type"], string> = { string: "T", number: "#", boolean: "✓", date: "◷", object: "{}", array: "[]", null: "∅" };

function Node({ dataset, node, depth }: { dataset: string; node: FieldNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);   // 루트(데이터셋)와 그 필드까지 펼쳐 둔다
  const hasChildren = !!node.children?.length;
  const onDragStart = (e: DragEvent) => {
    const field: DragField = { dataset, path: node.path, type: node.type, isArray: node.type === "array" };
    if (node.type === "array" && node.children) field.children = node.children;
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(field));
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <li>
      <div draggable data-path={node.path} onDragStart={onDragStart} onClick={() => hasChildren && setOpen(!open)}
        className="flex items-center gap-1 text-xs px-1 py-0.5 rounded cursor-grab hover:bg-neutral-100" style={{ paddingLeft: depth * 12 + 4 }}>
        <span className="w-5 text-neutral-400 font-mono">{MARK[node.type]}</span>
        <span>{node.name}</span>
        {hasChildren && <span className="text-neutral-400">{open ? "▾" : "▸"}</span>}
      </div>
      {hasChildren && open && <ul>{node.children!.map((c) => <Node key={c.path} dataset={dataset} node={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

/**
 * 데이터셋 하나의 필드 트리. 루트 노드는 데이터셋 자체(path "", array)라 캔버스에 끌면 표가 된다.
 * 각 노드는 캔버스·표·반복 영역으로 끌 수 있다
 */
export function FieldTree({ dataset, nodes }: { dataset: string; nodes: FieldNode[] }) {
  const root: FieldNode = { name: dataset, path: "", type: "array", children: nodes };
  return (
    <ul data-testid={`fields-${dataset}`}>
      <Node dataset={dataset} node={root} depth={0} />
      {nodes.length === 0 && <li className="text-xs text-neutral-400 px-1">필드 없음 (샘플을 가져오세요)</li>}
    </ul>
  );
}
```

- [ ] **Step 4: DatasetEditor.tsx 작성**

`apps/studio/src/editor/data/DatasetEditor.tsx`:
```tsx
"use client";
import { useState } from "react";
import type { Dataset } from "@daport/core";
import { TextField, SelectField } from "../panels/Field";

const isObject = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
const headersToText = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n");
const textToHeaders = (t: string) => Object.fromEntries(t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(":"); return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

function StaticRows({ rows, onChange }: { rows: Record<string, unknown>[]; onChange: (rows: Record<string, unknown>[]) => void }) {
  // 입력 중인 텍스트는 로컬로 두고 올바른 객체 배열일 때만 커밋한다 (깨진 JSON이 스토어에 들어가지 않게)
  const [text, setText] = useState(() => JSON.stringify(rows, null, 2));
  const [error, setError] = useState<string | null>(null);
  const change = (v: string) => {
    setText(v);
    let parsed: unknown;
    try { parsed = JSON.parse(v); } catch (e) { setError(`JSON 구문 오류: ${(e as Error).message}`); return; }
    if (!Array.isArray(parsed) || !parsed.every(isObject)) { setError("객체 배열이어야 합니다"); return; }
    setError(null);
    onChange(parsed as Record<string, unknown>[]);
  };
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-neutral-500">행(JSON)</span>
      <textarea aria-label="행(JSON)" value={text} rows={6} className="border rounded px-1 py-0.5 font-mono" onChange={(e) => change(e.target.value)} />
      {error && <span className="text-red-700">{error}</span>}
    </label>
  );
}

/** 데이터셋 하나의 편집 폼 (스펙 7.1). sql은 커넥터가 없어 JSON 편집기에서만 고친다 */
export function DatasetEditor({ dataset, onChange, onRemove }: { dataset: Dataset; onChange: (ds: Dataset) => void; onRemove: () => void }) {
  const set = (patch: Partial<Dataset>) => onChange({ ...dataset, ...patch } as Dataset);
  return (
    <div className="border rounded p-2 flex flex-col gap-1" data-testid={`dataset-${dataset.name}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-neutral-500">{dataset.type}</span>
        <div className="flex-1" />
        <button className="text-xs text-red-700" onClick={onRemove}>삭제</button>
      </div>
      <TextField label="이름" value={dataset.name} onChange={(name) => set({ name })} />
      {dataset.type === "static" && <StaticRows key={dataset.name} rows={dataset.rows} onChange={(rows) => set({ rows })} />}
      {dataset.type === "http" && <>
        <SelectField label="method" value={dataset.method} options={["GET", "POST"]} onChange={(method) => set({ method })} />
        <TextField label="url" value={dataset.url} onChange={(url) => set({ url })} />
        <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">헤더</span>
          <textarea aria-label="헤더" rows={2} className="border rounded px-1 py-0.5 font-mono" value={headersToText(dataset.headers)} onChange={(e) => set({ headers: textToHeaders(e.target.value) })} /></label>
        {dataset.method === "POST" && <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">본문</span>
          <textarea aria-label="본문" rows={2} className="border rounded px-1 py-0.5 font-mono" value={dataset.body ?? ""} onChange={(e) => set({ body: e.target.value })} /></label>}
        <TextField label="rowsPath" value={dataset.rowsPath ?? ""} onChange={(v) => set({ rowsPath: v || undefined })} />
      </>}
      {dataset.type === "sql" && <div className="text-xs text-neutral-500">커넥터 미설정 — connection·query는 JSON 편집기에서 수정합니다</div>}
    </div>
  );
}
```

- [ ] **Step 5: DataPanel.tsx 작성, Editor.tsx 탭**

`apps/studio/src/editor/data/DataPanel.tsx`:
```tsx
"use client";
import { useState } from "react";
import { inferFields, type Dataset, type FieldNode } from "@daport/core";
import { useEditor } from "../store";

/** sample 라우트의 오류 항목. 클라이언트 번들이 @daport/datasource를 끌어오지 않도록 여기서 모양만 적는다 (T15와 같은 레인이 아니다) */
type DatasetError = { dataset: string; code: string; message: string };
import { TextField } from "../panels/Field";
import { DatasetEditor } from "./DatasetEditor";
import { FieldTree } from "./FieldTree";

type SampleResponse = { data: Record<string, unknown[]>; fields: Record<string, FieldNode[]>; errors: DatasetError[]; capturedAt: string };

function newDatasetName(datasets: Dataset[]): string {
  let n = 1; while (datasets.some((d) => d.name === `dataset-${n}`)) n++;
  return `dataset-${n}`;
}

/** 파라미터 샘플 값, 데이터셋 목록, 샘플 가져오기, 필드 트리 (스펙 7.1) */
export function DataPanel({ reportId }: { reportId: string }) {
  const report = useEditor((s) => s.report);
  const setSample = useEditor((s) => s.setSample);
  const setDatasets = useEditor((s) => s.setDatasets);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<DatasetError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const sample = report.sample;
  const sampleParams = sample?.params ?? {};

  const setParam = (name: string, value: string) =>
    setSample({ params: { ...sampleParams, [name]: value }, data: sample?.data ?? {}, capturedAt: sample?.capturedAt ?? new Date(0).toISOString() });
  const replaceDataset = (i: number, ds: Dataset) => setDatasets(report.datasets.map((d, k) => (k === i ? ds : d)));
  const removeDataset = (i: number) => setDatasets(report.datasets.filter((_, k) => k !== i));
  const add = (type: "static" | "http") => {
    const name = newDatasetName(report.datasets);
    setDatasets([...report.datasets, type === "static" ? { name, type, rows: [] } : { name, type, url: "", method: "GET", headers: {} }]);
  };
  const fetchSample = async () => {
    setBusy(true); setFailure(null);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/sample`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, params: sampleParams }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) { setFailure(typeof body?.error === "string" ? body.error : `샘플 가져오기 실패 (HTTP ${r.status})`); return; }
      const res = body as SampleResponse;
      // 성공한 데이터셋만 덮어쓴다(실패한 것은 이전 샘플 유지). 되돌리기 한 단위
      setSample({ params: sampleParams, data: { ...(sample?.data ?? {}), ...res.data }, capturedAt: res.capturedAt });
      setErrors(res.errors);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const rowsFor = (ds: Dataset): unknown => sample?.data?.[ds.name] ?? (ds.type === "static" ? ds.rows : []);
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div className="p-3 flex flex-col gap-3">
      <section className="flex flex-col gap-1">
        <div className="text-xs font-semibold">파라미터</div>
        {report.params.length === 0 && <div className="text-xs text-neutral-400">없음 (JSON 편집기에서 params를 추가)</div>}
        {report.params.map((p) => <TextField key={p.name} label={p.name} value={String(sampleParams[p.name] ?? "")} onChange={(v) => setParam(p.name, v)} />)}
      </section>
      <section className="flex flex-col gap-1">
        <div className="text-xs font-semibold">데이터셋</div>
        {report.datasets.map((ds, i) => <DatasetEditor key={i} dataset={ds} onChange={(d) => replaceDataset(i, d)} onRemove={() => removeDataset(i)} />)}
        <div className="flex gap-1">
          <button className={btn} onClick={() => add("static")}>+ static</button>
          <button className={btn} onClick={() => add("http")}>+ http</button>
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <button className={btn} disabled={busy} onClick={fetchSample} data-testid="fetch-sample">샘플 가져오기</button>
        {sample?.capturedAt && <div className="text-xs text-neutral-400">{sample.capturedAt}</div>}
        {failure && <div className="text-xs text-red-700">{failure}</div>}
        {errors.map((e) => <div key={e.dataset} className="text-xs text-red-700">{e.dataset}: {e.code} — {e.message}</div>)}
      </section>
      <section className="flex flex-col gap-2">
        <div className="text-xs font-semibold">필드</div>
        {report.datasets.map((ds) => <FieldTree key={ds.name} dataset={ds.name} nodes={inferFields(rowsFor(ds))} />)}
      </section>
    </div>
  );
}
```

`apps/studio/src/editor/Editor.tsx`에서 왼쪽 aside를 탭으로 바꾼다. import에 `import { DataPanel } from "./data/DataPanel";`를 더하고 `Editor` 함수 안에 `const [tab, setTab] = useState<"elements" | "data">("elements");`를 추가한 뒤 aside를:
```tsx
          <aside className="border-r bg-white overflow-auto flex flex-col">
            <div className="flex border-b text-xs">
              {(["elements", "data"] as const).map((t) => (
                <button key={t} className={`flex-1 py-1 ${tab === t ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setTab(t)}>{t === "elements" ? "요소" : "데이터"}</button>
              ))}
            </div>
            {tab === "elements" ? <ElementPalette /> : <DataPanel reportId={initial.id} />}
          </aside>
```
그리고 grid 열 너비를 `grid-cols-[260px_1fr_280px]`로 넓힌다(데이터 패널 폼이 200px에는 좁다).

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. `Editor.test.tsx`가 팔레트 버튼을 찾는다면 기본 탭이 "요소"라 그대로 통과한다.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): 데이터 패널 — 파라미터·데이터셋 편집, 샘플 가져오기, 필드 트리 드래그"
```

---
## 웨이브 4

### Task 17: renderer 예제 4종 골든과 성능 테스트

**Files:**
- Create: `packages/renderer/src/__tests__/fixtures/inspection-cert.report.json`, `packages/renderer/src/__tests__/fixtures/invoice.report.json`, `packages/renderer/src/__tests__/fixtures/shipping-order.report.json`, `packages/renderer/src/__tests__/fixtures/badge-sheet.report.json`, `packages/renderer/src/__tests__/fixtures/context.ts`
- Test: `packages/renderer/src/__tests__/golden-phase2.test.ts`, `packages/renderer/src/__tests__/perf.test.ts`

**Interfaces:**
- Consumes: T14 `layout`; core `parseReport`; studio의 `sampleContext`와 같은 규칙으로 fixture의 `sample.data`를 컨텍스트로 만든다(renderer 테스트 안에 작은 헬퍼 `fixtureContext`를 둔다. studio에 의존하지 않기 위해).
- Produces: 예제 JSON 4종(스펙 9.1). 이후 T18(PDF)·T24(E2E)·studio 시드가 같은 파일을 쓴다.

- [ ] **Step 1: 예제 fixture 작성**

각 예제는 `sample.data`에 자체 샘플 데이터를 담아 DB·서버 없이 렌더된다. 데이터셋은 `type: "static", rows: []`로 두고 `sample.data`가 행을 준다(sample 우선 규칙 검증). 전용 코드는 없다.

`packages/renderer/src/__tests__/fixtures/inspection-cert.report.json` (검사증명서: repeat 로트별, 긴 표 넘김, 분류별 그룹 머리·소계, 페이지 소계, 헤더 반복):
```json
{
  "id": "inspection-cert", "name": "검사증명서", "version": 1,
  "page": { "width": 210, "height": 297, "margin": [15, 15, 15, 15] },
  "params": [{ "name": "orderNo", "type": "string", "required": true }],
  "datasets": [{ "name": "lots", "type": "static", "rows": [] }],
  "repeat": { "source": "lots", "as": "record" },
  "sample": { "params": { "orderNo": "PO-2026-0917" }, "capturedAt": "2026-09-17T00:00:00.000Z", "data": { "lots": [
    { "LOT_NO": "L-001", "PRODUCT": "냉연강판 SPCC 1.0t", "CUSTOMER": "대한정밀(주)", "results": [
      { "CAT": "치수", "ITEM": "두께", "STD": "1.00 ±0.05", "VAL": 1.01, "JUDGE": "합격" }, { "CAT": "치수", "ITEM": "폭", "STD": "1219 ±1", "VAL": 1219.3, "JUDGE": "합격" },
      { "CAT": "치수", "ITEM": "길이", "STD": "2438 ±2", "VAL": 2437.5, "JUDGE": "합격" },
      { "CAT": "기계", "ITEM": "인장강도", "STD": "≥270", "VAL": 305, "JUDGE": "합격" }, { "CAT": "기계", "ITEM": "항복강도", "STD": "≥140", "VAL": 178, "JUDGE": "합격" },
      { "CAT": "기계", "ITEM": "연신율", "STD": "≥28", "VAL": 41, "JUDGE": "합격" }, { "CAT": "기계", "ITEM": "경도", "STD": "HRB ≤65", "VAL": 52, "JUDGE": "합격" },
      { "CAT": "외관", "ITEM": "표면", "STD": "결함 없음", "VAL": 0, "JUDGE": "합격" }, { "CAT": "외관", "ITEM": "에지", "STD": "버 없음", "VAL": 0, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "C", "STD": "≤0.15", "VAL": 0.04, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "Mn", "STD": "≤0.60", "VAL": 0.21, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "P", "STD": "≤0.100", "VAL": 0.012, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "S", "STD": "≤0.050", "VAL": 0.006, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "Si", "STD": "≤0.03", "VAL": 0.01, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "Al", "STD": "≥0.02", "VAL": 0.04, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "Cu", "STD": "≤0.20", "VAL": 0.02, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "Ni", "STD": "≤0.20", "VAL": 0.01, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "Cr", "STD": "≤0.20", "VAL": 0.02, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "Mo", "STD": "≤0.05", "VAL": 0.00, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "V", "STD": "≤0.01", "VAL": 0.00, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "Ti", "STD": "≤0.01", "VAL": 0.00, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "Nb", "STD": "≤0.01", "VAL": 0.00, "JUDGE": "합격" }, { "CAT": "성분", "ITEM": "B", "STD": "≤0.001", "VAL": 0.0002, "JUDGE": "합격" },
      { "CAT": "성분", "ITEM": "N", "STD": "≤0.006", "VAL": 0.003, "JUDGE": "합격" }
    ]},
    { "LOT_NO": "L-002", "PRODUCT": "냉연강판 SPCC 1.2t", "CUSTOMER": "대한정밀(주)", "results": [
      { "CAT": "치수", "ITEM": "두께", "STD": "1.20 ±0.05", "VAL": 1.19, "JUDGE": "합격" }, { "CAT": "기계", "ITEM": "인장강도", "STD": "≥270", "VAL": 298, "JUDGE": "합격" }
    ]}
  ]}},
  "elements": [
    { "id": "title", "type": "text", "x": 15, "y": 18, "w": 180, "h": 12, "value": "검 사 증 명 서", "style": { "fontSize": 22, "bold": true, "align": "center" } },
    { "id": "hdr", "type": "group", "x": 15, "y": 34, "w": 180, "h": 24, "children": [
      { "id": "l1", "type": "text", "x": 0, "y": 0, "w": 30, "h": 8, "value": "발주번호", "style": { "bold": true, "fill": "#f2f2f2", "padding": 2, "valign": "middle" } },
      { "id": "v1", "type": "text", "x": 30, "y": 0, "w": 60, "h": 8, "value": "{{ params.orderNo }}", "style": { "padding": 2, "valign": "middle" } },
      { "id": "l2", "type": "text", "x": 90, "y": 0, "w": 30, "h": 8, "value": "LOT", "style": { "bold": true, "fill": "#f2f2f2", "padding": 2, "valign": "middle" } },
      { "id": "v2", "type": "text", "x": 120, "y": 0, "w": 60, "h": 8, "value": "{{ record.LOT_NO }}", "style": { "padding": 2, "valign": "middle" } },
      { "id": "l3", "type": "text", "x": 0, "y": 8, "w": 30, "h": 8, "value": "품명", "style": { "bold": true, "fill": "#f2f2f2", "padding": 2, "valign": "middle" } },
      { "id": "v3", "type": "text", "x": 30, "y": 8, "w": 150, "h": 8, "value": "{{ record.PRODUCT }}", "style": { "padding": 2, "valign": "middle" } },
      { "id": "l4", "type": "text", "x": 0, "y": 16, "w": 30, "h": 8, "value": "고객사", "style": { "bold": true, "fill": "#f2f2f2", "padding": 2, "valign": "middle" } },
      { "id": "v4", "type": "text", "x": 30, "y": 16, "w": 150, "h": 8, "value": "{{ record.CUSTOMER }}", "style": { "padding": 2, "valign": "middle" } },
      { "id": "box", "type": "rect", "x": 0, "y": 0, "w": 180, "h": 24, "style": { "stroke": "#000", "strokeWidth": 0.3 } }
    ]},
    { "id": "results", "type": "table", "x": 15, "y": 64, "w": 180, "h": 90, "source": "record.results", "repeatHeader": true, "rowHeight": 6, "headerHeight": 7,
      "border": "all", "headerStyle": { "bold": true, "fill": "#eeeeee", "align": "center" },
      "columns": [
        { "header": "검사항목", "value": "{{ row.ITEM }}", "w": 50, "style": { "padding": 1.5, "valign": "middle" } },
        { "header": "규격", "value": "{{ row.STD }}", "w": 50, "style": { "padding": 1.5, "valign": "middle" } },
        { "header": "측정값", "value": "{{ row.VAL }}", "w": 40, "align": "right", "style": { "padding": 1.5, "valign": "middle" } },
        { "header": "판정", "value": "{{ row.JUDGE }}", "w": 40, "align": "center", "style": { "padding": 1.5, "valign": "middle" } }
      ],
      "groups": [{ "by": "row.CAT", "header": [{ "value": "■ {{ group.key }} ({{ count(group.rows) }}건)", "span": "all", "style": { "bold": true, "fill": "#f8f8f8", "padding": 1.5 } }],
                  "footer": [{ "value": "소계", "span": 2, "align": "right", "style": { "padding": 1.5 } }, { "value": "{{ formatNumber(sum(group.rows, 'VAL'), '#,##0.00') }}", "align": "right", "style": { "padding": 1.5 } }, { "value": "" }] }],
      "pageFooter": [{ "value": "페이지 {{ page }} / {{ total }} — 이 페이지 {{ count(pageRows) }}건", "span": "all", "align": "right", "style": { "padding": 1.5, "color": "#555" } }],
      "footer": [{ "value": "합계 {{ count(rows) }}건", "span": "all", "align": "right", "style": { "bold": true, "padding": 1.5 } }] },
    { "id": "sign", "type": "text", "x": 120, "y": 262, "w": 75, "h": 8, "value": "품질보증팀장 (인)", "flow": "last", "style": { "align": "right" } },
    { "id": "pn", "type": "pageNumber", "x": 15, "y": 278, "w": 180, "h": 6, "flow": "every", "format": "LOT {{ record.LOT_NO }} · {{ page }}/{{ total }} · 전체 {{ sheet }}/{{ sheets }}", "style": { "fontSize": 8, "align": "center", "color": "#666" } }
  ]
}
```

`packages/renderer/src/__tests__/fixtures/invoice.report.json` (송장: repeat 출하별, 중첩 배열 `record.items`, 표 합계, `flow: last`):
```json
{
  "id": "invoice", "name": "송장", "version": 1,
  "page": { "width": 210, "height": 297, "margin": [12, 12, 12, 12] },
  "datasets": [{ "name": "shipments", "type": "static", "rows": [] }],
  "repeat": { "source": "shipments", "as": "record" },
  "sample": { "params": {}, "capturedAt": "2026-09-17T00:00:00.000Z", "data": { "shipments": [
    { "SHIP_NO": "S-1001", "CUSTOMER": "한빛금속", "DT": "2026-09-16", "items": [
      { "NAME": "SPCC 1.0t × 1219 × 2438", "QTY": 120, "UNIT": 45000 }, { "NAME": "SPCC 1.2t × 1219 × 2438", "QTY": 80, "UNIT": 52000 }, { "NAME": "SPCC 1.6t × 1219 × 2438", "QTY": 40, "UNIT": 68000 }
    ]},
    { "SHIP_NO": "S-1002", "CUSTOMER": "세명산업", "DT": "2026-09-17", "items": [ { "NAME": "SPHC 2.3t × 1219 × 2438", "QTY": 200, "UNIT": 61000 } ] }
  ]}},
  "elements": [
    { "id": "title", "type": "text", "x": 12, "y": 14, "w": 186, "h": 12, "value": "송  장", "style": { "fontSize": 22, "bold": true, "align": "center" } },
    { "id": "meta", "type": "text", "x": 12, "y": 30, "w": 186, "h": 16, "value": "송장번호: {{ record.SHIP_NO }}\n고객사: {{ record.CUSTOMER }}   출하일: {{ formatDate(record.DT, 'yyyy.MM.dd') }}", "style": { "fontSize": 10 } },
    { "id": "items", "type": "table", "x": 12, "y": 50, "w": 186, "h": 200, "source": "record.items", "border": "rows", "borderStyle": { "stroke": "#999", "strokeWidth": 0.2 }, "rowHeight": 7,
      "headerStyle": { "bold": true, "fill": "#f0f0f0" },
      "columns": [
        { "header": "품명", "value": "{{ row.NAME }}", "w": 96, "style": { "padding": 1.5, "valign": "middle" } },
        { "header": "수량", "value": "{{ formatNumber(row.QTY) }}", "w": 25, "align": "right", "style": { "padding": 1.5, "valign": "middle" } },
        { "header": "단가", "value": "{{ formatNumber(row.UNIT) }}", "w": 30, "align": "right", "style": { "padding": 1.5, "valign": "middle" } },
        { "header": "금액", "value": "{{ formatNumber(row.QTY * row.UNIT) }}", "w": 35, "align": "right", "style": { "padding": 1.5, "valign": "middle" } }
      ],
      "footer": [{ "value": "합계", "span": 1, "style": { "bold": true, "padding": 1.5 } }, { "value": "{{ formatNumber(sum(rows, 'QTY')) }}", "align": "right", "style": { "bold": true, "padding": 1.5 } }, { "value": "" },
                 { "value": "{{ formatNumber(sum(rows, 'QTY') > 0 ? avg(rows, 'UNIT') * sum(rows, 'QTY') : 0) }}", "align": "right", "style": { "bold": true, "padding": 1.5 } }] },
    { "id": "note", "type": "text", "x": 12, "y": 258, "w": 186, "h": 10, "value": "상기 물품을 정히 출하하였습니다.", "flow": "last", "style": { "align": "center" } },
    { "id": "pn", "type": "pageNumber", "x": 12, "y": 280, "w": 186, "h": 6, "flow": "every", "style": { "fontSize": 8, "align": "center", "color": "#666" } }
  ]
}
```

`packages/renderer/src/__tests__/fixtures/shipping-order.report.json` (출하지시서: 반복 영역 list, 라인별 그룹 머리, 키 연결 소스):
```json
{
  "id": "shipping-order", "name": "출하지시서", "version": 1,
  "page": { "width": 210, "height": 297, "margin": [12, 12, 12, 12] },
  "datasets": [{ "name": "orders", "type": "static", "rows": [] }, { "name": "items", "type": "static", "rows": [] }],
  "sample": { "params": {}, "capturedAt": "2026-09-17T00:00:00.000Z", "data": {
    "orders": [ { "ORDER_NO": "O-1", "LINE": "1라인", "DEST": "한빛금속 안산공장" }, { "ORDER_NO": "O-2", "LINE": "1라인", "DEST": "세명산업 시화" }, { "ORDER_NO": "O-3", "LINE": "2라인", "DEST": "대한정밀 화성" } ],
    "items": [ { "ORDER_NO": "O-1", "NAME": "SPCC 1.0t", "QTY": 120 }, { "ORDER_NO": "O-1", "NAME": "SPCC 1.2t", "QTY": 80 }, { "ORDER_NO": "O-2", "NAME": "SPHC 2.3t", "QTY": 200 },
               { "ORDER_NO": "O-3", "NAME": "SPCC 1.6t", "QTY": 40 }, { "ORDER_NO": "O-3", "NAME": "SPCC 2.0t", "QTY": 60 }, { "ORDER_NO": "O-3", "NAME": "SPCC 2.3t", "QTY": 10 } ]
  }},
  "elements": [
    { "id": "title", "type": "text", "x": 12, "y": 14, "w": 186, "h": 12, "value": "출하지시서", "style": { "fontSize": 20, "bold": true, "align": "center" } },
    { "id": "cards", "type": "repeater", "x": 12, "y": 32, "w": 186, "h": 250, "source": "orders", "layout": "list", "gap": [0, 4],
      "groups": [{ "by": "item.LINE", "header": { "h": 9, "children": [
        { "id": "gh-bg", "type": "rect", "x": 0, "y": 0, "w": 186, "h": 8, "style": { "fill": "#e8eef8" } },
        { "id": "gh-t", "type": "text", "x": 2, "y": 0, "w": 180, "h": 8, "value": "{{ group.key }} — 지시 {{ count(group.rows) }}건", "style": { "bold": true, "valign": "middle" } } ] } }],
      "item": { "w": 186, "h": 44, "children": [
        { "id": "card-box", "type": "rect", "x": 0, "y": 0, "w": 186, "h": 42, "style": { "stroke": "#333", "strokeWidth": 0.3, "radius": 1 } },
        { "id": "card-no", "type": "text", "x": 3, "y": 2, "w": 60, "h": 7, "value": "지시번호 {{ item.ORDER_NO }}", "style": { "bold": true, "fontSize": 11 } },
        { "id": "card-dest", "type": "text", "x": 70, "y": 2, "w": 110, "h": 7, "value": "납품처: {{ item.DEST }}", "style": { "align": "right" } },
        { "id": "card-items", "type": "table", "x": 3, "y": 11, "w": 180, "h": 29, "overflow": "clip", "source": "items[.ORDER_NO == item.ORDER_NO]", "rowHeight": 6, "headerHeight": 6, "border": "rows",
          "columns": [ { "header": "품명", "value": "{{ row.NAME }}", "w": 120, "style": { "padding": 1 } }, { "header": "수량", "value": "{{ formatNumber(row.QTY) }}", "w": 60, "align": "right", "style": { "padding": 1 } } ] }
      ]} },
    { "id": "pn", "type": "pageNumber", "x": 12, "y": 285, "w": 186, "h": 6, "flow": "every", "style": { "fontSize": 8, "align": "center", "color": "#666" } }
  ]
}
```

`packages/renderer/src/__tests__/fixtures/badge-sheet.report.json` (사원 명찰 시트: 반복 영역 grid, 여러 페이지, MES 무관):
```json
{
  "id": "badge-sheet", "name": "사원 명찰 시트", "version": 1,
  "page": { "width": 210, "height": 297, "margin": [10, 10, 10, 10] },
  "datasets": [{ "name": "people", "type": "static", "rows": [] }],
  "sample": { "params": {}, "capturedAt": "2026-09-17T00:00:00.000Z", "data": { "people": [
    { "NAME": "김민준", "DEPT": "품질보증", "NO": "E001" }, { "NAME": "이서연", "DEPT": "품질보증", "NO": "E002" }, { "NAME": "박지호", "DEPT": "생산1", "NO": "E003" },
    { "NAME": "최수아", "DEPT": "생산1", "NO": "E004" }, { "NAME": "정우진", "DEPT": "생산1", "NO": "E005" }, { "NAME": "강하은", "DEPT": "생산2", "NO": "E006" },
    { "NAME": "조예준", "DEPT": "생산2", "NO": "E007" }, { "NAME": "윤지우", "DEPT": "물류", "NO": "E008" }, { "NAME": "장도윤", "DEPT": "물류", "NO": "E009" },
    { "NAME": "임서준", "DEPT": "물류", "NO": "E010" }, { "NAME": "한시우", "DEPT": "경영지원", "NO": "E011" }, { "NAME": "오하린", "DEPT": "경영지원", "NO": "E012" },
    { "NAME": "신은우", "DEPT": "경영지원", "NO": "E013" }, { "NAME": "권지아", "DEPT": "연구소", "NO": "E014" }, { "NAME": "황현우", "DEPT": "연구소", "NO": "E015" },
    { "NAME": "안수빈", "DEPT": "연구소", "NO": "E016" }, { "NAME": "송주원", "DEPT": "연구소", "NO": "E017" }, { "NAME": "류시아", "DEPT": "영업", "NO": "E018" },
    { "NAME": "홍준서", "DEPT": "영업", "NO": "E019" }, { "NAME": "전아윤", "DEPT": "영업", "NO": "E020" }, { "NAME": "고건우", "DEPT": "영업", "NO": "E021" },
    { "NAME": "문서윤", "DEPT": "구매", "NO": "E022" }, { "NAME": "양이준", "DEPT": "구매", "NO": "E023" }, { "NAME": "손채원", "DEPT": "구매", "NO": "E024" },
    { "NAME": "배지훈", "DEPT": "안전", "NO": "E025" }, { "NAME": "백유나", "DEPT": "안전", "NO": "E026" }, { "NAME": "허민서", "DEPT": "안전", "NO": "E027" },
    { "NAME": "남예원", "DEPT": "안전", "NO": "E028" }, { "NAME": "심태양", "DEPT": "설비", "NO": "E029" }, { "NAME": "노다은", "DEPT": "설비", "NO": "E030" }
  ]}},
  "elements": [
    { "id": "grid", "type": "repeater", "x": 10, "y": 10, "w": 190, "h": 277, "source": "people", "layout": "grid", "gap": [5, 5],
      "item": { "w": 60, "h": 35, "children": [
        { "id": "b-box", "type": "rect", "x": 0, "y": 0, "w": 60, "h": 35, "style": { "stroke": "#000", "strokeWidth": 0.3, "radius": 2 } },
        { "id": "b-name", "type": "text", "x": 2, "y": 6, "w": 56, "h": 12, "value": "{{ item.NAME }}", "style": { "fontSize": 18, "bold": true, "align": "center", "valign": "middle" } },
        { "id": "b-dept", "type": "text", "x": 2, "y": 20, "w": 56, "h": 6, "value": "{{ item.DEPT }}", "style": { "fontSize": 10, "align": "center" } },
        { "id": "b-no", "type": "text", "x": 2, "y": 27, "w": 56, "h": 5, "value": "{{ item.NO }} · {{ index + 1 }}/{{ count(rows) }}", "style": { "fontSize": 7, "align": "center", "color": "#666" } }
      ]} }
  ]
}
```

- [ ] **Step 2: 골든·성능 테스트 작성**

`packages/renderer/src/__tests__/fixtures/context.ts` (테스트 파일이 아닌 헬퍼. pdf 테스트도 import한다):
```ts
import { resolveParams, rowsProxy, type Report, type DataContext } from "@daport/core";

/** studio의 sampleContext와 같은 규칙: sample.params, sample.data 우선, 없으면 static 행 */
export function fixtureContext(report: Report): DataContext {
  const ctx: DataContext = { params: resolveParams(report, report.sample?.params ?? {}, { checkRequired: false }) };
  const data = report.sample?.data ?? {};
  for (const ds of report.datasets) ctx[ds.name] = rowsProxy(((data[ds.name] as Record<string, unknown>[] | undefined) ?? (ds.type === "static" ? ds.rows : [])));
  return ctx;
}
```

`packages/renderer/src/__tests__/golden-phase2.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { fixtureContext } from "./fixtures/context";
import inspection from "./fixtures/inspection-cert.report.json";
import invoice from "./fixtures/invoice.report.json";
import shipping from "./fixtures/shipping-order.report.json";
import badges from "./fixtures/badge-sheet.report.json";

const cases: [string, unknown, (pages: ReturnType<typeof layout>) => void][] = [
  ["inspection-cert", inspection, (pages) => {
    expect(pages.length).toBeGreaterThanOrEqual(3);                                   // L-001 2장 이상 + L-002 1장
    expect(pages.filter((p) => p.copyIndex === 1)).toHaveLength(1);
    expect(pages[0].items.filter((i) => i.instance === "results#h")).toHaveLength(4);   // 머리 반복
    expect(pages[1].items.filter((i) => i.instance === "results#h")).toHaveLength(4);
    expect(pages[0].items.some((i) => i.instance?.startsWith("results#g0h"))).toBe(true);
    expect(pages[0].items.some((i) => i.instance === "results#pf")).toBe(true);
    const last = pages.filter((p) => p.copyIndex === 0).at(-1)!;
    expect(last.items.some((i) => i.instance === "results#f")).toBe(true);
    expect(last.items.some((i) => i.elementId === "sign")).toBe(true);
    expect(pages[0].items.some((i) => i.elementId === "sign")).toBe(false);
  }],
  ["invoice", invoice, (pages) => {
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.copyIndex)).toEqual([0, 1]);
    const footer = pages[0].items.filter((i) => i.instance === "items#f" && i.kind === "text").map((i) => (i as { lines: string[] }).lines.join(""));
    expect(footer).toEqual(["합계", "240", "", expect.any(String)]);
    expect(pages[0].items.some((i) => i.elementId === "note")).toBe(true);
  }],
  ["shipping-order", shipping, (pages) => {
    expect(pages).toHaveLength(1);
    expect(pages[0].items.filter((i) => i.elementId === "gh-t").length).toBe(2);        // 1라인, 2라인
    expect(pages[0].items.filter((i) => i.elementId === "card-no").map((i) => i.instance)).toEqual(["cards#0", "cards#1", "cards#2"]);
    expect(pages[0].items.filter((i) => i.instance === "cards#2/card-items#2" && i.role === "cell").length).toBe(2);   // O-3의 세 번째 행
    expect(pages[0].items.filter((i) => i.instance === "cards#1/card-items#1")).toHaveLength(0);             // O-2는 한 행
  }],
  ["badge-sheet", badges, (pages) => {
    expect(pages).toHaveLength(2);                                                       // 3열 × 6줄 = 18장/페이지, 30명
    expect(pages[0].items.filter((i) => i.elementId === "b-name")).toHaveLength(18);
    expect(pages[1].items.filter((i) => i.elementId === "b-name")).toHaveLength(12);
    expect(pages[0].items.find((i) => i.role === "template")).toMatchObject({ x: 10, y: 10, w: 60, h: 35 });
  }],
];

describe("golden: phase 2 examples", () => {
  it.each(cases)("%s lays out without errors and matches its snapshot", (_name, fixture, check) => {
    const report = parseReport(fixture);
    const pages = layout(report, fixtureContext(report));
    expect(pages.flatMap((p) => p.items).filter((i) => i.error)).toEqual([]);
    check(pages);
    expect(pages).toMatchSnapshot();
  });
});
```

`packages/renderer/src/__tests__/perf.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";

describe("performance", () => {
  it("lays out a 10k-row table with groups and a page footer in under 1s (3s on CI)", () => {
    const report = parseReport({ id: "perf", version: 1, page: { width: 210, height: 297 }, elements: [
      { id: "t", type: "table", x: 10, y: 20, w: 190, h: 250, source: "items", rowHeight: 5,
        columns: [{ header: "번호", value: "{{ row.N }}", w: 30 }, { header: "품명", value: "{{ row.NAME }}", w: 100 }, { header: "수량", value: "{{ formatNumber(row.QTY) }}", w: 30, align: "right" }, { header: "분류", value: "{{ row.CAT }}", w: 30 }],
        groups: [{ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }], footer: [{ value: "소계 {{ sum(group.rows, 'QTY') }}", span: "all" }] }],
        pageFooter: [{ value: "{{ page }}/{{ total }} · {{ count(pageRows) }}건", span: "all" }] },
      { id: "pn", type: "pageNumber", x: 10, y: 285, w: 190, h: 5, flow: "every" },
    ]});
    const items = Array.from({ length: 10_000 }, (_, i) => ({ N: i + 1, NAME: `냉연강판 SPCC ${(i % 9) + 1}.0t 규격품 ${i}`, QTY: (i * 7) % 500, CAT: `C${Math.floor(i / 400)}` }));
    const t0 = performance.now();
    const pages = layout(report, { params: {}, items });
    const ms = performance.now() - t0;
    expect(pages.length).toBeGreaterThan(200);
    expect(ms).toBeLessThan(process.env.CI ? 3000 : 1000);
  });
});
```

- [ ] **Step 3: 실행하여 스냅샷 생성**

Run: `pnpm --filter @daport/renderer test -- golden-phase2 perf`
Expected: 4개 골든 PASS(첫 실행에 스냅샷 생성), 성능 PASS. 검증 함수의 수치(페이지 수·항목 수)가 틀리면 fixture가 아니라 **검증 수치**를 실제 결과에 맞춰 고치되, 페이지 넘김·그룹·부·flow 규칙의 의미(예: 머리 반복, `sign`은 마지막 페이지만, 명찰 18장/페이지)는 지켜야 한다. 스냅샷 파일 `__snapshots__/golden-phase2.test.ts.snap`을 눈으로 훑어 `#ERR`가 없는지 본다.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/__tests__
git commit -m "test(renderer): 예제 4종(검사증명서·송장·출하지시서·명찰) 골든과 1만 행 성능 테스트"
```

---

### Task 18: pdf 여러 페이지 테스트 (페이지 수·페이지별 픽셀 비교)

**Files:**
- Modify: `packages/pdf/src/index.ts` (`renderHtmlScreenshot`에 `pageIndex` 옵션)
- Test: `packages/pdf/src/__tests__/multipage.test.ts`

**Interfaces:**
- Consumes: T17 fixtures, `fixtureContext`(`renderer/src/__tests__/fixtures/context.ts`에서 import); 1단계 `renderPdf`, `renderHtmlScreenshot`, `closePool`, `pdf-to-img`, `pixelmatch`.
- Produces: `renderHtmlScreenshot(report, data, opts?: { pageIndex?: number }): Promise<Buffer>`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/pdf/src/__tests__/multipage.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdf as pdfToImg } from "pdf-to-img";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { parseReport } from "@daport/core";
import { layout } from "@daport/renderer";
import { renderPdf, renderHtmlScreenshot, closePool } from "../index";
import { fixtureContext } from "../../../renderer/src/__tests__/fixtures/context";
import inspection from "../../../renderer/src/__tests__/fixtures/inspection-cert.report.json";
import invoice from "../../../renderer/src/__tests__/fixtures/invoice.report.json";
import shipping from "../../../renderer/src/__tests__/fixtures/shipping-order.report.json";
import badges from "../../../renderer/src/__tests__/fixtures/badge-sheet.report.json";

const MAX_DIFF_RATIO = 0.001;   // pdf.test.ts와 같은 기준

function crop(png: PNG, w: number, h: number): Uint8Array {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
  return out.data;
}

afterAll(closePool);

describe("multi-page PDF", () => {
  it.each([["inspection-cert", inspection], ["invoice", invoice], ["shipping-order", shipping], ["badge-sheet", badges]])(
    "%s: PDF page count equals layout page count and every page matches its HTML screenshot", async (_name, fixture) => {
      const report = parseReport(fixture);
      const data = fixtureContext(report);
      const expected = layout(report, data).length;
      const buf = await renderPdf(report, data);
      expect((await PDFDocument.load(buf)).getPageCount()).toBe(expected);
      const doc = await pdfToImg(buf, { scale: 96 / 72 });
      for (let p = 1; p <= expected; p++) {
        const pdfPng = PNG.sync.read(Buffer.from(await doc.getPage(p)));
        const htmlPng = PNG.sync.read(await renderHtmlScreenshot(report, data, { pageIndex: p - 1 }));
        const w = Math.min(htmlPng.width, pdfPng.width), h = Math.min(htmlPng.height, pdfPng.height);
        const diff = pixelmatch(crop(htmlPng, w, h), crop(pdfPng, w, h), undefined, w, h, { threshold: 0.2 });
        expect(diff / (w * h), `${_name} page ${p}`).toBeLessThan(MAX_DIFF_RATIO);
      }
    }, 120_000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/pdf test -- multipage`
Expected: FAIL — `renderHtmlScreenshot`이 세 번째 인자를 받지 않아 첫 페이지만 찍는다(2페이지 비교 실패) 또는 typecheck 오류.

- [ ] **Step 3: 구현**

`packages/pdf/src/index.ts`의 `renderHtmlScreenshot`을 바꾼다:
```ts
/** 테스트·미리보기 비교용: pageIndex번째(0부터) 페이지를 96dpi PNG로 */
export async function renderHtmlScreenshot(report: Report, data: DataContext, opts: { pageIndex?: number } = {}): Promise<Buffer> {
  const html = renderToHtml(report, data, { fontBaseUrl });
  return withPage(html, async (page) => {
    await page.setViewportSize({ width: Math.round(report.page.width / 25.4 * 96), height: Math.round(report.page.height / 25.4 * 96) });
    return page.locator(".dp-page").nth(opts.pageIndex ?? 0).screenshot({ type: "png" });
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/pdf test && pnpm --filter @daport/pdf typecheck`
Expected: PASS (Playwright Chromium이 설치돼 있어야 한다: `pnpm --filter @daport/pdf exec playwright install chromium`). 페이지별 차이가 기준을 넘으면 어느 페이지인지 메시지에 나온다. 표 테두리(0.2mm 선)가 래스터에서 1px 어긋나는 정도는 0.1% 안이다.

- [ ] **Step 5: Commit**

```bash
git add packages/pdf/src
git commit -m "test(pdf): 예제 4종 여러 페이지 PDF 페이지 수와 페이지별 HTML 픽셀 비교"
```

---

### Task 19: studio 캔버스 페이지·부 선택, 인스턴스 매핑, 반복 영역 템플릿 편집

**Files:**
- Modify: `apps/studio/src/editor/canvas/Canvas.tsx`
- Create: `apps/studio/src/editor/canvas/pages.ts`
- Test: `apps/studio/src/editor/canvas/__tests__/pages.test.ts`, `apps/studio/src/editor/canvas/__tests__/Canvas.phase2.test.tsx`

**Interfaces:**
- Consumes: T13 `view`, `setView`, `findParentRepeater`; T14 `layout` 결과의 `instance`·`role`.
- Produces:
  ```ts
  // canvas/pages.ts (순수 함수)
  export function clampView(view: View, pages: Page[]): View;   // 페이지 수가 줄면 마지막 페이지·부로
  export function currentPage(pages: Page[], view: View): Page;
  export function primaryItem(page: Page, elementId: string): PlacedItem | undefined;   // 문서 순서 첫 항목, role cell·border 제외 (R10)
  export function elementIdAt(node: Element | null, root: HTMLElement): string | null;   // data-element-id를 위로 찾되, 반복 인스턴스는 그대로(템플릿 요소 id)
  ```
  캔버스: `PaintPage`에 `currentPage`, `role="template"` 항목 위에 파란 점선 상자, 첫 인스턴스가 아닌 항목(`instance`가 `#0`으로 끝나지 않는 반복 항목)은 opacity 0.5. 흐름 요소(`flowBox`) 클릭은 표·반복 영역 선택.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/canvas/__tests__/pages.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { Page } from "@daport/renderer";
import { clampView, currentPage, primaryItem } from "../pages";

const pg = (index: number, copyIndex: number, pageInCopy: number, items: Page["items"] = []): Page => ({ index, width: 10, height: 10, items, copyIndex, pageInCopy });
const pages = [pg(0, 0, 0), pg(1, 0, 1), pg(2, 1, 0)];

describe("pages", () => {
  it("clampView keeps a valid view and clamps copy then page", () => {
    expect(clampView({ copyIndex: 0, pageInCopy: 1 }, pages)).toEqual({ copyIndex: 0, pageInCopy: 1 });
    expect(clampView({ copyIndex: 5, pageInCopy: 9 }, pages)).toEqual({ copyIndex: 1, pageInCopy: 0 });
    expect(clampView({ copyIndex: 0, pageInCopy: 9 }, pages)).toEqual({ copyIndex: 0, pageInCopy: 1 });
    expect(clampView({ copyIndex: 0, pageInCopy: 0 }, [])).toEqual({ copyIndex: 0, pageInCopy: 0 });
  });
  it("currentPage returns the page for the view", () => {
    expect(currentPage(pages, { copyIndex: 1, pageInCopy: 0 }).index).toBe(2);
    expect(currentPage(pages, { copyIndex: 7, pageInCopy: 7 }).index).toBe(2);
  });
  it("primaryItem picks the first non-cell/border item of the element", () => {
    const style = {} as Page["items"][number]["style"];
    const p = pg(0, 0, 0, [
      { kind: "rect", elementId: "t", role: "flowBox", x: 1, y: 1, w: 5, h: 5, style },
      { kind: "text", elementId: "t", role: "cell", instance: "t#h", x: 1, y: 1, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
      { kind: "text", elementId: "nm", instance: "cards#0", x: 2, y: 2, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
      { kind: "text", elementId: "nm", instance: "cards#1", x: 3, y: 3, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
    ]);
    expect(primaryItem(p, "t")).toMatchObject({ role: "flowBox" });
    expect(primaryItem(p, "nm")).toMatchObject({ instance: "cards#0" });
    expect(primaryItem(p, "zz")).toBeUndefined();
  });
});
```

`apps/studio/src/editor/canvas/__tests__/Canvas.phase2.test.tsx`:
```tsx
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100, margin: [5, 5, 5, 5] },
  datasets: [{ name: "items", type: "static", rows: rows(20) }, { name: "lots", type: "static", rows: rows(3) }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
  { id: "cards", type: "repeater", x: 5, y: 60, w: 90, h: 30, source: "lots", layout: "grid", item: { w: 30, h: 20, children: [{ id: "nm", type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.N }}" }] } },
  { id: "fixed", type: "rect", x: 80, y: 5, w: 10, h: 10, flow: "every" },
]});

function mount(store: EditorStore) {
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  const q = (sel: string) => utils.container.querySelector(sel) as HTMLElement | null;
  const all = (sel: string) => Array.from(utils.container.querySelectorAll<HTMLElement>(sel));
  return { ...utils, q, all };
}
const ptr = (clientX: number, clientY: number) => ({ pointerId: 1, clientX, clientY });
const px = (mm: number) => mmToPxScaled(mm, 1);

beforeAll(() => {
  class PointerEventStub extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; } }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});
afterEach(cleanup);

describe("Canvas (phase 2)", () => {
  it("draws the page chosen by view and clamps when pages shrink", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    expect(q(".dp-page")?.getAttribute("data-page-index")).toBe("0");
    act(() => store.getState().setView({ pageInCopy: 2 }));
    expect(q(".dp-page")?.getAttribute("data-page-index")).toBe("2");
    expect(all('[data-role="cell"]').length).toBe(7);                                  // 머리 + 6행 (14..19)
    expect(q('[data-element-id="fixed"]')).not.toBeNull();
    act(() => store.getState().setDatasets([{ name: "items", type: "static", rows: rows(2) }, { name: "lots", type: "static", rows: rows(3) }]));
    expect(store.getState().view.pageInCopy).toBe(0);                                  // 페이지가 줄어 마지막 페이지로
    expect(q(".dp-page")?.getAttribute("data-page-index")).toBe("0");
  });
  it("selects the table via its flowBox or a cell, and shows its box", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    fireEvent.pointerDown(all('[data-role="cell"]')[2], ptr(px(10), px(35)));
    fireEvent.pointerUp(q('[data-testid="canvas"]')!, ptr(px(10), px(35)));
    expect(store.getState().selection).toEqual(["t"]);
    const box = q(".border-blue-500.pointer-events-none") as HTMLElement;
    expect(box.style.left).toBe("5mm");
    expect(box.style.top).toBe("20mm");
    expect(box.style.height).toBe("30mm");
  });
  it("maps a click on a non-template instance to the template child, dims other instances and outlines the template slot", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    const nm = all('[data-element-id="nm"]');
    expect(nm).toHaveLength(3);
    expect(nm[0].style.opacity).toBe("");
    expect(nm[1].style.opacity).toBe("0.5");
    expect(q('[data-testid="template-outline"]')).not.toBeNull();
    fireEvent.pointerDown(nm[2], ptr(px(70), px(62)));
    fireEvent.pointerUp(q('[data-testid="canvas"]')!, ptr(px(70), px(62)));
    expect(store.getState().selection).toEqual(["nm"]);
    const box = q(".border-blue-500.pointer-events-none") as HTMLElement;
    expect(box.style.left).toBe("6mm");                                                // 템플릿(첫 항목) 위치 5+1
  });
  it("drags a template child and commits relative coordinates", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    const nm = all('[data-element-id="nm"]')[0];
    fireEvent.pointerDown(nm, ptr(px(8), px(63)));
    fireEvent.pointerMove(q('[data-testid="canvas"]')!, ptr(px(8 + 10), px(63)));
    fireEvent.pointerUp(q('[data-testid="canvas"]')!, ptr(px(8 + 10), px(63)));
    expect(store.getState().findElement("nm")).toMatchObject({ x: 11, y: 1 });
    expect(all('[data-element-id="nm"]').every((el) => el.style.left === "16mm" || el.style.left === "46mm" || el.style.left === "76mm")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- canvas/`
Expected: FAIL — `pages.ts` 없음, 캔버스가 `pages[0]`만 그린다.

- [ ] **Step 3: pages.ts 작성**

`apps/studio/src/editor/canvas/pages.ts`:
```ts
import type { Page, PlacedItem } from "@daport/renderer";
import type { View } from "../store";

/** 편집으로 페이지 수가 줄면 마지막 부·페이지로 당긴다 */
export function clampView(view: View, pages: Page[]): View {
  if (pages.length === 0) return { copyIndex: 0, pageInCopy: 0 };
  const copies = pages[pages.length - 1].copyIndex + 1;
  const copyIndex = Math.min(Math.max(0, view.copyIndex), copies - 1);
  const inCopy = pages.filter((p) => p.copyIndex === copyIndex);
  const pageInCopy = Math.min(Math.max(0, view.pageInCopy), inCopy.length - 1);
  return { copyIndex, pageInCopy };
}

export function currentPage(pages: Page[], view: View): Page {
  const v = clampView(view, pages);
  return pages.find((p) => p.copyIndex === v.copyIndex && p.pageInCopy === v.pageInCopy) ?? pages[0];
}

/** 선택 상자로 쓰는 항목: 문서 순서 첫 항목, 표 셀·테두리는 제외 (표·반복 영역은 flowBox, 반복 자식은 첫 인스턴스) */
export function primaryItem(page: Page, elementId: string): PlacedItem | undefined {
  return page.items.find((i) => i.elementId === elementId && i.role !== "cell" && i.role !== "border");
}

/** 반복 인스턴스가 첫 항목(템플릿)이 아닌가. "cards#3", "cards#3/t2#0" → true, "cards#0", 없음 → false */
export function isOtherInstance(instance: string | undefined): boolean {
  if (!instance) return false;
  const first = instance.split("/")[0];
  return !/#0$/.test(first);
}
```

- [ ] **Step 4: Canvas.tsx 교체**

`apps/studio/src/editor/canvas/Canvas.tsx` 전체:
```tsx
"use client";
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { layout } from "@daport/renderer/layout";
import type { PlacedItem } from "@daport/renderer";
import { PaintPage, pageCss, fontFaceCss } from "@daport/renderer/paint";   // 패키지 루트는 react-dom/server를 쓰는 html.ts까지 끌어온다
import { sampleContext } from "@/lib/data";
import { resolveAssetUrls } from "@/lib/assets";
import { useEditor, lineBox } from "../store";
import { useDrag, type Box, type Handle } from "./useDrag";
import { SelectionBox } from "./SelectionBox";
import { pxToMm } from "./snap";
import { clampView, currentPage, primaryItem, isOtherInstance } from "./pages";

/** 채우기 없는 사각형은 선에서 이 화면 거리(px) 안쪽일 때만 고른다 */
const STROKE_HIT_PX = 3;

/** 선택 상자·드래그 시작 상자. 선은 두 끝점을 감싸는 상자다 (x/y가 시작점이라 오른쪽→왼쪽 선이면 왼쪽 변이 아니다) */
const itemBox = (it: PlacedItem): Box => (it.kind === "line" ? lineBox(it) : { x: it.x, y: it.y, w: it.w, h: it.h });

/** 반복 인스턴스는 흐리게, 템플릿 자리는 점선으로 표시하는 CSS */
const CANVAS_CSS = `.dp-el[data-instance]{opacity:1}`;

export function Canvas({ zoom }: { zoom: number }) {
  const report = useEditor((s) => s.report);
  const selection = useEditor((s) => s.selection);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const findElement = useEditor((s) => s.findElement);
  const moveSelected = useEditor((s) => s.moveSelected);
  const resizeElement = useEditor((s) => s.resizeElement);
  const [ghost, setGhost] = useState<Record<string, Box> | null>(null);

  const data = useMemo(() => sampleContext(report), [report]);
  // 미리보기·PDF와 같게 asset://을 /api/assets/{id}로 바꾼다 (상대 URL이라 studio 출처 기준으로 해석된다).
  // 스펙 10: 디자이너는 표현식 오류를 요소마다 #ERR로 보인다. onExpressionError("fail")는 미리보기·PDF 렌더만 따른다
  const pages = useMemo(() => layout({ ...resolveAssetUrls(report, ""), onExpressionError: "blank" }, data), [report, data]);
  const css = useMemo(() => fontFaceCss("/fonts") + "\n" + pageCss(report.page.width, report.page.height) + "\n" + CANVAS_CSS, [report.page.width, report.page.height]);
  const page = currentPage(pages, view);

  // 편집으로 페이지 수가 줄면 보기를 마지막 페이지로 당긴다 (스펙 7.4)
  useEffect(() => {
    const c = clampView(view, pages);
    if (c.copyIndex !== view.copyIndex || c.pageInCopy !== view.pageInCopy) setView(c);
  }, [pages, view, setView]);

  // 선택 요소들의 절대 박스 (그룹 자식은 layout 결과에서 좌표를 얻는다. 반복 자식은 첫 인스턴스)
  const boxes = useMemo(() => {
    const m: Record<string, Box> = {};
    for (const id of selection) { const it = primaryItem(page, id); if (it) m[id] = itemBox(it); }
    return m;
  }, [page, selection]);

  const drag = useDrag({
    zoom,
    onChange: setGhost,
    onCancel: () => setGhost(null),
    onEnd: (final, handle) => {
      setGhost(null);
      const entries = Object.entries(final);
      if (entries.length === 0) return;
      if (handle === "move") {
        // 이동 델타는 모든 박스에 같으므로 선택 전체를 한 번의 커밋(undo 한 단위)으로 옮긴다
        const [id, b] = entries[0]; const orig = boxes[id]; if (!orig) return;
        moveSelected(b.x - orig.x, b.y - orig.y);
        return;
      }
      for (const [id, b] of entries) {
        const el = findElement(id); const orig = boxes[id]; if (!el || !orig) continue;
        // 그룹·템플릿 자식은 layout 절대좌표와 요소 상대좌표의 차이를 유지한다. 선은 상대좌표의 경계 상자를 옮긴다
        const rel = el.type === "line" ? lineBox(el) : el;
        resizeElement(id, { x: rel.x + (b.x - orig.x), y: rel.y + (b.y - orig.y), w: b.w, h: b.h });
      }
    },
  });

  /**
   * 포인터 아래 요소를 위에서부터 훑는다. 채우기 없는 사각형(틀)은 투명한 안쪽이 아래 요소를 가리지 않도록
   * 선 근처일 때만 고른다. 표 셀·테두리·반복 인스턴스는 그 요소 id(표 id·템플릿 자식 id)로 매핑된다.
   * elementsFromPoint가 없는 환경(jsdom)에서는 이벤트 대상만 본다.
   */
  const pickElementId = (e: PointerEvent<HTMLDivElement>): string | null => {
    const root = e.currentTarget;
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
    const origin = root.querySelector(".dp-page")?.getBoundingClientRect();
    const mx = pxToMm(e.clientX - (origin?.left ?? 0), zoom), my = pxToMm(e.clientY - (origin?.top ?? 0), zoom);
    const seen = new Set<string>();
    for (const node of stack) {
      if (!root.contains(node)) continue;
      const host = node.closest("[data-element-id]");
      const id = host?.getAttribute("data-element-id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const role = host?.getAttribute("data-role");
      if (role === "flowBox" || role === "cell" || role === "border" || role === "template") return id;
      const it = primaryItem(page, id);
      if (!it) continue;
      if (it.kind === "rect" && !it.style.fill) {
        const edge = Math.min(mx - it.x, it.x + it.w - mx, my - it.y, it.y + it.h - my);   // 안쪽이면 가장 가까운 변까지의 mm
        if (edge > Math.max(it.style.strokeWidth, pxToMm(STROKE_HIT_PX, zoom))) continue;
      }
      return id;
    }
    return null;
  };

  const onPagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const id = pickElementId(e);
    if (!id) { select([]); return; }
    if (e.shiftKey) { toggleSelect(id); return; }
    const ids = selection.includes(id) ? selection : [id];
    if (!selection.includes(id)) select([id]);
    const start: Record<string, Box> = {};
    for (const sid of ids) { const it = primaryItem(page, sid); if (it) start[sid] = itemBox(it); }
    drag.begin(e, "move", start);
  };
  // 핸들은 단일 선택에만 보인다. 선은 크기 0이 정상이라 최소 크기를 0으로 둔다 (1이면 가로선의 n/s 핸들이 선을 1mm 기울인다)
  const onHandleDown = (e: PointerEvent, h: Handle) => { drag.begin(e, h, boxes, findElement(selection[0])?.type === "line" ? 0 : 1); };

  const shown = ghost ?? boxes;
  const templates = page.items.filter((i) => i.role === "template");
  return (
    <div className="relative inline-block shadow-lg" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
      data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel}>
      <style>{css}</style>
      <PaintPage page={{ ...page, items: page.items.map((it) => (isOtherInstance(it.instance) ? dim(it) : it)) }} />
      <div className="absolute inset-0 pointer-events-none">
        {templates.map((t) => (
          <div key={`${t.elementId}|${t.instance}`} data-testid="template-outline" className="absolute border border-dashed border-blue-400"
            style={{ left: `${t.x}mm`, top: `${t.y}mm`, width: `${t.w}mm`, height: `${t.h}mm` }} />
        ))}
        {Object.entries(shown).map(([id, b]) => <SelectionBox key={id} box={b} single={selection.length === 1} onHandleDown={onHandleDown} />)}
      </div>
    </div>
  );
}

/** 첫 항목이 아닌 반복 인스턴스는 흐리게 그린다 (스펙 7.3). Paint의 Item이 dim 표시를 읽어 opacity 0.5를 준다 */
function dim(it: PlacedItem): PlacedItem { return { ...it, dim: true } as PlacedItem; }
```

`PaintPage`는 renderer의 컴포넌트라 opacity를 모른다. 위 `dim`은 항목에 `dim: true` 표시만 남기므로, renderer `Paint.tsx`의 `Item`에 다음 한 줄을 더한다 (T14 이후 파일):
```tsx
  const dimStyle = (item as { dim?: boolean }).dim ? { opacity: 0.5 } : undefined;
```
그리고 각 `style={{ ... }}`에 `...dimStyle`을 펼친다 (text·rect·image의 style 객체, line은 `style={{ left…, ...dimStyle }}`, placeholder는 `style={{ ...box(item), ...dimStyle }}`). 서버 렌더에서는 `dim`이 없으므로 출력이 변하지 않는다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter @daport/renderer test`
Expected: PASS. 1단계 `Canvas.test.tsx`도 그대로 통과해야 한다(페이지 1장, view 기본값).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src packages/renderer/src/paint/Paint.tsx
git commit -m "feat(studio): 캔버스 페이지·부 선택, 반복 인스턴스→템플릿 매핑, 템플릿 자리 표시와 흐린 인스턴스"
```

---

### Task 20: studio 드롭 바인딩 규칙 (순수 함수)

**Files:**
- Modify: `apps/studio/src/editor/data/bindings.ts` (`resolveDrop` 추가)
- Test: `apps/studio/src/editor/data/__tests__/bindings.test.ts`

**Interfaces:**
- Consumes: T16 `DragField`, `sourceDataset`; core `StyleSchema`, `TableColumn`, `Element`.
- Produces: `DropTarget`, `DropResult`, `resolveDrop(field, target, report, allocateId)` (스펙 7.2 표).

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/data/__tests__/bindings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { resolveDrop, sourceDataset, type DragField } from "../bindings";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "orders", type: "static", rows: [] }, { name: "lots", type: "static", rows: [] }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "orders", columns: [{ header: "A", value: "{{ row.A }}", w: 30 }] },
  { id: "t2", type: "table", x: 5, y: 60, w: 60, h: 30, source: "record.items", columns: [] },
  { id: "cards", type: "repeater", x: 5, y: 60, w: 90, h: 30, source: "lots", item: { w: 30, h: 20, children: [] } },
]});
const alloc = (base: string) => `${base}-9`;
const f = (over: Partial<DragField>): DragField => ({ dataset: "orders", path: "NO", type: "string", isArray: false, ...over });

describe("sourceDataset", () => {
  it("returns the root identifier of simple and filtered sources, undefined otherwise", () => {
    expect(sourceDataset("orders")).toBe("orders");
    expect(sourceDataset("items[.ORDER_NO == item.ORDER_NO]")).toBe("items");
    expect(sourceDataset("record.items")).toBeUndefined();
    expect(sourceDataset("")).toBeUndefined();
  });
});

describe("resolveDrop", () => {
  it("canvas: a text element bound to dataset.path, or record.path when the report repeats over that dataset", () => {
    const r = resolveDrop(f({}), { kind: "canvas", x: 10, y: 12 }, report, alloc);
    expect(r).toMatchObject({ action: "addElement", element: { id: "text-9", type: "text", x: 10, y: 12, value: "{{ orders.NO }}" } });
    const rep = { ...report, repeat: { source: "orders", as: "record" } };
    expect(resolveDrop(f({}), { kind: "canvas", x: 0, y: 0 }, rep, alloc)).toMatchObject({ element: { value: "{{ record.NO }}" } });
    expect(resolveDrop(f({ dataset: "lots" }), { kind: "canvas", x: 0, y: 0 }, rep, alloc)).toMatchObject({ element: { value: "{{ lots.NO }}" } });
  });
  it("canvas + array node: a table with one column per element field (max 8, equal widths)", () => {
    const children = Array.from({ length: 10 }, (_, i) => ({ name: `F${i}`, path: `items.F${i}`, type: "string" as const }));
    const r = resolveDrop(f({ path: "items", type: "array", isArray: true, children }), { kind: "canvas", x: 10, y: 10 }, report, alloc);
    expect(r.action).toBe("addElement");
    if (r.action !== "addElement") return;
    expect(r.element).toMatchObject({ id: "table-9", type: "table", x: 10, y: 10, w: 80, h: 40, source: "orders.items" });
    const t = r.element as Extract<typeof r.element, { type: "table" }>;
    expect(t.columns).toHaveLength(8);
    expect(t.columns[0]).toMatchObject({ header: "F0", value: "{{ row.F0 }}", w: 10 });
    const rep = { ...report, repeat: { source: "orders", as: "record" } };
    expect((resolveDrop(f({ path: "items", type: "array", isArray: true, children }), { kind: "canvas", x: 0, y: 0 }, rep, alloc) as { element: { source: string } }).element.source).toBe("record.items");
    // 데이터셋 루트 노드(path "")는 데이터셋 전체가 소스다
    const root = resolveDrop(f({ path: "", type: "array", isArray: true, children: children.slice(0, 2) }), { kind: "canvas", x: 0, y: 0 }, report, alloc);
    expect(root).toMatchObject({ element: { type: "table", source: "orders", columns: [{ value: "{{ row.F0 }}" }, { value: "{{ row.F1 }}" }] } });
    expect(resolveDrop(f({ path: "", type: "array", isArray: true, children: [] }), { kind: "canvas", x: 0, y: 0 }, rep, alloc)).toMatchObject({ element: { source: "record" } });
  });
  it("table: a column with a source-relative row path, or a full path with a warning for another dataset", () => {
    const ok = resolveDrop(f({ path: "CUSTOMER.NAME" }), { kind: "table", tableId: "t" }, report, alloc);
    expect(ok).toEqual({ action: "addColumn", tableId: "t", column: { header: "NAME", value: "{{ row.CUSTOMER.NAME }}", w: 30, style: expect.any(Object) } });
    const other = resolveDrop(f({ dataset: "lots", path: "X" }), { kind: "table", tableId: "t" }, report, alloc);
    expect(other).toMatchObject({ action: "addColumn", column: { value: "{{ lots.X }}" }, warning: "표 소스와 다른 데이터셋" });
    expect(resolveDrop(f({}), { kind: "table", tableId: "t2" }, report, alloc)).toMatchObject({ action: "addColumn", column: { value: "{{ row.NO }}" } });   // 상대 소스는 신뢰
    expect(resolveDrop(f({}), { kind: "table", tableId: "nope" }, report, alloc)).toMatchObject({ action: "none" });
  });
  it("repeater item: a text inside the template bound to item.path", () => {
    const r = resolveDrop(f({ dataset: "lots", path: "NAME" }), { kind: "repeaterItem", repeaterId: "cards", x: 3, y: 4 }, report, alloc);
    expect(r).toMatchObject({ action: "addElement", into: { repeaterId: "cards", band: "item" }, element: { id: "text-9", x: 3, y: 4, value: "{{ item.NAME }}" } });
    expect(resolveDrop(f({ path: "NO" }), { kind: "repeaterItem", repeaterId: "cards", x: 0, y: 0 }, report, alloc)).toMatchObject({ element: { value: "{{ orders.NO }}" }, warning: "반복 영역 소스와 다른 데이터셋" });
  });
  it("array node onto a table or repeater item is refused", () => {
    expect(resolveDrop(f({ path: "items", type: "array", isArray: true }), { kind: "table", tableId: "t" }, report, alloc)).toMatchObject({ action: "none", warning: expect.any(String) });
    expect(resolveDrop(f({ path: "items", type: "array", isArray: true }), { kind: "repeaterItem", repeaterId: "cards", x: 0, y: 0 }, report, alloc)).toMatchObject({ action: "none" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- bindings`
Expected: FAIL — `resolveDrop` 없음.

- [ ] **Step 3: 구현**

`apps/studio/src/editor/data/bindings.ts` 끝에 추가:
```ts
import { StyleSchema, walkElements, type Element, type Report, type TableColumn } from "@daport/core";

export type DropTarget =
  | { kind: "canvas"; x: number; y: number }
  | { kind: "table"; tableId: string }
  | { kind: "repeaterItem"; repeaterId: string; x: number; y: number };
export type DropResult =
  | { action: "addElement"; element: Element; into?: { repeaterId: string; band: "item" }; warning?: string }
  | { action: "addColumn"; tableId: string; column: TableColumn; warning?: string }
  | { action: "none"; warning?: string };

const MAX_AUTO_COLUMNS = 8;
const last = (path: string) => path.split(".").at(-1) ?? path;

function findById(report: Report, id: string): Element | undefined {
  let found: Element | undefined;
  walkElements(report.elements, (el) => { if (el.id === id) { found = el; return true; } });
  return found;
}

/** 캔버스 기준 경로: repeat 소스 데이터셋의 필드면 record.path, 아니면 dataset.path. 루트 노드(path "")는 데이터셋 자체 */
function canvasPath(field: DragField, report: Report): string {
  const root = report.repeat && sourceDataset(report.repeat.source) === field.dataset ? report.repeat.as : field.dataset;
  return field.path ? `${root}.${field.path}` : root;
}

function textElement(id: string, x: number, y: number, value: string): Element {
  return { id, type: "text", x, y, w: 40, h: 8, value, flow: "once", style: StyleSchema.parse({}) };
}

/** 필드 드롭 규칙 (스펙 7.2). 순수 함수: 스토어 변경은 호출자가 한다 */
export function resolveDrop(field: DragField, target: DropTarget, report: Report, allocateId: (base: string) => string): DropResult {
  if (target.kind === "canvas") {
    if (field.isArray) {
      const cols = (field.children ?? []).filter((c) => c.type !== "object" && c.type !== "array").slice(0, MAX_AUTO_COLUMNS);
      const w = 80;
      const columns: TableColumn[] = cols.map((c) => ({ header: c.name, value: `{{ row.${c.name} }}`, w: Math.round((w / Math.max(1, cols.length)) * 100) / 100, style: StyleSchema.parse({}) }));
      const element: Element = { id: allocateId("table"), type: "table", x: target.x, y: target.y, w, h: 40, source: canvasPath(field, report), columns,
        repeatHeader: true, overflow: "continue", keepTogether: "row", rowHeight: 6, headerHeight: 7, border: "all",
        borderStyle: { stroke: "#000000", strokeWidth: 0.2 }, headerStyle: {}, groups: [], pageFooter: [], footer: [], flow: "once", style: StyleSchema.parse({}) };
      return { action: "addElement", element };
    }
    return { action: "addElement", element: textElement(allocateId("text"), target.x, target.y, `{{ ${canvasPath(field, report)} }}`) };
  }
  if (target.kind === "table") {
    const table = findById(report, target.tableId);
    if (!table || table.type !== "table") return { action: "none", warning: "표를 찾을 수 없습니다" };
    if (field.isArray) return { action: "none", warning: "배열은 표 열이 될 수 없습니다" };
    const src = sourceDataset(table.source);
    // 소스가 데이터셋 이름이면 그 데이터셋 필드만 row 상대. 상대 소스(record.items 등)는 어느 데이터셋인지 알 수 없어 row 상대로 신뢰한다
    const relative = src === undefined || src === field.dataset;
    const column: TableColumn = { header: last(field.path), value: relative ? `{{ row.${field.path} }}` : `{{ ${field.dataset}.${field.path} }}`, w: 30, style: StyleSchema.parse({}) };
    return relative ? { action: "addColumn", tableId: table.id, column } : { action: "addColumn", tableId: table.id, column, warning: "표 소스와 다른 데이터셋" };
  }
  const rep = findById(report, target.repeaterId);
  if (!rep || rep.type !== "repeater") return { action: "none", warning: "반복 영역을 찾을 수 없습니다" };
  if (field.isArray) return { action: "none", warning: "배열은 반복 항목 텍스트가 될 수 없습니다" };
  const src = sourceDataset(rep.source);
  const relative = src === undefined || src === field.dataset;
  const element = textElement(allocateId("text"), target.x, target.y, relative ? `{{ item.${field.path} }}` : `{{ ${field.dataset}.${field.path} }}`);
  const result: DropResult = { action: "addElement", element, into: { repeaterId: rep.id, band: "item" } };
  return relative ? result : { ...result, warning: "반복 영역 소스와 다른 데이터셋" };
}
```
(파일 상단의 기존 `import type { FieldNode, FieldType } from "@daport/core";`는 그대로 두고, 위 import를 그 아래에 둔다.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test -- bindings && pnpm --filter studio typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/editor/data
git commit -m "feat(studio): 필드 드롭 바인딩 규칙 — 캔버스·표·반복 항목·배열→표"
```

---

### Task 21: studio 표 속성 패널

**Files:**
- Create: `apps/studio/src/editor/panels/TablePanel.tsx`
- Modify: `apps/studio/src/editor/panels/PropertyPanel.tsx` (table이면 TablePanel)
- Test: `apps/studio/src/editor/__tests__/TablePanel.test.tsx`

**Interfaces:**
- Consumes: T13 `updateElement`; T1 `TableElement`, `TableCell`, `TableGroup`.
- Produces: `TablePanel({ el }: { el: TableElement })` — 소스, 열(추가·삭제·위아래·머리글·값·너비·정렬), 최소 행·머리 높이, 헤더 반복, 테두리, 그룹(기준·머리 셀·소계 셀), 페이지 소계, 표 합계.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/TablePanel.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, type TableElement } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

afterEach(cleanup);

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "A", value: "{{ row.A }}", w: 30 }, { header: "B", value: "{{ row.B }}", w: 30 }] },
]});

function setup() {
  const store = createEditorStore(report);
  store.getState().select(["t"]);
  const utils = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
  const table = () => store.getState().findElement("t") as TableElement;
  return { store, table, ...utils };
}

describe("TablePanel", () => {
  it("edits source, heights, repeatHeader and border", () => {
    const { getByLabelText, table } = setup();
    fireEvent.change(getByLabelText("소스"), { target: { value: "record.items" } });
    expect(table().source).toBe("record.items");
    fireEvent.change(getByLabelText("행 높이"), { target: { value: "8" } });
    fireEvent.change(getByLabelText("머리 높이"), { target: { value: "9" } });
    expect(table()).toMatchObject({ rowHeight: 8, headerHeight: 9 });
    fireEvent.click(getByLabelText("머리 반복"));
    expect(table().repeatHeader).toBe(false);
    fireEvent.change(getByLabelText("테두리"), { target: { value: "rows" } });
    expect(table().border).toBe("rows");
  });
  it("adds, edits, reorders and removes columns", () => {
    const { getByRole, getAllByRole, getAllByLabelText, table } = setup();
    fireEvent.click(getByRole("button", { name: "+ 열" }));
    expect(table().columns).toHaveLength(3);
    expect(table().columns[2]).toMatchObject({ header: "열 3", value: "", w: 30 });
    fireEvent.change(getAllByLabelText("머리글")[2], { target: { value: "C" } });
    fireEvent.change(getAllByLabelText("값")[2], { target: { value: "{{ row.C }}" } });
    fireEvent.change(getAllByLabelText("너비")[2], { target: { value: "20" } });
    fireEvent.change(getAllByLabelText("정렬")[2], { target: { value: "right" } });
    expect(table().columns[2]).toMatchObject({ header: "C", value: "{{ row.C }}", w: 20, align: "right" });
    fireEvent.click(getAllByRole("button", { name: "▲" })[2]);
    expect(table().columns.map((c) => c.header)).toEqual(["A", "C", "B"]);
    fireEvent.click(getAllByRole("button", { name: "▼" })[0]);
    expect(table().columns.map((c) => c.header)).toEqual(["C", "A", "B"]);
    fireEvent.click(getAllByRole("button", { name: "✕" })[0]);
    expect(table().columns.map((c) => c.header)).toEqual(["A", "B"]);
  });
  it("adds a group with header/footer cells, a page footer and a table footer", () => {
    const { getByRole, getAllByLabelText, getByLabelText, table } = setup();
    fireEvent.click(getByRole("button", { name: "+ 그룹" }));
    expect(table().groups).toEqual([{ by: "row.", header: [{ value: "{{ group.key }}", span: "all" }], footer: [], keepHeaderWithRows: true }]);
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "row.CAT" } });
    expect(table().groups[0].by).toBe("row.CAT");
    fireEvent.click(getByRole("button", { name: "+ 소계 셀" }));
    expect(table().groups[0].footer).toEqual([{ value: "", span: 1 }]);
    fireEvent.change(getAllByLabelText("셀 값")[1], { target: { value: "소계 {{ sum(group.rows, 'Q') }}" } });
    fireEvent.change(getAllByLabelText("span")[1], { target: { value: "all" } });
    expect(table().groups[0].footer[0]).toEqual({ value: "소계 {{ sum(group.rows, 'Q') }}", span: "all" });
    fireEvent.click(getByRole("button", { name: "+ 페이지 소계 셀" }));
    fireEvent.click(getByRole("button", { name: "+ 합계 셀" }));
    expect(table().pageFooter).toHaveLength(1);
    expect(table().footer).toHaveLength(1);
    fireEvent.click(getByRole("button", { name: "그룹 삭제" }));
    expect(table().groups).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- TablePanel`
Expected: FAIL — "소스" 라벨 없음.

- [ ] **Step 3: TablePanel.tsx 작성**

`apps/studio/src/editor/panels/TablePanel.tsx`:
```tsx
"use client";
import { StyleSchema, type TableCell, type TableColumn, type TableElement, type TableGroup } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, SelectField, CheckField } from "./Field";

const move = <T,>(arr: T[], i: number, d: -1 | 1): T[] => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const out = arr.slice(); [out[i], out[j]] = [out[j], out[i]]; return out; };
const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100";

/** span 있는 셀 목록 편집 (그룹 머리·소계, 페이지 소계, 합계) */
function CellsEditor({ label, cells, onChange, addLabel }: { label: string; cells: TableCell[]; onChange: (cells: TableCell[]) => void; addLabel: string }) {
  const set = (i: number, patch: Partial<TableCell>) => onChange(cells.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-1 border-l pl-2">
      <div className="text-xs text-neutral-500">{label}</div>
      {cells.map((c, i) => (
        <div key={i} className="flex flex-col gap-1">
          <TextField label="셀 값" value={c.value} onChange={(value) => set(i, { value })} />
          <div className="flex gap-1 items-center">
            <TextField label="span" value={String(c.span)} onChange={(v) => set(i, { span: v === "all" ? "all" : Math.max(1, Math.floor(Number(v)) || 1) })} />
            <SelectField label="셀 정렬" value={c.align ?? ""} options={["", "left", "center", "right"]} onChange={(v) => set(i, { align: (v || undefined) as TableCell["align"] })} />
            <button className={btn} aria-label="셀 삭제" onClick={() => onChange(cells.filter((_, k) => k !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => onChange([...cells, { value: "", span: 1 }])}>{addLabel}</button>
    </div>
  );
}

export function TablePanel({ el }: { el: TableElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const set = (patch: Partial<TableElement>) => updateElement(el.id, patch);
  const setCol = (i: number, patch: Partial<TableColumn>) => set({ columns: el.columns.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setGroup = (i: number, patch: Partial<TableGroup>) => set({ groups: el.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">표</div>
      <TextField label="소스" value={el.source} onChange={(source) => set({ source })} />
      <NumberField label="행 높이" value={el.rowHeight} min={0.5} onChange={(rowHeight) => set({ rowHeight })} />
      <NumberField label="머리 높이" value={el.headerHeight} min={0.5} onChange={(headerHeight) => set({ headerHeight })} />
      <CheckField label="머리 반복" value={el.repeatHeader} onChange={(repeatHeader) => set({ repeatHeader })} />
      <SelectField label="넘침" value={el.overflow} options={["continue", "clip"]} onChange={(overflow) => set({ overflow })} />
      <SelectField label="테두리" value={el.border} options={["all", "rows", "none"]} onChange={(border) => set({ border })} />
      <NumberField label="테두리 굵기" value={el.borderStyle.strokeWidth} step={0.1} min={0} onChange={(strokeWidth) => set({ borderStyle: { ...el.borderStyle, strokeWidth } })} />
      <TextField label="테두리색" value={el.borderStyle.stroke} onChange={(stroke) => set({ borderStyle: { ...el.borderStyle, stroke } })} />

      <div className="text-xs font-semibold mt-2">열</div>
      {el.columns.map((c, i) => (
        <div key={i} className="flex flex-col gap-1 border rounded p-1">
          <TextField label="머리글" value={c.header} onChange={(header) => setCol(i, { header })} />
          <TextField label="값" value={c.value} onChange={(value) => setCol(i, { value })} />
          <NumberField label="너비" value={c.w} min={1} onChange={(w) => setCol(i, { w })} />
          <SelectField label="정렬" value={c.align ?? ""} options={["", "left", "center", "right"]} onChange={(v) => setCol(i, { align: (v || undefined) as TableColumn["align"] })} />
          <div className="flex gap-1">
            <button className={btn} aria-label="▲" onClick={() => set({ columns: move(el.columns, i, -1) })}>▲</button>
            <button className={btn} aria-label="▼" onClick={() => set({ columns: move(el.columns, i, 1) })}>▼</button>
            <button className={btn} aria-label="✕" onClick={() => set({ columns: el.columns.filter((_, k) => k !== i) })}>✕</button>
          </div>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => set({ columns: [...el.columns, { header: `열 ${el.columns.length + 1}`, value: "", w: 30, style: StyleSchema.parse({}) }] })}>+ 열</button>

      <div className="text-xs font-semibold mt-2">그룹</div>
      {el.groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-1 border rounded p-1">
          <TextField label="그룹 기준" value={g.by} onChange={(by) => setGroup(i, { by })} />
          <CheckField label="머리와 행 함께" value={g.keepHeaderWithRows} onChange={(keepHeaderWithRows) => setGroup(i, { keepHeaderWithRows })} />
          <CellsEditor label="그룹 머리" cells={g.header} onChange={(header) => setGroup(i, { header })} addLabel="+ 머리 셀" />
          <CellsEditor label="그룹 소계" cells={g.footer} onChange={(footer) => setGroup(i, { footer })} addLabel="+ 소계 셀" />
          <button className={btn + " self-start"} onClick={() => set({ groups: el.groups.filter((_, k) => k !== i) })}>그룹 삭제</button>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => set({ groups: [...el.groups, { by: "row.", header: [{ value: "{{ group.key }}", span: "all" }], footer: [], keepHeaderWithRows: true }] })}>+ 그룹</button>

      <CellsEditor label="페이지 소계" cells={el.pageFooter} onChange={(pageFooter) => set({ pageFooter })} addLabel="+ 페이지 소계 셀" />
      <CellsEditor label="표 합계" cells={el.footer} onChange={(footer) => set({ footer })} addLabel="+ 합계 셀" />
    </div>
  );
}
```

`apps/studio/src/editor/panels/PropertyPanel.tsx`에 import `import { TablePanel } from "./TablePanel";`를 더하고, `{el.type === "text" && …}` 줄 앞에 `{el.type === "table" && <TablePanel el={el} />}`를 넣는다. 표에는 텍스트용 스타일 필드가 뜨지 않으므로 기존 스타일 절은 `el.type !== "table" && el.type !== "repeater"`일 때만 렌더하도록 `<div className="text-xs font-semibold mt-2">스타일</div>`부터 끝까지를 조건으로 감싼다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. 기존 `PropertyPanel.test.tsx`(텍스트·선·사각형)는 그대로 통과.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/editor
git commit -m "feat(studio): 표 속성 패널 — 소스·열·높이·테두리·그룹·페이지 소계·합계"
```

---

### Task 22: studio 반복 영역 패널, 팔레트, 레포트 반복 스위치

**Files:**
- Create: `apps/studio/src/editor/panels/RepeaterPanel.tsx`
- Modify: `apps/studio/src/editor/panels/PropertyPanel.tsx` (repeater면 RepeaterPanel), `apps/studio/src/editor/panels/ElementPalette.tsx` (반복 영역·표 추가, repeater 선택 시 템플릿에 추가), `apps/studio/src/editor/panels/PagePanel.tsx` (레코드마다 한 부씩 스위치)
- Test: `apps/studio/src/editor/__tests__/RepeaterPanel.test.tsx`, `apps/studio/src/editor/__tests__/panels.test.tsx`(추가)

**Interfaces:**
- Consumes: T13 `addElement(el, { into })`, `findParentRepeater`, `setRepeat`; T2 `RepeaterElement`.
- Produces: `RepeaterPanel({ el })`; 팔레트 항목 "표", "반복 영역"; PagePanel의 "레코드마다 한 부씩" 체크와 소스 입력.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/RepeaterPanel.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, type RepeaterElement } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

afterEach(cleanup);

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "cards", type: "repeater", x: 5, y: 20, w: 90, h: 60, source: "lots", item: { w: 30, h: 20, children: [] } },
]});

function setup() {
  const store = createEditorStore(report);
  store.getState().select(["cards"]);
  const utils = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
  return { store, rep: () => store.getState().findElement("cards") as RepeaterElement, ...utils };
}

describe("RepeaterPanel", () => {
  it("edits source, layout, gap, item size and overflow", () => {
    const { getByLabelText, rep } = setup();
    fireEvent.change(getByLabelText("소스"), { target: { value: "orders" } });
    fireEvent.change(getByLabelText("배치"), { target: { value: "grid" } });
    fireEvent.change(getByLabelText("가로 간격"), { target: { value: "2" } });
    fireEvent.change(getByLabelText("세로 간격"), { target: { value: "3" } });
    fireEvent.change(getByLabelText("항목 너비"), { target: { value: "40" } });
    fireEvent.change(getByLabelText("항목 높이"), { target: { value: "25" } });
    fireEvent.change(getByLabelText("넘침"), { target: { value: "clip" } });
    expect(rep()).toMatchObject({ source: "orders", layout: "grid", gap: [2, 3], item: { w: 40, h: 25 }, overflow: "clip" });
  });
  it("adds and edits groups with header/footer band heights and removes them", () => {
    const { getByRole, getByLabelText, rep } = setup();
    fireEvent.click(getByRole("button", { name: "+ 그룹" }));
    expect(rep().groups).toEqual([{ by: "item.", header: { h: 8, children: [] } }]);
    fireEvent.change(getByLabelText("그룹 기준"), { target: { value: "item.LINE" } });
    fireEvent.change(getByLabelText("머리 높이"), { target: { value: "10" } });
    expect(rep().groups[0]).toMatchObject({ by: "item.LINE", header: { h: 10 } });
    fireEvent.click(getByLabelText("소계 사용"));
    expect(rep().groups[0].footer).toEqual({ h: 6, children: [] });
    fireEvent.click(getByLabelText("머리 사용"));
    expect(rep().groups[0].header).toBeUndefined();
    fireEvent.click(getByRole("button", { name: "그룹 삭제" }));
    expect(rep().groups).toEqual([]);
  });
});
```

`apps/studio/src/editor/__tests__/panels.test.tsx` 끝에 추가:
```tsx
describe("palette (phase 2)", () => {
  it("adds a table and a repeater with a default template child", () => {
    const store = createEditorStore(report);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 표", exact: true }));
    expect(store.getState().findElement("table-1")).toMatchObject({ type: "table", source: "", columns: [{ header: "열 1" }] });
    fireEvent.click(getByRole("button", { name: "+ 반복 영역", exact: true }));
    const rep = store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>;
    expect(rep).toMatchObject({ type: "repeater", layout: "list", item: { w: 60, h: 20 } });
    expect(rep.item.children[0]).toMatchObject({ type: "text", value: "항목 {{ index + 1 }}" });
    expect(store.getState().selection).toEqual(["repeater-1"]);
  });
  it("adds into the selected repeater's template", () => {
    const store = createEditorStore(report);
    const { getByRole } = render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(getByRole("button", { name: "+ 반복 영역", exact: true }));
    fireEvent.click(getByRole("button", { name: "+ 사각형", exact: true }));
    const rep = store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>;
    expect(rep.item.children.map((c) => c.id)).toEqual(["text-1", "rect-1"]);
    store.getState().select(["rect-1"]);                                       // 템플릿 자식이 선택돼도 같은 템플릿에
    fireEvent.click(getByRole("button", { name: "+ 텍스트", exact: true }));
    expect((store.getState().findElement("repeater-1") as Extract<Element, { type: "repeater" }>).item.children.map((c) => c.id)).toEqual(["text-1", "rect-1", "text-2"]);
  });
});

describe("page panel repeat switch", () => {
  it("toggles repeat with a source expression", () => {
    const store = createEditorStore(report);
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PagePanel /></EditorContext.Provider>);
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    expect(store.getState().report.repeat).toEqual({ source: "", as: "record" });
    fireEvent.change(getByLabelText("반복 소스"), { target: { value: "shipments" } });
    expect(store.getState().report.repeat).toEqual({ source: "shipments", as: "record" });
    fireEvent.click(getByLabelText("레코드마다 한 부씩"));
    expect(store.getState().report.repeat).toBeUndefined();
  });
});
```
(파일 상단 import에 `ElementPalette`, `PagePanel`, `type Element`가 없으면 추가한다: `import { ElementPalette } from "../panels/ElementPalette"; import { PagePanel } from "../panels/PagePanel"; import { parseReport, type Element } from "@daport/core";`. `report`는 파일에 이미 있는 최소 레포트를 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- RepeaterPanel panels`
Expected: FAIL.

- [ ] **Step 3: RepeaterPanel.tsx 작성**

`apps/studio/src/editor/panels/RepeaterPanel.tsx`:
```tsx
"use client";
import type { RepeaterElement, RepeaterGroup } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, SelectField, CheckField } from "./Field";

const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100";

/** 반복 영역 속성 (스펙 7.3). 그룹 머리·소계의 자식은 JSON 편집기나 캔버스(선택 후 팔레트)로 넣는다 */
export function RepeaterPanel({ el }: { el: RepeaterElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const set = (patch: Partial<RepeaterElement>) => updateElement(el.id, patch);
  const setGroup = (i: number, patch: Partial<RepeaterGroup>) => set({ groups: el.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">반복 영역</div>
      <TextField label="소스" value={el.source} onChange={(source) => set({ source })} />
      <SelectField label="배치" value={el.layout} options={["list", "grid"]} onChange={(layout) => set({ layout })} />
      <NumberField label="가로 간격" value={el.gap[0]} min={0} onChange={(v) => set({ gap: [v, el.gap[1]] })} />
      <NumberField label="세로 간격" value={el.gap[1]} min={0} onChange={(v) => set({ gap: [el.gap[0], v] })} />
      <NumberField label="항목 너비" value={el.item.w} min={1} onChange={(w) => set({ item: { ...el.item, w } })} />
      <NumberField label="항목 높이" value={el.item.h} min={1} onChange={(h) => set({ item: { ...el.item, h } })} />
      <SelectField label="넘침" value={el.overflow} options={["continue", "clip"]} onChange={(overflow) => set({ overflow })} />

      <div className="text-xs font-semibold mt-2">그룹</div>
      {el.groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-1 border rounded p-1">
          <TextField label="그룹 기준" value={g.by} onChange={(by) => setGroup(i, { by })} />
          <CheckField label="머리 사용" value={!!g.header} onChange={(on) => setGroup(i, { header: on ? { h: 8, children: [] } : undefined })} />
          {g.header && <NumberField label="머리 높이" value={g.header.h} min={1} onChange={(h) => setGroup(i, { header: { ...g.header!, h } })} />}
          <CheckField label="소계 사용" value={!!g.footer} onChange={(on) => setGroup(i, { footer: on ? { h: 6, children: [] } : undefined })} />
          {g.footer && <NumberField label="소계 높이" value={g.footer.h} min={1} onChange={(h) => setGroup(i, { footer: { ...g.footer!, h } })} />}
          <div className="text-xs text-neutral-400">머리·소계 자식은 JSON 편집기에서 편집합니다</div>
          <button className={btn + " self-start"} onClick={() => set({ groups: el.groups.filter((_, k) => k !== i) })}>그룹 삭제</button>
        </div>
      ))}
      <button className={btn + " self-start"} onClick={() => set({ groups: [...el.groups, { by: "item.", header: { h: 8, children: [] } }] })}>+ 그룹</button>
    </div>
  );
}
```
`setGroup(i, { header: undefined })`은 `Object.assign`이 아니라 스프레드라 키가 `undefined`로 남는데, 스토어 `commit`이 JSON 복제로 지우므로 스키마 검증에 걸리지 않는다.

`apps/studio/src/editor/panels/PropertyPanel.tsx`에 `import { RepeaterPanel } from "./RepeaterPanel";`를 더하고 `{el.type === "table" && <TablePanel el={el} />}` 다음에 `{el.type === "repeater" && <RepeaterPanel el={el} />}`를 넣는다.

- [ ] **Step 4: 팔레트·페이지 패널 수정**

`apps/studio/src/editor/panels/ElementPalette.tsx` 전체:
```tsx
"use client";
import { StyleSchema, type Element } from "@daport/core";
import { useEditor } from "../store";

const defaultStyle = () => StyleSchema.parse({});   // core의 기본값을 그대로 쓴다

const ITEMS: { label: string; base: string; make: (id: string, alloc: (base: string) => string) => Element }[] = [
  { label: "텍스트", base: "text", make: (id) => ({ id, type: "text", x: 10, y: 10, w: 40, h: 8, value: "텍스트", flow: "once", style: defaultStyle() }) },
  { label: "이미지", base: "image", make: (id) => ({ id, type: "image", x: 10, y: 10, w: 30, h: 30, src: "", fit: "contain", flow: "once", style: defaultStyle() }) },
  { label: "선", base: "line", make: (id) => ({ id, type: "line", x: 10, y: 10, w: 50, h: 0, x2: 60, y2: 10, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "사각형", base: "rect", make: (id) => ({ id, type: "rect", x: 10, y: 10, w: 40, h: 20, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "페이지번호", base: "pn", make: (id) => ({ id, type: "pageNumber", x: 10, y: 10, w: 40, h: 6, format: "{{ page }} / {{ total }}", flow: "every", style: defaultStyle() }) },
  { label: "표", base: "table", make: (id) => ({ id, type: "table", x: 10, y: 10, w: 100, h: 40, source: "", columns: [{ header: "열 1", value: "", w: 50, style: defaultStyle() }],
    repeatHeader: true, overflow: "continue", keepTogether: "row", rowHeight: 6, headerHeight: 7, border: "all", borderStyle: { stroke: "#000000", strokeWidth: 0.2 },
    headerStyle: {}, groups: [], pageFooter: [], footer: [], flow: "once", style: defaultStyle() }) },
  { label: "반복 영역", base: "repeater", make: (id, alloc) => ({ id, type: "repeater", x: 10, y: 10, w: 100, h: 80, source: "", layout: "list", gap: [0, 2], overflow: "continue", groups: [],
    item: { w: 60, h: 20, children: [{ id: alloc("text"), type: "text", x: 2, y: 2, w: 50, h: 8, value: "항목 {{ index + 1 }}", flow: "once", style: defaultStyle() }] },
    flow: "once", style: defaultStyle() }) },
];

export function ElementPalette() {
  const addElement = useEditor((s) => s.addElement);
  const allocateId = useEditor((s) => s.allocateId);
  const selection = useEditor((s) => s.selection);
  const findElement = useEditor((s) => s.findElement);
  const findParentRepeater = useEditor((s) => s.findParentRepeater);
  // repeater(또는 그 템플릿 자식)가 선택돼 있으면 새 요소를 그 항목 템플릿에 넣는다 (R8). 반복 영역 자체는 항상 최상위
  const targetRepeater = (): string | undefined => {
    if (selection.length !== 1) return undefined;
    const sel = findElement(selection[0]);
    return sel?.type === "repeater" ? sel.id : findParentRepeater(selection[0]);
  };
  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="text-xs font-semibold mb-1">요소</div>
      {ITEMS.map((it) => (
        <button key={it.label} className="text-left text-xs border rounded px-2 py-1 hover:bg-neutral-100" onClick={() => {
          const el = it.make(allocateId(it.base), allocateId);
          const into = it.base === "repeater" ? undefined : targetRepeater();
          addElement(el, into ? { into: { repeaterId: into, band: "item" } } : undefined);
        }}>
          + {it.label}
        </button>
      ))}
    </div>
  );
}
```
주의: `make(id, alloc)`에서 템플릿 자식 id를 `alloc("text")`로 받을 때 `allocateId`는 현재 트리 기준이라 방금 만든 repeater id와 겹치지 않는다(`repeater-1` vs `text-1`).

`apps/studio/src/editor/panels/PagePanel.tsx`에 반복 스위치를 더한다. import에 `TextField, CheckField`를 추가하고 컴포넌트 안에:
```tsx
  const repeat = useEditor((s) => s.report.repeat);
  const setRepeat = useEditor((s) => s.setRepeat);
```
반환 JSX의 마지막 `NumberField` 뒤에:
```tsx
      <div className="text-xs font-semibold mt-2">반복</div>
      <CheckField label="레코드마다 한 부씩" value={!!repeat} onChange={(on) => setRepeat(on ? { source: "", as: "record" } : undefined)} />
      {repeat && <TextField label="반복 소스" value={repeat.source} onChange={(source) => setRepeat({ ...repeat, source })} />}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. 1단계 E2E가 `+ 텍스트`를 `exact: true`로 찾으므로 라벨은 그대로 둔다.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/editor
git commit -m "feat(studio): 반복 영역 패널, 팔레트 표·반복 영역 추가와 템플릿 삽입, 레포트 반복 스위치"
```

---
## 웨이브 5

### Task 23: studio 통합 — 필드 드래그 연결, 툴바 페이지 선택기, 실데이터 토글, 미리보기 data 전송

**Files:**
- Create: `apps/studio/src/editor/canvas/layoutCache.ts`, `apps/studio/src/editor/PageSelector.tsx`
- Modify: `apps/studio/src/lib/data.ts` (`requestBody`), `apps/studio/src/editor/canvas/Canvas.tsx` (드롭), `apps/studio/src/editor/Toolbar.tsx`, `apps/studio/src/editor/Preview.tsx`
- Test: `apps/studio/src/editor/__tests__/PageSelector.test.tsx`, `apps/studio/src/editor/canvas/__tests__/Canvas.drop.test.tsx`, `apps/studio/src/lib/__tests__/data.test.ts`(추가), `apps/studio/src/editor/__tests__/Toolbar.test.tsx`(추가), `apps/studio/src/editor/__tests__/Preview.test.tsx`(추가)

**Interfaces:**
- Consumes: T19 `clampView`, `currentPage`, `primaryItem`; T20 `resolveDrop`, `DRAG_MIME`, `DragField`, `DropTarget`; T13 `liveData`, `setLiveData`, `view`, `setView`, `addElement`, `findParentRepeater`; T15 응답 형식.
- Produces:
  ```ts
  // canvas/layoutCache.ts — 캔버스와 페이지 선택기가 같은 레이아웃을 쓴다 (report 객체마다 한 번)
  export function layoutFor(report: Report): Page[];
  // lib/data.ts
  export function requestBody(report: Report, liveData: boolean): { report: Report; params: Record<string, unknown>; data?: Record<string, unknown> };
  // PageSelector.tsx — data-testid page-indicator "n / N", copy-indicator "c / C"(repeat일 때), 버튼 aria-label 이전 페이지·다음 페이지·이전 부·다음 부
  export function PageSelector(): JSX.Element;
  ```
  캔버스 드롭: `data-testid="drop-warning"`에 경고 표시.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/data.test.ts` 끝에 추가:
```ts
describe("requestBody", () => {
  it("sends merged params and sample.data unless live data is on or there is no sample", () => {
    const r = parseReport({ ...base, params: [{ name: "lot" }], sample: { params: { lot: "L1" }, data: { s: [{ A: 1 }] }, capturedAt: "2026-09-17T00:00:00.000Z" } });
    expect(requestBody(r, false)).toEqual({ report: r, params: { lot: "L1" }, data: { s: [{ A: 1 }] } });
    expect(requestBody(r, true)).toEqual({ report: r, params: { lot: "L1" } });
    const plain = parseReport({ ...base, params: [{ name: "lot" }] });
    expect(requestBody(plain, false)).toEqual({ report: plain, params: { lot: "{lot}" } });
  });
});
```
(import 줄을 `import { sampleParams, sampleContext, requestBody } from "../data";`로 바꾼다.)

`apps/studio/src/editor/__tests__/PageSelector.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PageSelector } from "../PageSelector";

afterEach(cleanup);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100, margin: [5, 5, 5, 5] }, repeat: { source: "ships" },
  datasets: [{ name: "ships", type: "static", rows: [{ items: rows(20) }, { items: rows(1) }] }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "record.items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
]});

describe("PageSelector", () => {
  it("shows page/copy indicators and moves within limits", () => {
    const store = createEditorStore(report);
    const { getByTestId, getByRole } = render(<EditorContext.Provider value={store}><PageSelector /></EditorContext.Provider>);
    expect(getByTestId("page-indicator").textContent).toBe("1 / 3");
    expect(getByTestId("copy-indicator").textContent).toBe("1 / 2");
    expect((getByRole("button", { name: "이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByRole("button", { name: "다음 페이지" }));
    fireEvent.click(getByRole("button", { name: "다음 페이지" }));
    expect(store.getState().view).toEqual({ copyIndex: 0, pageInCopy: 2 });
    expect((getByRole("button", { name: "다음 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByRole("button", { name: "다음 부" }));
    expect(store.getState().view).toEqual({ copyIndex: 1, pageInCopy: 0 });
    expect(getByTestId("page-indicator").textContent).toBe("1 / 1");
    expect((getByRole("button", { name: "다음 부" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => store.getState().setRepeat(undefined));
    expect(getByTestId("page-indicator").textContent).toBe("1 / 1");                    // record가 없으면 record.items는 빈 배열 → 1장
  });
});
```

`apps/studio/src/editor/canvas/__tests__/Canvas.drop.test.tsx`:
```tsx
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport, type TableElement, type RepeaterElement } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";
import { DRAG_MIME, type DragField } from "../../data/bindings";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i, NAME: `n${i}` }));
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "items", type: "static", rows: rows(3) }, { name: "lots", type: "static", rows: rows(2) }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] },
  { id: "cards", type: "repeater", x: 5, y: 60, w: 90, h: 30, source: "lots", layout: "grid", item: { w: 30, h: 20, children: [{ id: "nm", type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.N }}" }] } },
]});
const px = (mm: number) => mmToPxScaled(mm, 1);
const field = (over: Partial<DragField> = {}): DragField => ({ dataset: "items", path: "NAME", type: "string", isArray: false, ...over });
const dt = (f: DragField) => ({ types: [DRAG_MIME], getData: (k: string) => (k === DRAG_MIME ? JSON.stringify(f) : ""), dropEffect: "copy" });

function mount(store: EditorStore) {
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  return { ...utils, q: (sel: string) => utils.container.querySelector(sel) as HTMLElement, all: (sel: string) => Array.from(utils.container.querySelectorAll<HTMLElement>(sel)) };
}
beforeAll(() => { Element.prototype.setPointerCapture = () => {}; });
afterEach(cleanup);

describe("Canvas drop", () => {
  it("drops a dataset root on the empty page as a table at the snapped position", () => {
    const store = createEditorStore(report);
    const { q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: px(70.3), clientY: px(10.2), dataTransfer: dt(field({ path: "", type: "array", isArray: true, children: [{ name: "N", path: "N", type: "number" }] })) });
    expect(store.getState().findElement("table-1")).toMatchObject({ type: "table", x: 70.5, y: 10, source: "items", columns: [{ value: "{{ row.N }}" }] });
    expect(store.getState().selection).toEqual(["table-1"]);
  });
  it("drops a field on a table cell or flowBox as a new column", () => {
    const store = createEditorStore(report);
    const { all, q } = mount(store);
    fireEvent.drop(all('[data-element-id="t"][data-role="cell"]')[1], { clientX: px(10), clientY: px(30), dataTransfer: dt(field()) });
    expect((store.getState().findElement("t") as TableElement).columns.map((c) => c.value)).toEqual(["{{ row.N }}", "{{ row.NAME }}"]);
    fireEvent.drop(q('[data-element-id="t"][data-role="flowBox"]'), { clientX: px(10), clientY: px(30), dataTransfer: dt(field({ dataset: "lots", path: "X" })) });
    expect((store.getState().findElement("t") as TableElement).columns).toHaveLength(3);
    expect(q('[data-testid="drop-warning"]').textContent).toContain("다른 데이터셋");
  });
  it("drops a field on the template slot or on any instance child as a text inside the item template", () => {
    const store = createEditorStore(report);
    const { q, all } = mount(store);
    fireEvent.drop(q('[data-element-id="cards"][data-role="template"]'), { clientX: px(15), clientY: px(70), dataTransfer: dt(field({ dataset: "lots", path: "NAME" })) });
    let cards = store.getState().findElement("cards") as RepeaterElement;
    expect(cards.item.children.map((c) => c.id)).toEqual(["nm", "text-1"]);
    expect(cards.item.children[1]).toMatchObject({ x: 10, y: 10, value: "{{ item.NAME }}" });               // 템플릿 원점(5,60) 기준
    fireEvent.drop(all('[data-element-id="nm"]')[1], { clientX: px(40), clientY: px(65), dataTransfer: dt(field({ dataset: "lots", path: "N" })) });
    cards = store.getState().findElement("cards") as RepeaterElement;
    expect(cards.item.children.map((c) => c.id)).toEqual(["nm", "text-1", "text-2"]);
    expect(cards.item.children[2]).toMatchObject({ x: 5, y: 5, value: "{{ item.N }}" });                   // 두 번째 항목(35,60) 기준 → 템플릿 상대
  });
  it("ignores drops without the field mime", () => {
    const store = createEditorStore(report);
    const { q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: 10, clientY: 10, dataTransfer: { types: ["text/plain"], getData: () => "" } });
    expect(store.getState().report.elements).toHaveLength(2);
  });
});
```

`apps/studio/src/editor/__tests__/Toolbar.test.tsx` 끝에 추가:
```tsx
  it("sends sample data with the PDF request unless live data is on, and renders the page selector", async () => {
    const { store, fetchMock } = setup();
    act(() => store.getState().setSample({ params: { lot: "L1", qty: 2 }, data: { s: [{ A: 1 }] }, capturedAt: "2026-09-17T00:00:00.000Z" }));
    fetchMock.mockResolvedValue(new Response(new Blob(["%PDF-"]), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.params).toEqual({ lot: "L1", qty: 2 });
    expect(body.data).toEqual({ s: [{ A: 1 }] });
    fireEvent.click(screen.getByLabelText("실데이터"));
    expect(store.getState().liveData).toBe(true);
    await waitFor(() => expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).data).toBeUndefined();
    expect(screen.getByTestId("page-indicator").textContent).toBe("1 / 1");
  });
```

`apps/studio/src/editor/__tests__/Preview.test.tsx` 끝에 추가 (import 줄을 `import { render, cleanup, act, waitFor } from "@testing-library/react";`로 바꾼다):
```tsx
  it("posts sample data and lists dataset errors from a 400 response", async () => {
    // 실제 타이머로 디바운스(150ms)와 응답 처리를 기다린다
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: "데이터셋 실행 실패", datasetErrors: [{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: x" }] }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(parseReport({ ...report, sample: { params: {}, data: { h: [{ A: 1 }] }, capturedAt: "2026-09-17T00:00:00.000Z" } }));
    const { container } = render(<EditorContext.Provider value={store}><Preview reportId="r" /></EditorContext.Provider>);
    await waitFor(() => expect(container.textContent).toContain("h: HOST_NOT_ALLOWED"), { timeout: 3000 });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).data).toEqual({ h: [{ A: 1 }] });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- data PageSelector Canvas.drop Toolbar Preview`
Expected: FAIL.

- [ ] **Step 3: layoutCache.ts, requestBody, PageSelector.tsx 작성**

`apps/studio/src/editor/canvas/layoutCache.ts`:
```ts
import type { Report } from "@daport/core";
import { layout } from "@daport/renderer/layout";
import type { Page } from "@daport/renderer";
import { sampleContext } from "@/lib/data";
import { resolveAssetUrls } from "@/lib/assets";

const cache = new WeakMap<Report, Page[]>();

/**
 * 캔버스가 그리는 레이아웃. 스토어의 report 객체는 편집마다 새로 만들어지므로 객체를 키로 한 번만 계산해
 * 캔버스와 페이지 선택기가 같은 결과를 쓴다. 스펙 10: 디자이너는 표현식 오류를 요소마다 #ERR로 보인다
 */
export function layoutFor(report: Report): Page[] {
  let pages = cache.get(report);
  if (!pages) {
    pages = layout({ ...resolveAssetUrls(report, ""), onExpressionError: "blank" }, sampleContext(report));
    cache.set(report, pages);
  }
  return pages;
}
```

`apps/studio/src/lib/data.ts` 끝에 추가:
```ts
/** 미리보기·PDF 요청 본문 (스펙 7.5). 편집 중에는 sample.data를 보내 서버 데이터셋을 실행하지 않는다. 실데이터 토글이 켜지면 data를 빼고 보낸다 */
export function requestBody(report: Report, liveData: boolean): { report: Report; params: Record<string, unknown>; data?: Record<string, unknown> } {
  const body = { report, params: { ...sampleParams(report), ...report.sample?.params } };
  return liveData || !report.sample ? body : { ...body, data: report.sample.data };
}
```

`apps/studio/src/editor/PageSelector.tsx`:
```tsx
"use client";
import { useMemo } from "react";
import { useEditor } from "./store";
import { layoutFor } from "./canvas/layoutCache";
import { clampView } from "./canvas/pages";

const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100 disabled:opacity-40";

/** 툴바의 페이지·부 선택기 (스펙 7.4). repeat가 있을 때만 부 선택기가 보인다 */
export function PageSelector() {
  const report = useEditor((s) => s.report);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const pages = useMemo(() => layoutFor(report), [report]);
  const v = clampView(view, pages);
  const copies = pages.length ? pages[pages.length - 1].copyIndex + 1 : 1;
  const inCopy = pages.filter((p) => p.copyIndex === v.copyIndex).length || 1;
  return (
    <div className="flex items-center gap-1 text-xs" data-testid="page-selector">
      <button className={btn} aria-label="이전 페이지" disabled={v.pageInCopy <= 0} onClick={() => setView({ pageInCopy: v.pageInCopy - 1 })}>◀</button>
      <span data-testid="page-indicator">{v.pageInCopy + 1} / {inCopy}</span>
      <button className={btn} aria-label="다음 페이지" disabled={v.pageInCopy >= inCopy - 1} onClick={() => setView({ pageInCopy: v.pageInCopy + 1 })}>▶</button>
      {report.repeat && <>
        <span className="text-neutral-400 ml-2">부</span>
        <button className={btn} aria-label="이전 부" disabled={v.copyIndex <= 0} onClick={() => setView({ copyIndex: v.copyIndex - 1, pageInCopy: 0 })}>◀</button>
        <span data-testid="copy-indicator">{v.copyIndex + 1} / {copies}</span>
        <button className={btn} aria-label="다음 부" disabled={v.copyIndex >= copies - 1} onClick={() => setView({ copyIndex: v.copyIndex + 1, pageInCopy: 0 })}>▶</button>
      </>}
    </div>
  );
}
```

- [ ] **Step 4: Canvas.tsx에 드롭 추가**

`apps/studio/src/editor/canvas/Canvas.tsx`를 고친다.

import를 바꾸고 더한다:
```tsx
import { useEffect, useMemo, useState, type DragEvent, type PointerEvent } from "react";
import type { PlacedItem } from "@daport/renderer";
import { PaintPage, pageCss, fontFaceCss } from "@daport/renderer/paint";
import { useEditor, lineBox } from "../store";
import { useDrag, type Box, type Handle } from "./useDrag";
import { SelectionBox } from "./SelectionBox";
import { pxToMm, snapMm } from "./snap";
import { clampView, currentPage, primaryItem, isOtherInstance } from "./pages";
import { layoutFor } from "./layoutCache";
import { resolveDrop, DRAG_MIME, type DragField, type DropTarget } from "../data/bindings";
```
(`layout`, `sampleContext`, `resolveAssetUrls` import는 지운다.)

컴포넌트 안에서 `data`·`pages` 계산을 바꾸고 액션을 더한다:
```tsx
  const addElement = useEditor((s) => s.addElement);
  const updateElement = useEditor((s) => s.updateElement);
  const allocateId = useEditor((s) => s.allocateId);
  const findParentRepeater = useEditor((s) => s.findParentRepeater);
  const [warning, setWarning] = useState<string | null>(null);
  const pages = useMemo(() => layoutFor(report), [report]);
```
(`const data = useMemo(...)` 줄은 삭제.)

`onHandleDown` 아래에 드롭 처리를 더한다:
```tsx
  /** 놓인 자리의 대상: 표(셀·테두리·flowBox), 반복 영역 템플릿(템플릿 자리·어느 인스턴스든), 그 밖은 빈 캔버스 */
  const dropTargetAt = (e: DragEvent<HTMLDivElement>, x: number, y: number): DropTarget => {
    const root = e.currentTarget;
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(e.clientX, e.clientY) : [e.target as Element];
    const templateOf = (repeaterId: string): DropTarget => {
      const t = page.items.find((i) => i.role === "template" && i.elementId === repeaterId);
      return t ? { kind: "repeaterItem", repeaterId, x: snapMm(x - t.x), y: snapMm(y - t.y) } : { kind: "canvas", x, y };
    };
    for (const node of stack) {
      if (!root.contains(node)) continue;
      const host = node.closest("[data-element-id]");
      const id = host?.getAttribute("data-element-id");
      if (!host || !id) continue;
      const role = host.getAttribute("data-role");
      const el = findElement(id);
      if (el?.type === "table") return { kind: "table", tableId: id };
      if (el?.type === "repeater" && (role === "flowBox" || role === "template")) return templateOf(id);
      const rep = findParentRepeater(id);
      if (rep) {
        // 인스턴스 자식 위에 놓으면 그 인스턴스의 원점 기준 상대좌표를 템플릿 좌표로 쓴다
        const inst = host.getAttribute("data-instance");
        const slot = page.items.find((i) => i.role === "template" && i.elementId === rep);
        const first = page.items.find((i) => i.elementId === id && i.instance === inst);
        const tmpl = primaryItem(page, id);
        if (slot && first && tmpl) return { kind: "repeaterItem", repeaterId: rep, x: snapMm(x - (first.x - tmpl.x) - slot.x), y: snapMm(y - (first.y - tmpl.y) - slot.y) };
        return templateOf(rep);
      }
    }
    return { kind: "canvas", x, y };
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => { if (Array.from(e.dataTransfer.types).includes(DRAG_MIME)) e.preventDefault(); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const field = JSON.parse(raw) as DragField;
    const origin = e.currentTarget.querySelector(".dp-page")?.getBoundingClientRect();
    const x = snapMm(pxToMm(e.clientX - (origin?.left ?? 0), zoom)), y = snapMm(pxToMm(e.clientY - (origin?.top ?? 0), zoom));
    const result = resolveDrop(field, dropTargetAt(e, x, y), report, allocateId);
    if (result.action === "addElement") addElement(result.element, result.into ? { into: result.into } : undefined);
    else if (result.action === "addColumn") { const t = findElement(result.tableId); if (t?.type === "table") updateElement(t.id, { columns: [...t.columns, result.column] }); }
    setWarning(result.warning ?? null);
  };
```

반환 JSX의 바깥 div에 `onDragOver={onDragOver} onDrop={onDrop}`를 더하고, 오버레이 div 안 마지막에:
```tsx
        {warning && <div data-testid="drop-warning" role="status" className="absolute left-2 top-2 text-xs bg-amber-100 border border-amber-400 rounded px-2 py-1">{warning}</div>}
```

- [ ] **Step 5: Toolbar.tsx, Preview.tsx 수정**

`apps/studio/src/editor/Toolbar.tsx`:
- import를 `import { requestBody } from "@/lib/data";`로 바꾸고 `import { PageSelector } from "./PageSelector";`를 더한다.
- 상태 읽기에 `const liveData = useEditor((s) => s.liveData); const setLiveData = useEditor((s) => s.setLiveData);`를 더한다.
- `pdf`의 요청 본문을 `body: JSON.stringify(requestBody(report, liveData))`로 바꾼다.
- 배율 라벨 다음에 `<PageSelector />`와 실데이터 토글을 넣는다:
```tsx
      <PageSelector />
      <label className="text-xs flex items-center gap-1 ml-2"><input type="checkbox" aria-label="실데이터" checked={liveData} onChange={(e) => setLiveData(e.target.checked)} />실데이터</label>
```

`apps/studio/src/editor/Preview.tsx`:
- import를 `import { requestBody } from "@/lib/data";`로 바꾸고 `const liveData = useEditor((s) => s.liveData);`를 더한다. effect 의존성에 `liveData`를 넣는다.
- fetch 본문을 `body: JSON.stringify(requestBody(report, liveData))`로 바꾼다.
- 실패 응답 처리를 데이터셋 오류 목록까지 보이게 바꾼다:
```tsx
        .then(async (r) => {
          if (r.ok) return r.text();
          const body = await r.json().catch(() => ({}));
          const lines = Array.isArray(body.datasetErrors) ? body.datasetErrors.map((d: { dataset: string; code: string; message: string }) => `${d.dataset}: ${d.code} — ${d.message}`) : [];
          throw new Error([typeof body.error === "string" ? body.error : `미리보기 실패 (HTTP ${r.status})`, ...lines].join("\n"));
        })
```
- 오류 표시 div에 `whitespace-pre-wrap` 클래스를 더한다.

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS (1단계 Toolbar·Preview·Canvas 테스트 포함).

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): 필드 드롭 연결, 툴바 페이지·부 선택기, 실데이터 토글, 미리보기·PDF 샘플 데이터 전송"
```

---

### Task 24: 예제 시드와 2단계 E2E

**Files:**
- Modify: `apps/studio/src/lib/report-store.ts` (메모리 저장소 시드에 예제 4종 추가), `apps/studio/scripts/seed.ts`
- Create: `apps/studio/e2e/phase2.spec.ts`

**Interfaces:**
- Consumes: T17 fixtures; T16·T19·T22·T23 UI(라벨·testid); T15 라우트.
- Produces: 스펙 9장 E2E 시나리오와 완료 기준 5·6.

- [ ] **Step 1: 시드 확장**

`apps/studio/src/lib/report-store.ts`에서 fixture import를 다섯 개로 늘리고 시드를 바꾼다:
```ts
import qualityCert from "../../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json";
import inspectionCert from "../../../../packages/renderer/src/__tests__/fixtures/inspection-cert.report.json";
import invoice from "../../../../packages/renderer/src/__tests__/fixtures/invoice.report.json";
import shippingOrder from "../../../../packages/renderer/src/__tests__/fixtures/shipping-order.report.json";
import badgeSheet from "../../../../packages/renderer/src/__tests__/fixtures/badge-sheet.report.json";

/** dev 서버·E2E가 여는 예제. 예제 전용 코드는 없고 JSON만 넣는다 */
export const SEED_FIXTURES: unknown[] = [qualityCert, inspectionCert, invoice, shippingOrder, badgeSheet];
```
`getStore()`의 시드 줄을:
```ts
    if (!process.env.DATABASE_URL) holder.__daportSeeded = Promise.all(SEED_FIXTURES.map((f) => store.create(f as ReportInput))).then(() => {});
```
`apps/studio/scripts/seed.ts`:
```ts
import { DbReportStore, SEED_FIXTURES } from "../src/lib/report-store";
import type { ReportInput } from "@daport/core";
const s = new DbReportStore();
Promise.all(SEED_FIXTURES.map((f) => s.create(f as ReportInput).then(() => console.log(`seeded ${(f as { id: string }).id}`)).catch((e) => console.error(e.message))))
  .then(() => process.exit(0));
```

- [ ] **Step 2: E2E 작성**

`apps/studio/e2e/phase2.spec.ts`:
```ts
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const MIME = "application/x-daport-field";
const rows = Array.from({ length: 120 }, (_, i) => ({ N: i + 1, NAME: `품목 ${i + 1}`, QTY: (i * 7) % 50 }));

/** 홈 화면 폼으로 빈 A4 레포트를 만들고 캔버스가 뜰 때까지 기다린다 */
async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID").fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

/** 데이터 탭에서 static 데이터셋을 만들고 샘플을 가져와 필드 트리가 뜨게 한다 */
async function addStaticDataset(page: Page, name: string, data: unknown[]) {
  await page.getByRole("button", { name: "데이터" }).click();
  await page.getByRole("button", { name: "+ static" }).click();
  await page.getByLabel("이름").fill(name);
  await page.getByLabel("행(JSON)").fill(JSON.stringify(data));
  await page.getByTestId("fetch-sample").click();
  await expect(page.getByTestId(`fields-${name}`).locator('[data-path="N"]')).toBeVisible();
}

test("static dataset → sample → drag dataset root onto the canvas → multi-page table → preview pages → PDF page count", async ({ page }) => {
  const id = `e2e-table-${Date.now()}`;
  await createReport(page, id);
  await addStaticDataset(page, "items", rows);

  // 필드 트리 루트 노드를 캔버스에 놓는다. HTML5 DnD는 DataTransfer를 직접 만들어 drop을 보낸다
  const dt = await page.evaluateHandle((mime) => {
    const dt = new DataTransfer();
    dt.setData(mime, JSON.stringify({ dataset: "items", path: "", type: "array", isArray: true,
      children: [{ name: "N", path: "N", type: "number" }, { name: "NAME", path: "NAME", type: "string" }, { name: "QTY", path: "QTY", type: "number" }] }));
    return dt;
  }, MIME);
  const canvas = page.getByTestId("canvas");
  const box = (await canvas.locator(".dp-page").boundingBox())!;
  await canvas.locator(".dp-page").dispatchEvent("drop", { dataTransfer: dt, clientX: box.x + 40, clientY: box.y + 120 });
  await expect(canvas.locator('[data-element-id="table-1"][data-role="flowBox"]')).toBeVisible();
  await expect(canvas.locator('[data-element-id="table-1"][data-role="cell"]').first()).toBeVisible();

  // 120행이 40mm 영역을 넘어 여러 페이지가 되고 페이지 선택기로 이동한다
  await expect(page.getByTestId("page-indicator")).toHaveText(/^1 \/ [2-9]$/);
  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(canvas.locator(".dp-page")).toHaveAttribute("data-page-index", "1");
  const total = Number((await page.getByTestId("page-indicator").textContent())!.split("/")[1].trim());

  // 미리보기 iframe에도 여러 페이지
  await page.getByRole("button", { name: "미리보기" }).click();
  await expect(page.frameLocator('iframe[title="preview"]').locator(".dp-page").nth(1)).toBeAttached({ timeout: 15_000 });
  await page.getByRole("button", { name: "디자인" }).click();

  // 저장 후 PDF 페이지 수 = 캔버스 페이지 수 (완료 기준 6)
  const save = page.getByTestId("save");
  await save.click();
  await expect(save).toBeDisabled();
  const res = await page.request.post(`/api/reports/${id}/pdf`, { data: {} });
  expect(res.ok(), `PDF HTTP ${res.status()}`).toBe(true);
  expect((await PDFDocument.load(await res.body())).getPageCount()).toBe(total);
});

test("repeater: editing the template text updates every instance; page selector moves to the next page", async ({ page }) => {
  const id = `e2e-rep-${Date.now()}`;
  await createReport(page, id);
  await addStaticDataset(page, "items", rows.slice(0, 30));
  await page.getByRole("button", { name: "요소" }).click();
  await page.getByRole("button", { name: "+ 반복 영역", exact: true }).click();
  await page.getByLabel("소스").fill("items");

  const canvas = page.getByTestId("canvas");
  const instances = canvas.locator('[data-element-id="text-1"]');
  await expect(instances.first()).toBeVisible();
  await expect.poll(() => instances.count()).toBeGreaterThan(1);              // 80mm 영역에 22mm 항목 3개
  const n = await instances.count();

  // 두 번째 인스턴스를 눌러도 템플릿 자식이 선택되고, 내용을 바꾸면 모든 인스턴스에 반영된다
  await instances.nth(1).click();
  await page.getByLabel("내용").fill("{{ item.NAME }}");
  await expect(instances.first()).toHaveText(/품목 1/);
  await expect(instances.nth(1)).toHaveText(/품목 2/);
  await expect(canvas.locator('[data-element-id="text-1"]:has-text("품목")')).toHaveCount(n);

  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(canvas.locator(".dp-page")).toHaveAttribute("data-page-index", "1");
  await expect(instances.first()).toHaveText(new RegExp(`품목 ${n + 1}`));
});

test("seeded inspection certificate: copy and page selectors, repeated header on the next page", async ({ page }) => {
  await page.goto("/reports/inspection-cert");
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-element-id="results"][data-role="flowBox"]')).toBeVisible();
  await expect(page.getByTestId("copy-indicator")).toHaveText("1 / 2");
  await expect(page.getByTestId("page-indicator")).toHaveText(/^1 \/ [2-9]$/);
  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(canvas.locator('[data-instance="results#h"]').first()).toBeVisible();   // 머리 반복
  await page.getByRole("button", { name: "다음 부" }).click();
  await expect(page.getByTestId("copy-indicator")).toHaveText("2 / 2");
  await expect(page.getByTestId("page-indicator")).toHaveText("1 / 1");
  await expect(canvas.locator('[data-element-id="v2"]')).toHaveText(/L-002/);
});
```

- [ ] **Step 3: 실행**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter studio e2e`
Expected: 단위 PASS(시드 변경으로 `preview-route.test.ts`의 "renders the seeded quality certificate"가 그대로 통과), E2E 1단계 3개 + 2단계 3개 PASS. dev 서버가 이미 떠 있으면 재사용된다(`reuseExistingServer`). 시드가 바뀌었으니 떠 있던 서버는 재시작한다.

- [ ] **Step 4: 전체 검증과 Commit**

Run: `pnpm typecheck && pnpm test`
Expected: 모든 패키지 PASS.

```bash
git add apps/studio
git commit -m "test(studio): 예제 4종 시드, 2단계 E2E — 데이터셋·샘플·드래그 표·여러 페이지·PDF·반복 영역·페이지 선택"
```

---

## 완료 기준 대응표 (스펙 10장)

| 완료 기준 | 검증하는 태스크 |
|---|---|
| 1. 500행 표 여러 페이지, 헤더 반복, 그룹 머리·소계, 페이지 소계, 표 합계 | T7 불변식, T10 표 흐름(500행 e2e 테스트), T14 조립, T17 검사증명서 골든 |
| 2. repeat N건 → N부, page·total은 부마다, sheet·sheets는 전체 | T14 "repeat: one copy per record…", T17 검사증명서·송장 골든 |
| 3. 반복 영역 list·grid가 그룹과 함께 페이지를 넘김 | T11 반복 영역 흐름, T17 출하지시서·명찰 골든 |
| 4. 미리보기·PDF가 요청 data 우선, http 허용 호스트·비밀값·한도, SQL 커넥터 경계 | T8·T9·T12 datasource, T15 라우트 |
| 5. 스튜디오 샘플 가져오기, 필드 트리, 드래그 바인딩, 표·반복 영역·레포트 반복 편집, 페이지·부 선택 (E2E) | T16·T19·T20·T21·T22·T23, T24 E2E |
| 6. 예제 4종 여러 페이지 PDF, 페이지별 픽셀 비교 | T18 |
| 7. 행 1만 건 표 레이아웃 시간 | T4 컴파일 캐시, T10 성능 테스트, T17 perf.test |

## 웨이브 병합 절차

1. 웨이브의 각 레인을 `git worktree add ../daport-<lane> -b lane/<lane> feature/phase2`로 만들어 태스크를 순서대로 실행한다.
2. 레인이 끝나면 `feature/phase2`에서 `git merge --no-ff lane/<lane>`. 충돌은 공용 규약대로 해소한다(`index.ts` 재export 줄은 양쪽을 모두 남긴다).
3. 웨이브 병합 후 루트에서 `pnpm install && pnpm typecheck && pnpm test`. 골든 스냅샷이 바뀌면 diff를 읽고 의도한 변화만 `-u`로 받는다.
4. 웨이브 5까지 끝나면 `pnpm --filter studio e2e`를 돌리고 main에 병합한다.
