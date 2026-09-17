# daport 2단계 구현 플랜: 데이터 반복과 데이터 계층 (초안)

> **상태: 작성 중인 초안.** 공용 규약(스펙 반박 검토 반영본 기준)과 태스크 구성만 들어 있다. 태스크별 본문(TDD 단계와 코드)은 아직 없다. 이 상태로는 실행하지 않는다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표 넘김, 레코드마다 한 부씩, 자유 배치 반복 영역, 그룹 머리·소계를 공통 흐름 엔진으로 구현하고, 요청 데이터 우선·http·SQL 경계를 갖춘 데이터 계층과 스튜디오 편집 기능을 만든다.

**Architecture:** core에 스키마·요소 트리 탐색(`childLists`)·이름 규칙·소스 표현식·필드 추론·컨텍스트 병합(`normalizeRows`, `buildContext`)을 더한다. renderer는 표·반복 영역을 조각(Block)으로 바꾸고 공용 `paginate`와 페이지 조립으로 여러 페이지를 만든다(순수 함수 유지). 네트워크는 새 패키지 `@daport/datasource`만 쓰며 studio 서버 라우트가 조립한다. 캔버스는 서버 데이터셋을 실행하지 않고 레포트 안의 static 행과 `sample` 데이터를 `buildContext`로 병합해 그린다.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, zod 4, jexl, React 19, Next.js 16, zustand 5, Playwright.

스펙: `docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md`

---

## 공용 규약 (모든 태스크가 따르는 이름과 타입)

이 절의 이름·시그니처·파일 경로·오류 코드는 태스크 사이의 계약이다. 태스크 본문은 이 규약과 다른 이름을 쓰면 안 된다. 규약과 스펙이 어긋나 보이면 스펙(`docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md`)이 이기고, 규약을 먼저 고친 뒤 진행한다. 괄호 안 숫자(예: 5.2)는 스펙 절 번호다.

### 테스트·명령 규약

- 패키지 단위 명령: `pnpm --filter <pkg> test`, `pnpm --filter <pkg> typecheck`. `<pkg>`는 `@daport/core`, `@daport/renderer`, `@daport/datasource`, `@daport/pdf`, `studio`다. 루트의 `pnpm test`(vitest 워크스페이스 `packages/*`, `apps/*`)와 `pnpm typecheck`는 웨이브 병합 뒤 전체 확인에 쓴다.
- E2E: `pnpm --filter studio e2e` (Playwright, `apps/studio/e2e/*.spec.ts`).
- 테스트 파일 이름: 패키지는 `src/__tests__/<주제>.test.ts`(React가 있으면 `.test.tsx`), 세부 주제는 점으로 잇는다(예: `flow.paginate.test.ts`, `layout.errors.test.ts`). studio는 대상 파일 옆 `__tests__/` 디렉터리에 둔다(예: `src/editor/data/__tests__/bindings.test.ts`). 스냅샷은 vitest 기본 `__snapshots__/`.
- 새 패키지 `@daport/datasource`는 기존 패키지와 같은 모양으로 만든다: `package.json`(`"type": "module"`, `main`·`types`·`exports`가 `./src/index.ts`, 스크립트 `build`·`typecheck` = `tsc -p tsconfig.json --noEmit`, `test` = `vitest run`), `tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.
- 예제(fixture) 위치: `packages/renderer/src/__tests__/fixtures/`. 레포트는 `<이름>.report.json`, 샘플 데이터는 `<이름>.data.json`(요청 `data`와 같은 모양). pdf·studio 테스트와 E2E는 이 경로를 상대 경로로 가져온다(1단계 `quality-cert.report.json`과 같은 방식). 예제 전용 코드는 만들지 않는다(9.1).
- 무작위 속성 테스트는 시드 고정 생성기를 쓴다. 생성기는 `packages/renderer/src/__tests__/helpers/random.ts`의 `export function seeded(seed: number): () => number` 하나로 모은다.
- 커밋 메시지: `type(scope): 한국어 설명`. type은 `feat`·`fix`·`test`·`refactor`·`docs`·`chore`, scope는 `core`·`renderer`·`datasource`·`pdf`·`studio`(여럿이면 쉼표). 본문 끝에 빈 줄 하나를 두고 다음 트레일러를 붙인다.
  ```
  feat(renderer): paginate와 불변식 테스트

  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

### core (`packages/core`)

`src/schema/style.ts` (4.3 스타일 병합)
```ts
/** StyleSchema의 모든 필드를 기본값 없는 optional로 둔 부분 스타일(스펙의 StyleSchema.partial()).
 *  zod 4에서 .partial()이 안쪽 .default()를 적용하지 않도록 필드를 직접 optional로 정의한다. 색 필드는 같은 isSafeCssColor 검증 */
export const StylePartialSchema: z.ZodType<Partial<Style>>;
export type StylePartial = Partial<Style>;
/** 뒤 레이어가 이긴다. undefined 레이어는 건너뛰고, 병합이 끝난 뒤 StyleSchema.parse로 기본값을 한 번만 채운다 */
export function resolveStyle(...layers: (StylePartial | undefined)[]): Style;
```
`Base.style`(고정 요소)은 1단계 그대로 `StyleSchema.prefault({})`다. 부분 스타일은 표의 `columns[].style`·`headerStyle`·셀 `style`·`borderStyle`에만 쓴다.

`src/schema/elements.ts`
```ts
export const TableCellSchema = z.object({
  value: z.string().default(""),
  span: z.union([z.number().int().positive(), z.literal("all")]).default(1),
  style: StylePartialSchema.optional(),           // 정렬은 style.align으로만. 셀·열에 align 필드는 없다
});
export type TableCell = z.infer<typeof TableCellSchema>;
// TableColumnSchema: { header: string default "", value: string default "", w: positive, style: StylePartialSchema.default({}) }
//   머리행은 columns[].header 문자열 한 줄뿐이다(다단 머리행은 11장 범위 밖). 1단계 columns[].style 값은 그대로 파싱된다
export const TableGroupSchema = z.object({
  by: z.string().min(1),                          // 표현식({{ }} 없이). 행 컨텍스트에서 평가
  header: z.array(TableCellSchema).default([]),   // 그룹 머리 한 행
  footer: z.array(TableCellSchema).default([]),   // 그룹 소계 한 행
  keepHeaderWithRows: z.boolean().default(true),
});
// TableElementSchema 추가·변경 필드 (기존 source·repeatHeader·overflow·keepTogether·rowHeight·headerHeight 유지):
//   border: z.enum(["all", "rows", "none"]).default("all")
//   borderStyle: StylePartialSchema.default({})   // stroke·strokeWidth를 읽는다. 기본값 < borderStyle
//   headerStyle: StylePartialSchema.default({})
//   groups: z.array(TableGroupSchema).default([])  // 앞 항목이 바깥 그룹
//   pageFooter: z.array(TableCellSchema).default([])
//   footer: z.array(TableCellSchema).default([])
//   keepTogether: "none"도 받아들이되 renderer는 "row"와 같게 처리한다
export const RepeaterBandSchema = z.object({ h: z.number().positive(), children: z.array(ElementSchema) });
export const RepeaterGroupSchema = z.object({ by: z.string().min(1), header: RepeaterBandSchema.optional(), footer: RepeaterBandSchema.optional() });
export const RepeaterElementSchema = Base.extend({
  type: z.literal("repeater"),
  source: z.string().min(1),
  layout: z.enum(["list", "grid"]).default("list"),
  gap: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).default([0, 0]),   // [가로, 세로] mm
  item: z.object({ w: z.number().positive(), h: z.number().positive(), children: z.array(ElementSchema) }),
  groups: z.array(RepeaterGroupSchema).default([]),
  overflow: z.enum(["continue", "clip"]).default("continue"),
});
export type TableElement = z.infer<typeof TableElementSchema>;
export type TableColumn = z.infer<typeof TableColumnSchema>;
export type TableGroup = z.infer<typeof TableGroupSchema>;
export type RepeaterBand = { h: number; children: Element[] };
export type RepeaterElement = z.infer<typeof Base> & { type: "repeater"; source: string; layout: "list" | "grid"; gap: [number, number];
  item: { w: number; h: number; children: Element[] }; groups: { by: string; header?: RepeaterBand; footer?: RepeaterBand }[];
  overflow: "continue" | "clip" };   // GroupElement처럼 재귀 타입을 손으로 적고, 스키마의 children은 z.lazy로 ElementSchema를 참조한다
// Element 유니언과 ElementSchema의 discriminatedUnion에 RepeaterElement 추가
```

`src/schema/tree.ts` (신규) — 요소 트리 순회의 단일 구현(4.4). 스키마 검증, renderer, studio 스토어가 모두 이것으로 내려간다.
```ts
/** group → [children], repeater → [item.children, ...groups마다 header?.children·footer?.children(있는 것만, 순서대로)], 그 밖 → [] */
export function childLists(el: Element): Element[][];
/** childLists로 깊이 우선·문서 순서 순회. fn이 true를 돌려주면 중단하고 true. parent는 el이 든 배열, ancestors는 바깥부터 */
export function walkElements(els: Element[], fn: (el: Element, parent: Element[], index: number, ancestors: Element[]) => boolean | void): boolean;
```

`src/schema/names.ts` (신규, 4.7.1)
```ts
export const IDENTIFIER_RE: RegExp;   // /^[A-Za-z_$][A-Za-z0-9_$]*$/
export const RESERVED_NAMES: readonly string[];
// params secrets record row item index group rows pageRows page total sheet sheets copy copies constructor prototype __proto__
export type NameProblem = "identifier" | "reserved" | "repeatAs";
/** 데이터셋 이름·요청 data 키 검사. repeatAs는 report.repeat?.as(없으면 undefined) */
export function checkDataName(name: string, repeatAs: string | undefined): NameProblem | null;
/** repeat.as 검사. 기본값 "record"는 예약어여도 허용 */
export function checkRepeatAs(as: string): NameProblem | null;
```

`src/schema/secrets.ts` (신규, 4.7·6.4)
```ts
export const SECRET_NAME_RE: RegExp;    // /^[A-Z0-9_]+$/
/** 원본 템플릿에서 단독 토큰 {{ secrets.NAME }}의 위치. g 플래그 정규식 \{\{\s*secrets\.([A-Z0-9_]+)\s*\}\} */
export function findSecretTokens(template: string): { name: string; start: number; end: number }[];
/** where가 "url"이면 secrets 참조가 있기만 해도, "header"·"body"면 단독 토큰이 아닌 {{ }} 식 안의 secrets 참조가 있으면 오류 문구 */
export function checkSecretRefs(template: string, where: "url" | "header" | "body"): string | null;
```

`src/schema/report.ts`
```ts
export const RepeatSchema = z.object({ source: z.string().min(1), as: z.string().default("record") });
export const SampleSchema = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  data: z.record(z.string(), z.unknown()).default({}),   // 비static 데이터셋만, 순수 JSON 값
  capturedAt: z.string(),
});
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
// DatasetSchema (discriminatedUnion "type"):
//   static: { name, type: "static", rows: record<string, unknown>[] }                      (1단계 그대로)
//   sql:    { name, type: "sql", connection: string, query: string }                        (1단계 그대로)
//   http:   { name, type: "http", method: "GET"|"POST" default "GET", url: string,
//             headers: record<string, string> default {}, body?: JsonValue, rowsPath?: string }
// ReportSchema 추가: repeat: RepeatSchema.optional(), sample: SampleSchema.optional()
// superRefine (모두 ctx.addIssue, path는 오류 위치):
//   - walkElements로 id 유일성(repeater 템플릿·그룹 머리·소계 자식 포함)
//   - repeater 템플릿 안의 repeater 금지, 템플릿 안 table은 overflow "clip"만
//   - 데이터셋 name: checkDataName(name, repeat?.as), repeat.as: checkRepeatAs
//   - http: checkSecretRefs(url, "url"), headers 값마다 "header", body의 문자열 잎마다 "body"
export type Repeat = z.infer<typeof RepeatSchema>;
export type Sample = z.infer<typeof SampleSchema>;
export type HttpDataset = Extract<Dataset, { type: "http" }>;
export type SqlDataset = Extract<Dataset, { type: "sql" }>;
export type StaticDataset = Extract<Dataset, { type: "static" }>;
```
`reportJsonSchema()`는 새 재귀 타입을 포함해 계속 동작해야 한다(`/api/schema`).

`src/expression/engine.ts`
- 등록 함수 `avg(rows, field)`·`min(rows, field)`·`max(rows, field)` 추가. `sum`과 같은 키 검사, 숫자로 바꿀 수 없는 값은 건너뛰고, 남은 값이 없으면 `null`.
- `evaluate(expression, context)` 시그니처 유지. 내부에서 `engine.compile` 결과와 `guardAst`를 거친 AST를 표현식 문자열 키의 모듈 캐시(`Map`)에 둔다. `FORBIDDEN_KEY_RE`·`FORBIDDEN_ROOT_RE` 검사는 매 호출 수행한다(5.5).

`src/expression/source.ts` (신규, 4.2)
```ts
/** 소스 표현식({{ }} 없음)을 평가해 배열로. null·undefined → []. 배열이 아니면 ExpressionError(expr, "source is not an array") */
export function evaluateSource(expr: string, ctx: DataContext): unknown[];
```

`src/data/rows.ts` (신규, 6.1)
```ts
/** 배열 → 그대로, 일반 객체 → [객체], null·undefined → [], 그 밖(문자열·숫자·불리언) → null(호출자가 BAD_DATA 또는 []로 처리) */
export function normalizeRows(value: unknown): Record<string, unknown>[] | null;
```

`src/data/context.ts` (신규, 6.1·7.4) — 캔버스와 datasource가 같은 병합을 쓴다.
```ts
/** params는 이미 resolveParams를 거친 값. Object.create(null) 객체에 데이터셋마다
 *  Object.hasOwn(data, name) ? normalizeRows(data[name]) ?? [] : (static ? rows : []) 를 rowsProxy로 넣고,
 *  data에만 있는 이름도 같은 규칙으로 넣은 뒤 params를 마지막에 쓴다 */
export function buildContext(report: Report, input: { params: Record<string, unknown>; data?: Record<string, unknown> }): DataContext;
```
`src/data/resolve.ts`의 `rowsProxy`·`resolveParams`는 그대로 둔다. `resolveData`는 기존 테스트(golden·pdf) 호환용으로 남기고 새 코드는 쓰지 않는다.

`src/data/infer.ts` (신규, 4.8)
```ts
export type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
export type FieldNode = { name: string; path: string[]; type: FieldType; children?: FieldNode[] };   // 배열 원소는 세그먼트를 만들지 않는다
export const DATE_RE: RegExp;   // ^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$ + 실제 달력 날짜 확인
export function inferFields(rows: unknown, opts?: { sampleSize?: number; maxDepth?: number }): FieldNode[];   // 기본 200, 5
```

`src/index.ts`는 위 신규 모듈(`schema/tree`, `schema/names`, `schema/secrets`, `expression/source`, `data/rows`, `data/context`, `data/infer`)을 모두 재export 한다.

### renderer (`packages/renderer`)

`src/layout/types.ts` 변경 (5.4)
```ts
export type Rect = { x: number; y: number; w: number; h: number };
type PlacedBase = { elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string;
  instance?: string;                        // 표·반복 영역(continue·clip 모두)에서 나온 모든 항목. 형식은 src/layout/instance.ts
  role?: "flowBox" | "cell" | "border";
  clip?: Rect;                              // 잘림 경계에 걸친 항목. 페이지 mm 좌표, 경계 안 사각형
  blockOverflow?: boolean;                  // flowBox에만: 5.2 규칙 5로 빈 페이지보다 큰 조각을 잘라 둠
  clipped?: boolean };                      // flowBox에만: overflow "clip"에서 버린 조각이 있음
// PlacedText.overflow는 1단계 뜻(텍스트가 상자를 넘침) 그대로. PlacedPlaceholder는 barcode·ref만 남는다(표는 실제 출력)
export type Page = { index: number;        // 문서 전체 0부터(= sheet − 1)
  width: number; height: number; items: PlacedItem[];
  copy: number; copies: number;             // 1부터. repeat가 없으면 1, 1
  pageInCopy: number; pagesInCopy: number };// 1부터. 부 안의 페이지 번호·페이지 수(= page·total)
```

`src/layout/instance.ts` (신규, 5.4 instance 형식의 단일 구현)
```ts
export type InstancePart =
  | { kind: "row"; index: number }                          // r<index> (grid 항목 포함)
  | { kind: "header" }                                      // h
  | { kind: "groupHeader"; level: number; index: number }   // gh<level>.<group.index>
  | { kind: "groupFooter"; level: number; index: number }   // gf<level>.<group.index>
  | { kind: "pageFooter" } | { kind: "footer" } | { kind: "box" };   // pf, f, box
/** `${prefix ? prefix + "/" : ""}${elementId}#${part}` */
export function instanceSegment(prefix: string | undefined, elementId: string, part: InstancePart): string;
export const cellSuffix: (col: number) => string;     // "/c<열순번>"
export const borderSuffix: (n: number) => string;     // "/b<순번>". 행에 속하지 않는 선은 `${elementId}#b<순번>`
```

`src/layout/errors.ts` (신규): `export const MAX_PAGES = 2000`, `export class LayoutLimitError extends Error { readonly code = "LAYOUT_LIMIT"; constructor(readonly pages: number) }`.

`src/layout/flatten.ts` 변경: `FlatElement`에 `ancestorsFlow: ("once" | "every" | "last")[]`(바깥 그룹부터)를 더한다. group만 내려가고 repeater에서 멈춘다(템플릿 자식은 flatten 결과에 없다).

`src/text/cache.ts` (신규)
```ts
export type MeasureCache = { wrap(text: string, fontSize: number, bold: boolean, width: number): string[] };
export function createMeasureCache(): MeasureCache;   // 키 `${fontSize}|${bold}|${width}|${text}`, layout() 호출마다 새로 만든다
```

`src/flow/types.ts` (신규, 5.1·5.2)
```ts
export type Region = Rect;
export type BlockKind = "header" | "row" | "groupHeader" | "groupFooter" | "pageFooter" | "footer";
export type PageFlowContext = { page: number; total: number; sheet: number; sheets: number; copy: number; copies: number; pageRows: unknown[] };
export type Block = { kind: BlockKind; height: number; keepWithNext: boolean; rows: unknown[];
  paint(origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[] };
export type FlowInput = { header?: Block; pageFooter?: Block; body: Block[]; footer?: Block;
  gap: number };                            // 반복 영역 gap[1], 표는 0
export type FlowPlacement = { block: Block; y: number };   // pageFooter도 영역 하단 고정 y로 들어간다
export type FlowPage = { region: Region; placements: FlowPlacement[]; pageRows: unknown[];
  cutY: number;                             // 잘림 경계 = region.y + region.h − pageFooter 높이
  blockOverflow: boolean };
export type PaginateResult =
  | { ok: true; pages: FlowPage[]; clipped: boolean }
  | { ok: false; reason: "region too small for header/pageFooter" };   // 규칙 8
```

`src/flow/paginate.ts` (신규)
```ts
/** 5.2 규칙 1~10. 순수 함수. clip이면 first 한 페이지만 */
export function paginate(input: FlowInput, opts: { first: Region; next: Region; repeatHeader: boolean; clip: boolean }): PaginateResult;
```

`src/flow/region.ts` (신규, 5.2 이어지는 영역)
```ts
/** x·y·w 유지, h = max(0, B − y). B = min(page.height − margin.bottom, 템플릿 하단 이상에 y가 있고 가로로 겹치는 flow every·last 고정 요소의 y) */
export function continuationRegion(el: FlatElement, fixed: FlatElement[], page: Report["page"]): Region;
```

`src/flow/cut.ts` (신규, 5.2 규칙 5)
```ts
/** cutY 아래에서 시작하는 항목은 버리고, 걸친 항목에 clip(경계 안 사각형)을 준다 */
export function applyCut(items: PlacedItem[], cutY: number): PlacedItem[];
```

`src/flow/context.ts` (신규, 4.5 변수·5.1 측정 컨텍스트)
```ts
export type GroupVars = { key: unknown; rows: unknown[]; index: number; level: number; rowIndex?: number };
export type GroupRun = { level: number; key: unknown; index: number; rows: unknown[]; start: number; end: number; children: GroupRun[] };
/** 연속된 같은 key로 나눈다(정렬 없음). index는 같은 바깥 그룹 안에서 0부터, 최상위는 소스 전체 기준. by 평가 오류는 ExpressionError로 던진다 */
export function groupRuns(rows: unknown[], bys: string[], keyContext: (row: unknown, index: number) => DataContext): GroupRun[];
/** 조각 높이 측정용: page=1, total=1, sheet=1, sheets=1, copy, copies, pageRows=rows */
export function measureContext(base: DataContext, copy: number, copies: number, rows: unknown[]): DataContext;
/** 행·항목 컨텍스트. varName은 "row"(표) 또는 "item"(반복 영역) */
export function rowContext(base: DataContext, v: { varName: "row" | "item"; value: unknown; index: number; rows: unknown[]; group?: GroupVars }): DataContext;
```

`src/flow/table.ts`·`src/flow/repeater.ts` (신규, 5.1)
```ts
export type FlowOptions = { measure: MeasureCache; onExpressionError: "blank" | "fail"; copy: number; copies: number; instancePrefix?: string };
/** el은 flatten 후 페이지 절대좌표. 소스 오류·배열 아님은 ExpressionError로 던진다(호출자가 #ERR 한 칸으로 바꿈). 셀 식 오류는 그 셀만 #ERR */
export function tableFlow(el: TableElement & { x: number; y: number }, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] };
/** 항목·그룹 밴드 자식은 항목 원점 기준 상대좌표. 항목 자식 식 오류는 그 자식만 #ERR */
export function repeaterFlow(el: RepeaterElement & { x: number; y: number }, ctx: DataContext, opts: FlowOptions): FlowInput & { rows: unknown[] };
```
표 셀 스타일은 core `resolveStyle`로 4.3 병합 순서를 따른다. 셀·테두리는 `text`·`line`·`rect` kind와 `role: "cell" | "border"`로 낸다.

`src/layout/place.ts` (신규, 기존 layout.ts의 place·textItem·isVisible를 옮김)
```ts
/** 고정 요소 하나. clip 표·반복 영역도 여기서 tableFlow/repeaterFlow + paginate(clip)으로 그린다. 표현식 오류 격리는 1단계 규칙 */
export function placeStatic(el: FlatElement, ctx: DataContext, opts: FlowOptions & { instance?: string }): PlacedItem[];
export function isVisible(visible: string | undefined, ctx: DataContext): boolean;
```

`src/layout/layout.ts`
```ts
export function layout(report: Report, data: DataContext, opts?: { maxPages?: number; templateSlot?: boolean }): Page[];
```
- 시그니처는 1단계와 호환(세 번째 인자 선택). `maxPages` 기본 `MAX_PAGES`, 초과 시 `LayoutLimitError`. `templateSlot`은 캔버스 전용으로, 항목 0건 반복 영역의 첫 항목 자리에 데이터 없는 템플릿 슬롯(`#r0`)을 그린다(7.4). 미리보기·PDF는 넘기지 않는다.
- 내부는 5.3 조립 순서(흐름 요소별 paginate → 부별 배치 확정·누적 페이지 수 검사 → 전체 `sheets` 확정 뒤 고정 요소 칠하기와 `paint`). 0건 repeat의 `#NODATA` 항목은 elementId `__nodata`.
- 흐름 요소가 없고 repeat도 없는 레포트는 1단계와 같은 항목 배열에 Page 필드 넷(`copy`·`copies`·`pageInCopy`·`pagesInCopy`)만 더해진다. 표는 placeholder가 아니라 실제 출력이므로 골든 스냅샷을 갱신한다.

`src/paint/Paint.tsx`: React key `` `${elementId}|${instance ?? ""}` ``, DOM에 `data-element-id`(기존)·`data-instance`·`data-role` 속성. `clip`이 있는 항목은 clip 위치의 `position:absolute; overflow:hidden` 래퍼(`className="dp-clip"`)로 감싸고 안쪽 좌표를 래퍼 기준으로 옮긴다.

`src/index.ts`: `layout/instance`, `layout/errors`, `flow/types`, `flow/paginate`를 재export 한다(`paginate`는 불변식 테스트와 studio 문제 목록이 쓴다).

### pdf (`packages/pdf`)

`src/index.ts`에 추가: `export async function renderHtmlScreenshots(report: Report, data: DataContext): Promise<Buffer[]>` — `.dp-page`마다 96dpi PNG 1장. 기존 `renderHtmlScreenshot`은 이 결과의 `[0]`과 같다. 렌더 경로(`renderPdf`)는 바꾸지 않는다.

### datasource (`packages/datasource`, 신규 패키지 `@daport/datasource`)

의존: `@daport/core`만. renderer·pdf는 이 패키지를 모른다.

`src/types.ts`
```ts
export type DatasetErrorCode =
  | "TIMEOUT" | "HOST_NOT_ALLOWED" | "HTTP_STATUS" | "BAD_JSON" | "ROWS_PATH" | "TOO_LARGE" | "TOO_MANY_ROWS"
  | "BAD_PARAM" | "BAD_DATA" | "BIND_MISSING" | "SQL_NOT_CONFIGURED" | "SQL_ERROR";
export type DatasetError = { dataset: string; code: DatasetErrorCode; message: string };
/** 커넥터·요청 조립이 던지는 실패. status는 HTTP_STATUS일 때만 */
export class DatasetFailure extends Error { constructor(readonly code: DatasetErrorCode, readonly status?: number) }
/** 코드별 고정 문구에 데이터셋 이름과 HTTP 상태 번호만 넣는다. URL·헤더·응답 본문은 넣지 않는다 */
export function datasetMessage(dataset: string, code: DatasetErrorCode, status?: number): string;
export type Limits = { timeoutMs: number; totalTimeoutMs: number; maxBytes: number; maxRows: number };
export const DEFAULT_LIMITS: Limits;   // { timeoutMs: 30_000, totalTimeoutMs: 25_000, maxBytes: 20 * 1024 * 1024, maxRows: 10_000 }
export type HttpRequest = { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string };
export interface HttpConnector { readonly allow: AllowEntry[]; request(req: HttpRequest, opts: { maxBytes: number; signal: AbortSignal }): Promise<unknown> }   // 파싱된 JSON. 실패는 DatasetFailure
export interface SqlConnector {
  query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal })
    : Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }>;   // 순수 JSON
}
export type Connectors = { http?: HttpConnector; sql?: Record<string, SqlConnector> };   // sql은 connection 이름별
export type SecretResolver = (name: string) => string | undefined;
export type ExecuteOptions = { params: Record<string, unknown>; data?: Record<string, unknown>;
  connectors: Connectors; secrets: SecretResolver; limits?: Partial<Limits> };   // 스펙 6.1 그대로. 허용 목록은 http 커넥터가 가진다
```

`src/execute.ts` (6.1)
```ts
/** params는 core resolveParams로 정규화. data의 키는 호출 전에 라우트가 checkDataName으로 검사한다.
 *  Object.hasOwn(data, name)이면 normalizeRows(null이면 BAD_DATA + []), 아니면 type별 실행을 Promise.all로 병렬 실행.
 *  데이터셋 신호 = AbortSignal.any([AbortSignal.timeout(timeoutMs), 전체 마감 신호]), 어느 쪽이든 TIMEOUT.
 *  컨텍스트는 core buildContext(report, { params, data: { ...실행 결과, ...요청 data } }) */
export function executeDatasets(report: Report, opts: ExecuteOptions): Promise<{ context: DataContext; errors: DatasetError[]; rows: Record<string, unknown[]> }>;
```
`rows`는 정규화된 데이터셋별 전체 행이다(sample 라우트가 앞 200행 자르기·`truncated` 계산에 쓴다). 오류 메시지에 비밀값 문자열이 섞이면 `maskSecrets`로 `***` 치환한다.

`src/allow.ts` (6.2)
```ts
export type AllowEntry = { host: string; port?: number; secrets: string[] };   // host는 소문자·끝 점 제거·IPv6 대괄호 정규화
/** 쉼표 구분. 항목은 host[:port] 또는 host[:port]=NAME1|NAME2. IPv6는 [addr]:port. 빈 값·undefined → [] */
export function parseAllowList(value: string | undefined): AllowEntry[];
/** new URL 파싱 실패·scheme이 http:/https:가 아님·userinfo 있음·호스트 불일치 → null. URL에 포트가 없으면 80/443을 채워 비교 */
export function matchAllow(url: string, allow: AllowEntry[]): AllowEntry | null;
```

`src/http.ts` (4.7·6.2·6.4)
```ts
/** url 경로·쿼리 템플릿 값은 encodeURIComponent, 경로 값 "."·".." → BAD_PARAM. 헤더 평가 값에 CR·LF → BAD_PARAM.
 *  body는 문자열 잎마다 evaluateTemplateValue 후 JSON.stringify, content-type: application/json 기본.
 *  비밀값 토큰(core findSecretTokens)은 원본 템플릿에서 위치를 표시해 평가에서 빼고 평가 뒤 그 자리에 넣는다.
 *  allow 검사는 비밀값을 넣기 전 URL로. 토큰이 있는데 매칭된 항목의 secrets에 그 이름이 없으면 HOST_NOT_ALLOWED */
export function buildHttpRequest(ds: HttpDataset, params: Record<string, unknown>, secrets: SecretResolver, allow: AllowEntry[]): { request: HttpRequest; usedSecrets: string[] };
/** allow를 그대로 노출한다(connectors.http가 없으면 모든 http 데이터셋이 HOST_NOT_ALLOWED). 전역 fetch 기본. redirect: "manual"(3xx는 HTTP_STATUS), 응답 스트림 누적 바이트 초과 시 중단 TOO_LARGE, JSON 파싱 실패 BAD_JSON */
export function createFetchHttpConnector(opts: { allow: AllowEntry[]; fetch?: typeof fetch }): HttpConnector;
/** 점 경로. 세그먼트마다 Object.hasOwn, 숫자 세그먼트는 배열 인덱스, 없는 세그먼트·constructor·prototype·__proto__ → ROWS_PATH.
 *  결과가 배열이 아니면 객체는 [객체], 그 밖은 ROWS_PATH */
export function pickRows(json: unknown, rowsPath: string | undefined): Record<string, unknown>[];
export function maskSecrets(message: string, values: string[]): string;
```
행 수가 `maxRows`를 넘으면 `TOO_MANY_ROWS`(http·sql 공통, execute에서 검사).

`src/sql.ts` (6.3)
```ts
/** 작은따옴표 문자열('' 포함)·q'[..]' 류·큰따옴표 식별자·-- 주석·/* *\/ 주석 안은 건너뛰고 ::는 바인드 아님.
 *  이름 :[A-Za-z][A-Za-z0-9_$#]*, 대소문자 구분 없이 처음 나온 순서로 중복 제거, 처음 표기를 돌려준다 */
export function extractBinds(sql: string): string[];
/** 이름마다 report.params를 대소문자 구분 없이 찾는다. 없거나 둘 이상 맞으면 DatasetFailure("BIND_MISSING"). undefined 값 → null */
export function resolveBinds(names: string[], report: Report, params: Record<string, unknown>): Record<string, unknown>;
```
`connectors.sql[ds.connection]`이 없으면 `SQL_NOT_CONFIGURED`, 커넥터 예외는 `SQL_ERROR`, `BIND_MISSING`이면 커넥터를 부르지 않는다.

`src/secrets.ts` (6.4)
```ts
/** DAPORT_SECRET_<NAME>만 읽는다. NAME이 SECRET_NAME_RE에 안 맞으면 undefined */
export function envSecrets(env?: Record<string, string | undefined>): SecretResolver;
```

`src/index.ts`는 위 모듈을 모두 export 한다.

### studio (`apps/studio`)

서버 라이브러리와 라우트
- `src/lib/data.ts`: `sampleParams(report)`는 그대로 둔다. `resolveDataSync`는 삭제하고 호출처(Canvas)를 교체한다. 추가(7.4·7.5):
  ```ts
  /** resolveParams(report, { ...sampleParams(report), ...report.sample?.params }, { checkRequired: false }) */
  export function editParams(report: Report): Record<string, unknown>;
  /** report.sample?.data에서 static 데이터셋 이름을 뺀 값 */
  export function nonStaticSampleData(report: Report): Record<string, unknown>;
  /** core buildContext(report, { params: editParams(report), data: nonStaticSampleData(report) }) */
  export function canvasContext(report: Report): DataContext;
  /** 편집 중 미리보기·PDF 요청 본문. report는 sample을 뺀 값, liveData면 data를 넣지 않는다 */
  export function editRenderBody(report: Report, liveData: boolean): { report: Omit<Report, "sample">; params: Record<string, unknown>; data?: Record<string, unknown> };
  ```
- `src/lib/body.ts` (신규, 6.5·6.1)
  ```ts
  /** DAPORT_MAX_BODY_BYTES, 기본 4 * 1024 * 1024 */
  export function maxBodyBytes(env?: Record<string, string | undefined>): number;
  /** content-length 초과는 읽기 전 413, 그 밖에는 req.body 스트림을 누적 바이트로 세다가 초과 즉시 중단하고 413 { error, code: "TOO_LARGE" }.
   *  빈 본문·JSON null → {}. 파싱 실패·객체 아님 → 400 { error } */
  export function readJsonBody(req: Request, maxBytes?: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }>;
  /** body.data 검사: 없으면 undefined, 일반 객체가 아니면 400 { error }, 키가 core checkDataName(key, report.repeat?.as)을 어기면 400 { error, code: "BAD_DATA_KEY", key } */
  export function readRequestData(body: Record<string, unknown>, report: Report): { ok: true; data?: Record<string, unknown> } | { ok: false; response: Response };
  ```
- `src/lib/datasets.ts` (신규, 서버 전용)
  ```ts
  /** createFetchHttpConnector({ allow: parseAllowList(env.DAPORT_HTTP_ALLOW) })·envSecrets()·sql 커넥터 없음({})으로 executeDatasets 호출 */
  export function runDatasets(report: Report, input: { params?: Record<string, unknown>; data?: Record<string, unknown> }): Promise<{ context: DataContext; errors: DatasetError[]; rows: Record<string, unknown[]> }>;
  /** 모든 오류가 TIMEOUT이면 504, 아니면 400. 본문 { error, datasetErrors } */
  export function datasetErrorResponse(errors: DatasetError[]): Response;
  /** LayoutLimitError → 400 { error, code: "LAYOUT_LIMIT" } */
  export function layoutLimitResponse(e: LayoutLimitError): Response;
  ```
- `src/lib/sample-types.ts` (신규, 7.5 응답 타입. 라우트와 데이터 패널이 함께 쓴다)
  ```ts
  export const SAMPLE_ROWS = 200;
  export type SampleResponse = { data: Record<string, unknown[]>; fields: Record<string, FieldNode[]>; errors: DatasetError[];
    capturedAt: string; truncated: Record<string, number> };   // truncated: 잘린 데이터셋만 { 이름: 원래 행 수 }
  ```
- 라우트: `src/app/api/reports/[id]/preview/route.ts`·`pdf/route.ts`는 `readJsonBody` → `readRequestData` → `runDatasets` → 오류면 `datasetErrorResponse` → 렌더(`LayoutLimitError`는 `layoutLimitResponse`). `src/app/api/reports/[id]/sample/route.ts`(신규)는 본문 `{ report?, params }`로 `SampleResponse`를 돌려준다(static 제외, 부분 실패 허용). 세 라우트 모두 `export const maxDuration = 60`(`totalTimeoutMs` 25000보다 크게).

에디터 스토어 `src/editor/store.ts`
- 내부 `walk`를 core `walkElements`로 교체한다. find·update·move·resize·delete(prune)·newId·선 w/h 정규화가 repeater 템플릿·그룹 머리·소계 자식까지 내려간다. `duplicateSelected`는 복제한 group·repeater의 모든 자손(`childLists`로 내려감)에 새 id를 준다.
- 추가 상태·액션:
  ```ts
  export type TemplateTarget = { repeaterId: string; band: "item" | "groupHeader" | "groupFooter"; groupIndex?: number };
  view: { copy: number; pageInCopy: number };            // 1부터. Page.copy·pageInCopy와 같은 번호
  setView(v: Partial<{ copy: number; pageInCopy: number }>): void;   // 범위 밖이면 마지막으로 조정은 캔버스가 한다
  liveData: boolean; setLiveData(v: boolean): void;      // 편집 이력에 넣지 않는다
  setSample(sample: Report["sample"]): void;             // 이하 넷은 되돌리기 가능한 편집 1건
  setDatasets(datasets: Report["datasets"]): void;
  setParams(params: Report["params"]): void;
  setRepeat(repeat: Report["repeat"] | undefined): void;
  addElement(el: Element, opts?: { into?: TemplateTarget }): void;
  ```

캔버스 `src/editor/canvas/`
- `hit.ts` (신규, 7.4)
  ```ts
  /** 같은 페이지에서 (elementId, instance)로 항목을 찾는다 */
  export function findItem(page: Page, elementId: string, instance: string | undefined): PlacedItem | undefined;
  /** instance 첫 세그먼트의 요소 id(표·반복 영역). instance가 없으면 undefined */
  export function ownerFlowId(instance: string | undefined): string | undefined;
  /** 클릭한 항목이 고를 요소 id. 표 셀·테두리·flowBox → 그 표·반복 영역, 반복 영역 항목 자식 → 같은 elementId의 템플릿 요소, 고정 요소 → 자기 */
  export function selectTarget(item: PlacedItem, report: Report): string;
  /** 선택 상자: 표·반복 영역은 현재 페이지 flowBox(`<id>#box`), 템플릿 자식은 `<repeater>#r0` 세그먼트의 항목, 없으면 페이지에서 가장 앞 인스턴스, 고정 요소는 자기 항목 */
  export function selectionItem(page: Page, elementId: string, report: Report): PlacedItem | undefined;
  /** 채움 없는 rect 히트 제외 규칙의 예외: role "flowBox"면 true */
  export function alwaysHittable(item: PlacedItem): boolean;
  ```
  DOM에서는 `data-element-id`·`data-instance`로 항목을 되찾는다. 리사이즈·이동은 첫 페이지 flowBox 좌표(= 템플릿 x·y·w·h)만 템플릿에 쓰고, 템플릿 자식은 항목 기준 상대좌표로 쓴다.
- `problems.ts` (신규): `export function layoutProblems(pages: Page[]): Problem[]` — flowBox의 `blockOverflow`·`clipped`, 항목 `error`를 문제 목록 항목으로.
- `Canvas.tsx`: `canvasContext` + `layout(report(onExpressionError "blank"), ctx, { templateSlot: true })`에서 `view`로 고른 페이지 하나를 그린다. 반복 영역 첫 항목 자리에 템플릿 편집 영역(파란 점선), 나머지 항목은 opacity 0.5.

데이터 패널 `src/editor/data/` (신규)
- `DataPanel.tsx`(파라미터·데이터셋 목록·샘플 가져오기·필드 트리 탭), `DatasetEditor.tsx`(static JSON 붙여넣기, http 폼, 이름 변경 시 core `checkDataName`), `FieldTree.tsx`(static은 `inferFields(rows)`, 비static은 `inferFields(sample.data[이름])`), `sample.ts`(`fetchSample(reportId: string, report: Report, params: Record<string, unknown>): Promise<SampleResponse>`).
- `bindings.ts` (순수 함수, 7.2)
  ```ts
  export const DRAG_MIME = "application/x-daport-field";
  export type DragField = { dataset: string; path: string[]; type: FieldType; isArray: boolean };
  /** 식별자 세그먼트는 .이름, 아니면 ["이름"](JSON 문자열 이스케이프) */
  export function exprPath(root: string, path: string[]): string;
  /** 끝의 필터 [...]를 벗기고 식별자 체인을 (데이터셋, 접두 경로)로. 첫 이름이 repeat.as면 repeat 소스 해석 뒤에 잇는다. 해석 불가 → null */
  export function resolveSource(source: string, report: Report): { dataset: string; prefix: string[] } | null;
  export type DropTarget = { kind: "canvas"; x: number; y: number } | { kind: "table"; tableId: string } | { kind: "repeaterItem"; repeaterId: string; x: number; y: number };
  export type DropResult =
    | { action: "addElement"; element: Element; into?: TemplateTarget; warning?: string }
    | { action: "addColumn"; tableId: string; column: TableColumn; warning?: string }   // warning: "표 소스와 다른 데이터셋"
    | { action: "none"; warning?: string };
  export function resolveDrop(field: DragField, target: DropTarget, report: Report, allocateId: (base: string) => string): DropResult;
  ```

패널·툴바
- `src/editor/panels/TablePanel.tsx`, `src/editor/panels/RepeaterPanel.tsx` (신규). `PropertyPanel.tsx`는 선택 요소가 table·repeater면 이 패널을 렌더한다. `ElementPalette.tsx`에 반복 영역 추가. `PagePanel.tsx`에 "레코드마다 한 부씩" 스위치와 소스 입력(`setRepeat`).
- `src/editor/PageSelector.tsx` (신규): 페이지 ◀ n / N ▶, `repeat`가 있으면 부 ◀ c / C ▶. `Page.copy`·`copies`·`pageInCopy`·`pagesInCopy`로 찾고 `setView`를 쓴다. 툴바에 배치.
- `Toolbar.tsx`·`Preview.tsx`: 요청 본문은 `editRenderBody(report, liveData)`. 툴바에 "실데이터로" 토글.
- `Editor.tsx`: 왼쪽 패널을 요소 팔레트 / 데이터 패널 탭으로.
- E2E: `e2e/phase2.spec.ts` (신규).

### 파일 소유와 병합

- core `src/index.ts`, renderer `src/index.ts`, datasource `src/index.ts`는 여러 레인이 export 줄만 덧붙인다. 병합 충돌은 양쪽 줄을 모두 남겨 푼다.
- 1단계 골든 스냅샷(`packages/renderer/src/__tests__/__snapshots__/golden.test.ts.snap`)과 layout 테스트의 table placeholder 기대는 T14가 갱신한다.

---

## 태스크 목록과 실행 웨이브

각 웨이브 안의 레인은 서로 다른 파일만 건드려 병렬로 실행할 수 있다(예외: 위 "파일 소유와 병합"의 index.ts export 줄). 레인 안의 태스크는 순서대로 실행한다. 웨이브가 끝나면 레인을 통합 브랜치에 병합하고 전체 테스트를 돌린다.

| 웨이브 | 레인 | 태스크 | 의존 |
|---|---|---|---|
| 1 | core-schema | T1 표 스키마 확장(부분 스타일·resolveStyle) · T2 반복 영역 스키마와 요소 트리 탐색(childLists) · T3 레포트 repeat·sample·데이터셋 스키마(이름 규칙·비밀값 참조 검사) | - |
| 1 | core-expr | T4 avg/min/max, evaluate 컴파일 캐시, 소스 표현식 · T5 필드 추론 | - |
| 1 | flow-core | T6 흐름 타입·instance 형식·측정 캐시·한도 오류·Page 필드 · T7 paginate와 불변식 테스트 | - |
| 1 | datasource | T8 datasource 패키지, core normalizeRows·buildContext, executeDatasets(static·요청 data·병렬·전체 마감) · T9 SQL 커넥터 경계(extractBinds·BIND_MISSING) | - |
| 2 | table | T10 표 흐름 조각(스타일 병합·그룹 변수) | T1 T4 T6 T7 |
| 2 | repeater | T11 반복 영역 흐름 조각(grid·gap·그룹) | T2 T4 T6 T7 |
| 2 | http | T12 http 커넥터·허용 목록·호스트에 묶인 비밀값·BAD_PARAM | T3 T8 |
| 2 | studio-store | T13 스토어 트리 탐색 교체와 데이터·반복·보기 상태 액션, canvasContext·editRenderBody, sample-types | T2 T3 T8 |
| 3 | assemble | T14 페이지 조립(흐름·clip·잘림·repeat·번호·상한·instance·templateSlot·Paint 래퍼), 1단계 골든 갱신 | T10 T11 |
| 3 | api | T15 요청 본문 한도·BAD_DATA_KEY·runDatasets·504/400·preview/pdf data·sample 라우트 | T8 T12 T6 T13 |
| 3 | data-panel | T16 데이터 패널·데이터셋 편집기·필드 트리·샘플 가져오기(잘림 표시) | T5 T13 |
| 4 | fixtures | T17 예제 4종 골든·성능 테스트 · T18 renderHtmlScreenshots와 여러 페이지 PDF 테스트 | T14 |
| 4 | canvas | T19 캔버스 페이지·부 선택, (elementId, instance) 히트·선택 상자, 반복 영역 템플릿 편집, 문제 목록 | T13 T14 |
| 4 | binding | T20 드롭 바인딩 규칙(순수 함수) | T13 T5 |
| 4 | panels | T21 표 속성 패널 · T22 반복 영역 패널·팔레트·레포트 반복 스위치 | T13 |
| 5 | integration | T23 필드 드래그 연결·툴바 페이지 선택기·실데이터 토글·미리보기 data 전송 · T24 2단계 E2E | T15 T16 T19 T20 T21 T22 |
