# daport 3b단계 구현 플랜: 컴포넌트 라이브러리·그룹화

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 레포트가 함께 쓰는 부분을 버전이 있는 컴포넌트로 라이브러리에 등록하고, 레포트가 쓰는 버전 내용을 품어 고정 버전으로 출력하며, 선택 영역 → 컴포넌트, 전용 편집 화면, 그룹화·해제를 제공한다.

**Architecture:** core에 컴포넌트 스키마·내용 해시·순수 변환 함수(업그레이드·정리·추출·그룹화)를 둔다. renderer의 `flatten`이 `report.components`에서 `ref`를 펼치고 인스턴스별 `props` 컨텍스트와 `elementId`=인스턴스 id 규칙을 적용한다(순수 함수 유지). studio는 프리셋과 같은 패턴의 메모리·DB 컴포넌트 저장소와 API, 레포트 저장 해시 검사, 라이브러리 패널·RefPanel·컴포넌트 만들기 대화상자·전용 편집 화면을 둔다.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, zod 4, React 19, Next.js 16 App Router, zustand 5, drizzle-orm, Playwright.

스펙: `docs/superpowers/specs/2026-09-17-daport-phase3b-components-design.md`
브랜치: `feature/phase3b-components`

---

## 테스트·명령 규약

- 패키지 테스트: `pnpm --filter @daport/core test`, `pnpm --filter @daport/renderer test`, `pnpm --filter @daport/pdf test`, `pnpm --filter studio test`. 파일 하나만: 패키지 디렉터리에서 `pnpm exec vitest run <경로>`.
- 타입 검사: 루트에서 `pnpm typecheck`.
- E2E: `pnpm --filter studio e2e` (포트 3000을 먼저 비운다: `lsof -ti :3000 | xargs kill`).
- 테스트 파일은 각 패키지 `src/__tests__/*.test.ts(x)`, studio 라우트 테스트는 `src/app/api/**/__tests__/`.
- 커밋 메시지: `type(scope): 한국어 설명`, 본문 끝에 빈 줄과 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- 모든 태스크는 실패 테스트 작성 → 실패 확인 → 구현 → 통과 확인 → 커밋 순서를 지킨다.

## 파일 구조

```
packages/core/src/
  schema/ids.ts                COMPONENT_ID_RE, COMPONENT_KEY_RE (순환 import 방지용 상수)
  schema/component.ts          ComponentPropSchema, ComponentBodySchema, COMPONENT_KEY_RE, componentKey()
  schema/elements.ts           (수정) RefElementSchema에 version, props 값 타입
  schema/report.ts             (수정) components 필드, ref 참조·크기·중첩 검증, RESERVED_CONTEXT_NAMES에 props
  schema/hash.ts               canonicalJson(), sha256Hex(), componentHash()
  ops/geometry.ts              elementBox(), unionBox(), translateElement()
  ops/components.ts            upgradeRefs(), pruneComponents(), extractComponent(), refsTo()
  ops/group.ts                 sameParent(), groupElements(), ungroupElement()
  index.ts                     (수정) 재export
packages/renderer/src/
  layout/flatten.ts            (수정) components 인자, ref 펼치기, RefOwner
  layout/props.ts              resolveRefProps(), withProps()
  layout/place.ts              (수정) ref 케이스는 내용을 못 찾은 경우의 #ERR로 바꿈, refBoxItem·ownedInstance·refErrorItem·ownItems
  layout/layout.ts             (수정) components 전달, owner 컨텍스트, elementId·instance 규칙
  layout/types.ts              (수정) role에 "refBox"
  flow/types.ts                (수정) FlowOptions.components
  flow/children.ts             (수정) flatten에 components 전달, owner 컨텍스트
  __tests__/fixtures/component-demo.report.json   컴포넌트 예제(헤더 2회 + 넘기는 표 컴포넌트)
apps/studio/src/
  db/schema.ts                 (수정) components, componentVersions 테이블
  lib/component-store.ts       ComponentStore, MemoryComponentStore, DbComponentStore, getComponentStore()
  lib/component-usage.ts       findUsage(), applyLatestToReports()
  lib/report-guard.ts          checkReportComponents()
  lib/component-edit.ts        componentToEditReport(), editReportToComponent()
  app/api/components/route.ts                          GET, POST
  app/api/components/[id]/route.ts                     GET, PUT, DELETE
  app/api/components/[id]/versions/[v]/route.ts        GET
  app/api/components/[id]/usage/route.ts               GET
  app/api/components/[id]/apply-latest/route.ts        POST
  app/api/reports/route.ts, [id]/route.ts              (수정) 저장 전 검사·정리·경고 헤더
  app/api/reports/[id]/preview|pdf|label/route.ts      (수정) 본문 props 필드
  lib/body.ts                  (수정) propsField()
  editor/store.ts              (수정) insertComponent, updateInstances, replaceWithComponent, groupSelected, ungroupSelected, componentMode 상태
  editor/useKeyboard.ts        (수정) Cmd+G, Cmd+Shift+G
  editor/library/LibraryPanel.tsx     목록·드래그·메뉴
  editor/library/api.ts               fetchComponents(), fetchComponent(), createComponent(), saveComponent(), applyLatest(), deleteComponent(), fetchUsage()
  editor/library/MakeComponentDialog.tsx
  editor/panels/RefPanel.tsx
  editor/panels/PropsPanel.tsx        컴포넌트 모드 입력값 선언·샘플 값
  editor/canvas/Canvas.tsx     (수정) refBox 선택, ref 크기 조절 금지, 더블클릭, 컴포넌트 드롭, 우클릭 메뉴
  editor/Editor.tsx            (수정) 탭에 컴포넌트, 컴포넌트 모드 분기
  editor/Toolbar.tsx           (수정) 컴포넌트 만들기 버튼, 경고 헤더 표시, 컴포넌트 모드 저장
  editor/Preview.tsx           (수정) 컴포넌트 모드 props 전송
  lib/data.ts                  (수정) sampleContext에 샘플 props
  app/components/[id]/page.tsx 컴포넌트 편집 화면
  e2e/components.spec.ts
```

## 공용 규약 (태스크 사이의 계약)

아래 이름·시그니처·경로는 모든 태스크가 그대로 쓴다. 다른 이름을 새로 만들지 않는다.

### core

```ts
// schema/component.ts
export const ComponentPropSchema = z.discriminatedUnion("type", [
  z.object({ name: IDENT, type: z.literal("string"), default: z.string(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("number"), default: z.number(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("boolean"), default: z.boolean(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("image"), default: z.string(), label: z.string().optional() }),
]);   // IDENT = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
export type ComponentProp = z.infer<typeof ComponentPropSchema>;
export const ComponentBodySchema: z.ZodType<ComponentBody>;   // { name: string(min 1), w: positive, h: positive, props: ComponentProp[] default [], elements: Element[] default [] }
// superRefine: props 이름 유일, elements 트리(walkElements)에 ref 금지, 내부 id 유일, 반복 영역 템플릿 규칙은 ReportSchema와 같게
export type ComponentBody = { name: string; w: number; h: number; props: ComponentProp[]; elements: Element[] };
export const COMPONENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const COMPONENT_KEY_RE = /^([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/;
export function componentKey(id: string, version: number): string;   // `${id}@${version}`
export function parseComponentBody(input: unknown): ComponentBody;

// schema/elements.ts (RefElementSchema 변경)
//   ref: z.string().regex(COMPONENT_ID_RE), version: z.number().int().positive(),
//   props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({})
// schema/component.ts는 elements.ts의 ElementSchema를 import한다. elements.ts는 COMPONENT_ID_RE를 쓰기 위해
// 순환을 피하려고 COMPONENT_ID_RE를 schema/ids.ts(신규, 상수만)에 두고 둘 다 거기서 import한다.

// schema/report.ts
//   ReportSchema에 components: z.record(z.string().regex(COMPONENT_KEY_RE), ComponentBodySchema).default({})
//   superRefine 추가: 본문 모든 ref에 components[componentKey(ref, version)] 존재, ref.w/h === body.w/h(차이 1e-6 이하),
//                    반복 영역 템플릿 안 ref가 가리키는 body에 continue 표·repeater가 있으면 오류
//   RESERVED_CONTEXT_NAMES에 "props" 추가

// schema/hash.ts
export function canonicalJson(value: unknown): string;   // 객체 키 정렬, undefined 속성 제거, 배열 순서 유지
export function sha256Hex(text: string): string;         // UTF-8, 순수 JS
export function componentHash(body: ComponentBody): string;   // sha256Hex(canonicalJson(body))

// ops/geometry.ts
export type Box = { x: number; y: number; w: number; h: number };
export function elementBox(el: Element): Box;            // 선은 두 끝점 경계 상자, 그 밖은 x,y,w,h
export function unionBox(boxes: Box[]): Box;
export function translateElement<T extends Element>(el: T, dx: number, dy: number): T;   // 복제본. 선은 x2,y2도

// ops/components.ts
export function refsTo(report: Report, componentId: string): Extract<Element, { type: "ref" }>[];   // walkElements 전체
export function upgradeRefs(report: Report, componentId: string, version: number, body: ComponentBody): Report;   // 스펙 7.2 규칙 1~3, 새 객체
export function pruneComponents(report: Report): Report;   // 쓰이지 않는 components 키 제거, 새 객체
export function extractComponent(parent: Element[], ids: string[], name: string): { body: ComponentBody; box: Box };   // 스펙 7.3 1~2

// ops/group.ts
export type ParentInfo = { parent: Element[]; indices: number[] } | { error: string };
export function sameParent(elements: Element[], ids: string[], opts: { allowInTemplate: boolean; allowRefs: boolean }): ParentInfo;
export function groupElements(parent: Element[], ids: string[], groupId: string): Element[];   // 새 배열. 그룹은 첫 선택 자리
export function ungroupElement(parent: Element[], groupId: string): Element[];                 // 새 배열. visible 있으면 throw Error("group has visible")
```

### renderer

```ts
// layout/flatten.ts
export type RefOwner = { refId: string; path: string; box: { x: number; y: number; w: number; h: number };   // box: ref 상자의 페이지 절대좌표 (refBox·인스턴스 #ERR 자리)
  decls: ComponentProp[]; values: Record<string, string | number | boolean> };
type FlatBase = { ancestorsVisible: string[]; owner?: RefOwner; refFlow?: "once" | "every" | "last" };
export type FlatElement = (Exclude<Element, { type: "group" | "ref" }> & FlatBase)
  | (Extract<Element, { type: "ref" }> & FlatBase & { missing: true });   // 내용을 못 찾은 ref만 남는다
export type FlattenOptions = { components?: Record<string, ComponentBody>; owner?: RefOwner; refFlow?: "once" | "every" | "last" };
export function flatten(elements: Element[], dx?: number, dy?: number, ancestorsVisible?: string[], opts?: FlattenOptions): FlatElement[];
// path는 컴포넌트 루트부터의 요소 id 경로("logo", 그룹 안이면 "box/logo")
// 펼친 자식은 owner(인스턴스 정보)와 refFlow(ref.flow)를 갖는다. refBox 항목은 layout이 페이지마다 인스턴스 첫 항목으로 만든다.
// 내용을 못 찾은 ref는 missing: true 인 FlatElement 하나로 남고, layout은 그 자리에 #ERR를 둔다.

// layout/props.ts
export function resolveRefProps(owner: RefOwner, ctx: DataContext): Record<string, unknown>;   // 기본값 + evaluateTemplateValue(values), 선언 밖 이름 버림. ExpressionError는 그대로 던짐
export function withProps(ctx: DataContext, owner: RefOwner | undefined, cache: Map<string, Record<string, unknown>>): DataContext;   // owner 없으면 ctx. cache 키 `${refId}|${page}|${copy}`

// layout/place.ts (Task 4 추가). 펼친 뒤 남는 ref(missing)는 placeStatic에서 #ERR("component <id>@<v> not found")
export function refBoxItem(owner: RefOwner, instance?: string): PlacedItem;             // refBox 항목. 반복 영역 안이면 instance = 항목 경로
export function ownedInstance(owner: RefOwner, outer?: string): string;                // `[outer/]${refId}/${path}`
export function refErrorItem(owner: RefOwner, message: string, instance?: string): PlacedText;   // ref 상자 자리 #ERR, elementId = refId
export function ownItems(items: PlacedItem[], owner: RefOwner, elId: string, base: string): PlacedItem[];   // elementId = refId, instance 없으면 base

// layout/types.ts: role에 "refBox" 추가
// 배치 항목 id 규칙: owner가 있으면 elementId = owner.refId, instance = [반복 영역 항목 경로 + "/"] + `${refId}/${path}` + [요소 자체 인스턴스 경로]
//   예: 고정 요소 "hdr/box/logo", 반복 영역 항목 안 "cards#1/hd/box/logo"
//   흐름 요소(표·반복 영역)는 instancePrefix = `${refId}/${path}/` 이므로 표 셀은 "s1/t/t#h", "s1/t/t#0", flowBox 항목 instance는 "s1/t"
// refBox: { kind:"rect", role:"refBox", elementId: refId, x,y,w,h: ref 상자, style: 채움·선 없는 기본 스타일 }, 인스턴스가 그려지는 페이지마다 그 인스턴스의 첫 항목으로 1개.
//   최상위 인스턴스의 refBox는 instance가 없고, 반복 영역 항목·밴드 안 인스턴스의 refBox는 항목 경로(예 "cards#0", "cards#g0h0")를 instance로 갖는다

// flow/types.ts: FlowOptions에 components?: Record<string, ComponentBody>
```

### studio

```ts
// lib/component-store.ts
export type ComponentSummary = { id: string; name: string; latestVersion: number; w: number; h: number; updatedAt: string };
export type ComponentDetail = { summary: ComponentSummary; versions: { version: number; hash: string; createdAt: string }[]; latest: ComponentBody };
export interface ComponentStore {
  list(): Promise<ComponentSummary[]>;
  get(id: string): Promise<ComponentDetail | null>;
  getVersion(id: string, version: number): Promise<{ body: ComponentBody; hash: string } | null>;
  create(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }>;   // 중복 ConflictError(preset-store의 것을 재사용)
  save(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }>;   // 없으면 NotFoundError
  delete(id: string): Promise<void>;   // 없으면 NotFoundError
}
export class MemoryComponentStore implements ComponentStore;
export class DbComponentStore implements ComponentStore;
export function getComponentStore(): ComponentStore;   // globalThis 보관, DATABASE_URL 없으면 메모리

// lib/component-usage.ts
export type Usage = { reportId: string; versions: number[] };
export async function findUsage(componentId: string): Promise<Usage[]>;   // getStore().list() → get() 훑기
export async function applyLatestToReports(componentId: string): Promise<{ updated: string[]; skipped: { reportId: string; error: string }[] }>;

// lib/report-guard.ts
export type GuardResult = { ok: true; report: Report; warnings: string[] } | { ok: false; status: 409; body: { error: string; code: "COMPONENT_MISMATCH" } };
export async function checkReportComponents(report: Report): Promise<GuardResult>;   // pruneComponents 후 검사
export const WARNINGS_HEADER = "X-Daport-Warnings";

// lib/body.ts
export function propsField(body: Record<string, unknown>): Record<string, unknown> | undefined;   // 객체가 아니면 undefined

// editor/store.ts 추가
componentMode: { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> } | null;   // 히스토리 밖
setComponentProps(props: ComponentProp[]): void;      // dirty = true
setSampleProps(values: Record<string, unknown>): void;
insertComponent(id: string, version: number, body: ComponentBody, x: number, y: number): void;
updateInstances(id: string, version: number, body: ComponentBody): void;   // core upgradeRefs
replaceWithComponent(ids: string[], id: string, version: number, body: ComponentBody, box: Box): void;
groupSelected(): { ok: true } | { ok: false; error: string };
ungroupSelected(): { ok: true } | { ok: false; error: string };
// createEditorStore(initial: Report, opts?: { componentMode?: EditorState["componentMode"] })

// editor/library/api.ts
export const COMPONENT_MIME = "application/x-daport-component";
export async function fetchComponents(): Promise<ComponentSummary[]>;
export async function fetchComponent(id: string): Promise<ComponentDetail>;
export async function createComponent(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }>;
export async function saveComponent(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }>;
export async function fetchUsage(id: string): Promise<Usage[]>;
export async function applyLatest(id: string): Promise<{ updated: string[]; skipped: { reportId: string; error: string }[] }>;
export async function deleteComponent(id: string): Promise<void>;
// 모두 실패 시 Error(서버 error 메시지)를 던진다

// 컴포넌트 편집 화면: Editor({ initial, componentMode }) — initial은 componentToEditReport(id, body)로 만든다
// lib/component-edit.ts
export function componentToEditReport(id: string, body: ComponentBody): Report;   // { id: `component-${id}`, name: body.name, page: { width: w, height: h, margin: [0,0,0,0] }, elements }
export function editReportToComponent(report: Report, props: ComponentProp[]): ComponentBody;
```

### 태스크 작성 중 더한 규약 (조정 결과)

```ts
// editor/store.ts (Task 9)
export type ComponentMode = { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> };
export type ActionResult = { ok: true } | { ok: false; error: string };
// EditorState: componentMode: ComponentMode | null; groupSelected(): ActionResult; ungroupSelected(): ActionResult
export function createEditorStore(initial: Report, opts?: { componentMode?: ComponentMode | null }): EditorStore;
// insertComponent는 Task 9부터 컴포넌트 모드에서 아무것도 하지 않는다. replaceWithComponent의 같은 검사는 Task 13이 더한다.
// resizeElement는 ref의 크기를 바꾸지 않는다. 그룹 id는 allocateId("group") → "group-1", "group-2" …
// 컴포넌트 저장 뒤 버전은 Toolbar가 store.setState({ componentMode: { ...mode, version } })로 올린다 (Task 13)

// editor/library/sizeNotice.ts (Task 10, Task 11 RefPanel도 쓴다)
export function sizeChangeNotice(refs: { w: number; h: number }[], body: { w: number; h: number }): string | null;   // 크기가 바뀌는 인스턴스가 없으면 null

// editor/Editor.tsx (Task 10이 만들고 Task 13이 확장)
export function Editor({ initial, componentMode }: { initial: Report; componentMode?: EditorState["componentMode"] }): JSX.Element;
type Tab = "elements" | "data" | "components" | "props";   // Task 10은 "props" 없이 만든다
// 탭 목록 tabs: Tab[] — 레포트 모드 ["elements", "data", "components"](요소·데이터·컴포넌트), 컴포넌트 모드 ["elements", "props"](요소·입력값)
// 컴포넌트 드롭(Task 10)은 Canvas에서 COMPONENT_MIME → fetchComponent → insertComponent. Canvas의 `const componentMode = useEditor((s) => s.componentMode)`는 Task 10이 선언하고 Task 12·13은 다시 선언하지 않는다

// editor/canvas/pages.ts (Task 11)
export function primaryItem(page: Page, elementId: string): PlacedItem | undefined;   // 그 요소의 refBox 항목을 먼저, 없으면 셀·테두리 아닌 첫 항목
// editor/canvas/Canvas.tsx (Task 11): react import에 `type MouseEvent`, pickElementId(e: MouseEvent<HTMLDivElement>), onDoubleClick. Task 12는 이 위에 우클릭 메뉴를 더한다

// editor/library/MakeComponentDialog.tsx (Task 12)
export const EMPTY_SELECTION_REASON: string;   // "컴포넌트로 만들 요소를 선택하세요"
export const COMPONENT_MODE_REASON: string;    // "컴포넌트 편집 화면에서는 컴포넌트를 만들 수 없습니다"
export function suggestComponentId(name: string): string;   // 영문 소문자·숫자·- slug, 남는 것이 없으면 "component"
export function makeComponentCheck(report: Report, selection: string[], componentMode: boolean): { ok: true } | { ok: false; reason: string };
export function MakeComponentDialog({ onClose }: { onClose: () => void }): JSX.Element;   // role="dialog" aria-label "컴포넌트 만들기", 입력 "이름"·"id", 버튼 "취소"·"만들기"
// Toolbar 버튼·Canvas 우클릭 menuitem 이름: "컴포넌트로 만들기"

// lib/component-edit.ts (Task 13 추가)
export type ComponentModeLike = { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> };   // store를 import하지 않으려는 구조 타입
export function defaultSampleProps(props: ComponentProp[]): Record<string, unknown>;
export function samplePropsContext(mode: ComponentModeLike): Record<string, unknown>;   // 같은 mode 객체면 같은 결과 객체
// 시그니처 변경 (Task 13): 두 번째·세 번째 인자 props는 생략 가능
export function sampleContext(report: Report, props?: Record<string, unknown>): DataContext;          // lib/data.ts
export function requestBody(report: Report, liveData: boolean, props?: Record<string, unknown>): { report: Report; params: Record<string, unknown>; props?: Record<string, unknown>; data?: Record<string, unknown> };   // lib/data.ts, props는 있을 때만
export function layoutFor(report: Report, props?: Record<string, unknown>): Page[];                   // editor/canvas/layoutCache.ts
export function layoutError(report: Report, props?: Record<string, unknown>): string | undefined;     // editor/canvas/layoutCache.ts
// 렌더 요청 본문의 샘플 입력값 필드 이름은 "props" (Task 8 propsField가 읽고 Task 13 requestBody가 싣는다)

// 화면 이름 (Task 14 E2E가 기댄다)
// RefPanel: 업데이트 버튼 `v${version} → v${latest} 업데이트`, 입력값 칸 aria-label `입력값 ${name}`
// PropsPanel: 버튼 "입력값 추가", 행 data-testid `prop-${i}`, 행 안 라벨 "이름"·"타입"(select)·"기본값"·"라벨"·"샘플 값"
// 컴포넌트 모드 툴바: data-testid="component-version" 텍스트 `v${n} (저장하면 v${n + 1})`, 저장 버튼 data-testid="save"(레포트 모드와 같음)
// 레포트 저장 경고: Toolbar data-testid="save-warnings" (Task 14)
```

---
## 태스크 목록

| # | 태스크 | 의존 |
|---|---|---|
| 1 | core: 컴포넌트 스키마, ref 확장, report.components 검증 | - |
| 2 | core: 정규 JSON과 SHA-256 내용 해시 | 1 |
| 3 | core: 기하·컴포넌트 변환(upgradeRefs·pruneComponents·extractComponent)·그룹 변환 | 1 |
| 4 | renderer: ref 펼치기, props 컨텍스트, id 규칙, refBox, #ERR | 1 |
| 5 | renderer·pdf: 컴포넌트 예제 골든과 PDF 비교 | 4 |
| 6 | studio: 컴포넌트 저장소(메모리·DB)와 DB 스키마 | 1, 2 |
| 7 | studio: 컴포넌트 API(목록·조회·버전·생성·저장·사용처·일괄 적용·삭제) | 3, 6 |
| 8 | studio: 레포트 저장 검사·정리·경고 헤더, 렌더 라우트 props 필드 | 3, 6 |
| 9 | studio: 스토어 액션(삽입·업데이트·치환·그룹화·해제)과 단축키 | 3 |
| 10 | studio: 라이브러리 패널과 캔버스 드롭 | 7, 9 |
| 11 | studio: RefPanel과 캔버스 인스턴스 선택·더블클릭 | 4, 9, 10 |
| 12 | studio: 컴포넌트 만들기 대화상자(툴바·우클릭) | 7, 9 |
| 13 | studio: 컴포넌트 편집 화면(컴포넌트 모드·PropsPanel·저장) | 7, 8, 9 |
| 14 | studio: E2E와 경고 헤더 표시 | 10–13 |

## 태스크

### Task 1: core 컴포넌트 스키마, ref 확장, report.components 검증

**Files:**
- Create: `packages/core/src/schema/ids.ts`
- Create: `packages/core/src/schema/component.ts`
- Modify: `packages/core/src/schema/elements.ts` (`RefElementSchema`)
- Modify: `packages/core/src/schema/report.ts` (`RESERVED_CONTEXT_NAMES`, `components` 필드, `superRefine`)
- Modify: `packages/core/src/index.ts`
- Modify (기존 테스트의 ref 요소에 `version`·`components` 추가): `packages/core/src/__tests__/schema.test.ts`, `packages/renderer/src/__tests__/place.test.ts`, `packages/renderer/src/__tests__/layout.test.ts`
- Test: `packages/core/src/__tests__/component-schema.test.ts`

이 태스크에서 정한 스키마 오류 메시지(다른 태스크·studio가 그대로 비교할 수 있다):

| 규칙 | 메시지 |
|---|---|
| 입력값 이름 중복 | `duplicate prop name: <name>` |
| 컴포넌트 안의 ref | `ref inside component: <id>` |
| 컴포넌트 안 id 중복 | `duplicate element id: <id>` (레포트와 같은 문구) |
| 컴포넌트 안 반복 영역 템플릿 규칙 | `repeater inside repeater template: <id>`, `table inside repeater template must be overflow "clip": <id>` (레포트와 같은 문구) |
| 참조한 내용 없음 | `missing component <id>@<version>: <refId>` |
| ref 크기 불일치 | `ref size differs from component <id>@<version>: <refId>` |
| 반복 영역 템플릿 안 ref의 내용에 넘기는 표·반복 영역 | `component with continue table or repeater inside repeater template: <refId>` |

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/component-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  ComponentBodySchema, ComponentPropSchema, parseComponentBody, componentKey, COMPONENT_ID_RE, COMPONENT_KEY_RE,
} from "../schema/component";
import { ElementSchema } from "../schema/elements";
import { parseReport, safeParseReport, RESERVED_CONTEXT_NAMES } from "../schema/report";
import { reportJsonSchema } from "../schema/json-schema";
import * as core from "../index";

const text = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", x: 1, y: 1, w: 20, h: 5, value: "x", ...extra });
const table = (id: string, overflow?: string) => ({ id, type: "table", x: 0, y: 0, w: 100, h: 50, source: "items", columns: [], ...(overflow ? { overflow } : {}) });
const repeater = (id: string, children: unknown[]) => ({ id, type: "repeater", x: 0, y: 0, w: 100, h: 100, source: "lots", item: { w: 50, h: 20, children } });
const group = (id: string, children: unknown[]) => ({ id, type: "group", x: 0, y: 0, w: 60, h: 30, children });
const ref = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "ref", x: 5, y: 5, w: 180, h: 24, ref: "company-header", version: 3, ...extra });
const body = (extra: Record<string, unknown> = {}) => ({ name: "회사 헤더", w: 180, h: 24, elements: [text("title")], ...extra });
const bodyIssues = (input: unknown) => { const r = ComponentBodySchema.safeParse(input); return r.success ? [] : r.error.issues.map((i) => i.message); };
const base = { id: "r", version: 1, page: { width: 210, height: 297 } };
const issues = (input: unknown) => { const r = safeParseReport(input); return r.success ? [] : r.error.issues.map((i) => i.message); };

describe("component body schema", () => {
  it("parses with defaults props=[] and elements=[] and fills element defaults", () => {
    const b = parseComponentBody({ name: "빈 컴포넌트", w: 10, h: 5 });
    expect(b).toEqual({ name: "빈 컴포넌트", w: 10, h: 5, props: [], elements: [] });
    const full = parseComponentBody(body({ props: [{ name: "title", type: "string", default: "품질보증서", label: "제목" }] }));
    expect(full.props).toEqual([{ name: "title", type: "string", default: "품질보증서", label: "제목" }]);
    expect(full.elements[0]).toMatchObject({ id: "title", type: "text", flow: "once", style: { fontSize: 10 } });
  });
  it("rejects empty name and non-positive size", () => {
    expect(ComponentBodySchema.safeParse(body({ name: "" })).success).toBe(false);
    expect(ComponentBodySchema.safeParse(body({ w: 0 })).success).toBe(false);
    expect(ComponentBodySchema.safeParse(body({ h: -1 })).success).toBe(false);
  });
  it("accepts each prop type with a matching default", () => {
    for (const p of [
      { name: "title", type: "string", default: "" },
      { name: "qty", type: "number", default: 3 },
      { name: "showLogo", type: "boolean", default: true },
      { name: "logo", type: "image", default: "asset://logo" },
      { name: "_x1", type: "image", default: "https://example.com/a.png" },
    ]) expect(ComponentPropSchema.safeParse(p).success).toBe(true);
  });
  it("rejects a default that does not match the type, a missing default and an unknown type", () => {
    expect(ComponentPropSchema.safeParse({ name: "a", type: "string", default: 1 }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "number", default: "1" }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "boolean", default: "true" }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "image", default: false }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "string" }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "date", default: "" }).success).toBe(false);
  });
  it("rejects prop names that are not identifiers", () => {
    for (const name of ["1a", "a-b", "a b", "", "제목"]) {
      expect(ComponentPropSchema.safeParse({ name, type: "string", default: "" }).success).toBe(false);
    }
  });
  it("rejects duplicate prop names", () => {
    const props = [{ name: "title", type: "string", default: "" }, { name: "title", type: "number", default: 0 }];
    expect(bodyIssues(body({ props }))).toContain("duplicate prop name: title");
  });
  it("rejects a ref anywhere in the element tree (no nesting)", () => {
    expect(bodyIssues(body({ elements: [ref("inner")] }))).toContain("ref inside component: inner");
    expect(bodyIssues(body({ elements: [group("g", [ref("deep")])] }))).toContain("ref inside component: deep");
    expect(bodyIssues(body({ elements: [repeater("rp", [ref("tpl")])] }))).toContain("ref inside component: tpl");
  });
  it("rejects duplicate element ids inside the component tree, including groups and templates", () => {
    expect(bodyIssues(body({ elements: [text("a"), text("a")] }))).toContain("duplicate element id: a");
    expect(bodyIssues(body({ elements: [text("a"), group("g", [text("a")])] }))).toContain("duplicate element id: a");
    expect(bodyIssues(body({ elements: [text("a"), repeater("rp", [text("a")])] }))).toContain("duplicate element id: a");
  });
  it("applies the repeater template rules like the report schema, and allows flow elements at top level", () => {
    expect(bodyIssues(body({ elements: [repeater("rp", [repeater("rp2", [])])] }))).toContain("repeater inside repeater template: rp2");
    expect(bodyIssues(body({ elements: [repeater("rp", [table("t")])] }))).toContain('table inside repeater template must be overflow "clip": t');
    expect(bodyIssues(body({ elements: [repeater("rp", [table("t", "clip")])] }))).toEqual([]);
    expect(bodyIssues(body({ elements: [table("t"), repeater("rp", [text("nm")])] }))).toEqual([]);
  });
});

describe("component ids and keys", () => {
  it("builds keys and matches the id/key formats", () => {
    expect(componentKey("company-header", 3)).toBe("company-header@3");
    for (const id of ["company-header", "h1", "0abc"]) expect(COMPONENT_ID_RE.test(id)).toBe(true);
    for (const id of ["Company", "-x", "a_b", "a@1", ""]) expect(COMPONENT_ID_RE.test(id)).toBe(false);
    expect("company-header@3".match(COMPONENT_KEY_RE)?.slice(1)).toEqual(["company-header", "3"]);
    for (const key of ["company-header", "company-header@0", "company-header@01", "Company@1", "a@1.5", "@1"]) {
      expect(COMPONENT_KEY_RE.test(key)).toBe(false);
    }
  });
});

describe("ref element schema", () => {
  it("parses ref with version and string/number/boolean props, props default {}", () => {
    const el = ElementSchema.parse(ref("hdr", { props: { title: "{{ record.DOC_TITLE }}", qty: 2, showLogo: false } }));
    expect(el).toMatchObject({ type: "ref", ref: "company-header", version: 3, props: { title: "{{ record.DOC_TITLE }}", qty: 2, showLogo: false } });
    const bare = ElementSchema.parse(ref("hdr"));
    if (bare.type === "ref") expect(bare.props).toEqual({});
  });
  it("requires a positive integer version", () => {
    const { version: _omit, ...noVersion } = ref("hdr");
    expect(ElementSchema.safeParse(noVersion).success).toBe(false);
    for (const version of [0, -1, 1.5, "3"]) expect(ElementSchema.safeParse(ref("hdr", { version })).success).toBe(false);
  });
  it("requires ref to be a component id", () => {
    for (const r of ["Company", "a/b", "", "company-header@3"]) expect(ElementSchema.safeParse(ref("hdr", { ref: r })).success).toBe(false);
  });
  it("rejects prop values that are not string, number or boolean", () => {
    for (const v of [null, [1], { a: 1 }]) expect(ElementSchema.safeParse(ref("hdr", { props: { title: v } })).success).toBe(false);
  });
});

describe("report components", () => {
  const components = { "company-header@3": body() };
  it("defaults components to {} and keeps parsed bodies", () => {
    expect(parseReport(base).components).toEqual({});
    const r = parseReport({ ...base, components, elements: [ref("hdr")] });
    expect(r.components["company-header@3"]).toMatchObject({ name: "회사 헤더", w: 180, h: 24, props: [] });
    expect(r.components["company-header@3"].elements[0]).toMatchObject({ id: "title", style: { fontSize: 10 } });
  });
  it("rejects malformed component keys", () => {
    for (const key of ["company-header", "company-header@0", "Company@1", "a@b"]) {
      expect(safeParseReport({ ...base, components: { [key]: body() } }).success).toBe(false);
    }
  });
  it("validates each embedded body with the component rules", () => {
    expect(issues({ ...base, components: { "company-header@3": body({ elements: [ref("inner")] }) } })).toContain("ref inside component: inner");
    expect(issues({ ...base, components: { "company-header@3": body({ elements: [text("a"), text("a")] }) } })).toContain("duplicate element id: a");
  });
  it("allows unused components entries", () => {
    expect(issues({ ...base, components: { "company-header@3": body(), "company-header@2": body() } })).toEqual([]);
  });
  it("rejects a ref whose component version is missing, at top level, in groups and in repeater templates", () => {
    expect(issues({ ...base, elements: [ref("hdr")] })).toContain("missing component company-header@3: hdr");
    expect(issues({ ...base, components: { "company-header@2": body() }, elements: [ref("hdr")] })).toContain("missing component company-header@3: hdr");
    expect(issues({ ...base, elements: [group("g", [ref("inGroup")])] })).toContain("missing component company-header@3: inGroup");
    expect(issues({ ...base, elements: [repeater("rp", [ref("inTpl")])] })).toContain("missing component company-header@3: inTpl");
    const withBand = { ...repeater("rp", []), groups: [{ by: "item.LINE", header: { h: 8, children: [ref("inBand")] } }] };
    expect(issues({ ...base, elements: [withBand] })).toContain("missing component company-header@3: inBand");
  });
  it("does not treat inherited object keys as components", () => {
    expect(issues({ ...base, elements: [ref("hdr", { ref: "constructor", version: 1 })] })).toContain("missing component constructor@1: hdr");
  });
  it("rejects a ref whose w/h differ from the component body", () => {
    expect(issues({ ...base, components, elements: [ref("hdr", { w: 170 })] })).toContain("ref size differs from component company-header@3: hdr");
    expect(issues({ ...base, components, elements: [ref("hdr", { h: 30 })] })).toContain("ref size differs from component company-header@3: hdr");
    expect(issues({ ...base, components, elements: [ref("hdr", { w: 180 + 1e-9 })] })).toEqual([]);
  });
  it("rejects a component with a continue table or a repeater used inside a repeater template", () => {
    const flowComponents = {
      "std-table@1": { name: "표준 표", w: 50, h: 20, elements: [table("t")] },
      "cards@1": { name: "카드", w: 50, h: 20, elements: [repeater("inner", [text("nm")])] },
      "clip-table@1": { name: "잘린 표", w: 50, h: 20, elements: [group("g", [table("t", "clip")])] },
    };
    const inTpl = (id: string, name: string) => ref(id, { ref: name, version: 1, w: 50, h: 20 });
    expect(issues({ ...base, components: flowComponents, elements: [repeater("rp", [inTpl("a", "std-table")])] }))
      .toContain("component with continue table or repeater inside repeater template: a");
    expect(issues({ ...base, components: flowComponents, elements: [repeater("rp", [group("g", [inTpl("b", "cards")])])] }))
      .toContain("component with continue table or repeater inside repeater template: b");
    expect(issues({ ...base, components: flowComponents, elements: [repeater("rp", [inTpl("c", "clip-table")])] })).toEqual([]);
    expect(issues({ ...base, components: flowComponents, elements: [inTpl("d", "std-table"), inTpl("e", "cards")] })).toEqual([]);
  });
  it("applies id uniqueness to the report tree only; component internal ids may overlap report ids", () => {
    expect(issues({ ...base, components, elements: [text("title"), ref("hdr")] })).toEqual([]);
    expect(issues({ ...base, components, elements: [ref("hdr", { x: 0 }), ref("hdr2", { y: 40 })] })).toEqual([]);
    expect(issues({ ...base, components, elements: [ref("hdr"), text("hdr")] })).toContain("duplicate element id: hdr");
  });
  it("reserves props as a context name for datasets and repeat.as", () => {
    expect(RESERVED_CONTEXT_NAMES).toContain("props");
    expect(issues({ ...base, datasets: [{ name: "props", type: "static", rows: [] }] })).toContain("reserved name: props");
    expect(issues({ ...base, repeat: { source: "s", as: "props" } })).toContain("reserved name: props");
  });
  it("exports the component API from the package index and keeps the JSON schema export working", () => {
    expect(core.componentKey("a", 1)).toBe("a@1");
    expect(core.parseComponentBody).toBe(parseComponentBody);
    expect(core.ComponentBodySchema).toBe(ComponentBodySchema);
    expect(core.COMPONENT_KEY_RE).toBe(COMPONENT_KEY_RE);
    const js = reportJsonSchema() as { properties: { components: { propertyNames: { pattern: string } } } };
    expect(js.properties.components.propertyNames.pattern).toBe(COMPONENT_KEY_RE.source);
    expect(JSON.stringify(js)).toContain('"required":["id","x","y","w","h","type","ref","version"]');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/core && pnpm exec vitest run src/__tests__/component-schema.test.ts`
Expected: FAIL — `Failed to resolve import "../schema/component"` (파일이 아직 없다).

- [ ] **Step 3: id 상수와 컴포넌트 스키마 구현**

`packages/core/src/schema/ids.ts` (상수만 둔다. `elements.ts`가 `component.ts`를 import하면 `component.ts → elements.ts` 순환이 생기므로 둘 다 여기서 가져온다):
```ts
/** 컴포넌트 id·키 형식. elements.ts와 component.ts가 함께 쓰므로 순환 import를 피하려고 상수만 둔다 */
export const COMPONENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** report.components 키: "<컴포넌트id>@<버전>". 1번 그룹이 id, 2번 그룹이 버전 */
export const COMPONENT_KEY_RE = /^([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)$/;
```

`packages/core/src/schema/component.ts` (`COMPONENT_ID_RE`·`COMPONENT_KEY_RE`는 여기서 재export한다. `index.ts`는 `ids.ts`를 따로 export하지 않는다):
```ts
import { z } from "zod";
import { ElementSchema, type Element } from "./elements";
import { walkElements } from "./tree";
export { COMPONENT_ID_RE, COMPONENT_KEY_RE } from "./ids";

const IDENT = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "입력값 이름은 식별자여야 합니다");

/** 컴포넌트 입력값 선언. default는 필수이고 type과 맞아야 한다(image는 asset://id 또는 URL 문자열) */
export const ComponentPropSchema = z.discriminatedUnion("type", [
  z.object({ name: IDENT, type: z.literal("string"), default: z.string(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("number"), default: z.number(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("boolean"), default: z.boolean(), label: z.string().optional() }),
  z.object({ name: IDENT, type: z.literal("image"), default: z.string(), label: z.string().optional() }),
]);
export type ComponentProp = z.infer<typeof ComponentPropSchema>;

/** 라이브러리 컴포넌트 한 버전의 불변 내용. elements 좌표는 컴포넌트 상자(0,0 ~ w,h) 기준 */
export type ComponentBody = { name: string; w: number; h: number; props: ComponentProp[]; elements: Element[] };

export const ComponentBodySchema: z.ZodType<ComponentBody> = z.object({
  name: z.string().min(1),
  w: z.number().positive(),
  h: z.number().positive(),
  props: z.array(ComponentPropSchema).default([]),
  elements: z.array(ElementSchema).default([]),
}).superRefine((b, ctx) => {
  const propNames = new Set<string>();
  b.props.forEach((p, i) => {
    if (propNames.has(p.name)) ctx.addIssue({ code: "custom", message: `duplicate prop name: ${p.name}`, path: ["props", i, "name"] });
    propNames.add(p.name);
  });
  const seen = new Set<string>();
  walkElements(b.elements, (el, _parent, _i, ancestors) => {
    if (el.type === "ref") ctx.addIssue({ code: "custom", message: `ref inside component: ${el.id}`, path: ["elements"] });
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: ["elements"] });
    seen.add(el.id);
    const inTemplate = ancestors.some((a) => a.type === "repeater");
    if (inTemplate && el.type === "repeater") ctx.addIssue({ code: "custom", message: `repeater inside repeater template: ${el.id}`, path: ["elements"] });
    if (inTemplate && el.type === "table" && el.overflow !== "clip") {
      ctx.addIssue({ code: "custom", message: `table inside repeater template must be overflow "clip": ${el.id}`, path: ["elements"] });
    }
  });
}) as unknown as z.ZodType<ComponentBody>;

export function componentKey(id: string, version: number): string { return `${id}@${version}`; }
export function parseComponentBody(input: unknown): ComponentBody { return ComponentBodySchema.parse(input); }
```

- [ ] **Step 4: ref 요소 스키마 변경**

`packages/core/src/schema/elements.ts` 맨 위 import 줄 아래에 추가:
```ts
import { COMPONENT_ID_RE } from "./ids";
```

같은 파일의 `RefElementSchema` 전체를 다음으로 바꾼다:
```ts
export const RefElementSchema = Base.extend({
  type: z.literal("ref"),
  ref: z.string().regex(COMPONENT_ID_RE, "ref는 컴포넌트 id 형식이어야 합니다"),
  version: z.number().int().positive(),
  /** 입력값. 문자열은 템플릿(값 전체가 {{ }} 하나면 원래 타입 유지). 지정하지 않은 이름은 기본값 */
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
```

- [ ] **Step 5: ReportSchema 확장**

`packages/core/src/schema/report.ts`의 import 두 줄을 다음으로 바꾼다:
```ts
import { ElementSchema, type Element } from "./elements";
import { walkElements } from "./tree";
import { ComponentBodySchema, COMPONENT_KEY_RE, componentKey } from "./component";
```

`RESERVED_CONTEXT_NAMES` 끝에 `"props"`를 더한다(`RESERVED_REPEAT_AS_NAMES`는 이 목록에서 만들어지므로 `repeat.as`도 함께 막힌다):
```ts
export const RESERVED_CONTEXT_NAMES: readonly string[] = [
  "params", "secrets", "record", "row", "item", "index", "group", "rows", "pageRows", "page", "total", "sheet", "sheets", "copy", "copies", "props",
];
```

`export const ReportSchema = z.object({` 바로 위에 추가:
```ts
/** 반복 영역 템플릿에 넣을 수 없는 요소(repeater, overflow가 clip이 아닌 table)가 트리에 있는가 */
function hasFlowElement(elements: Element[]): boolean {
  return walkElements(elements, (el) => el.type === "repeater" || (el.type === "table" && el.overflow !== "clip"));
}
```

`ReportSchema`의 `output: OutputSchema.default({ kind: "pdf" }),` 줄 바로 아래에 필드를 추가한다:
```ts
  /** 이 레포트가 쓰는 컴포넌트 버전의 내용. 키 "<컴포넌트id>@<버전>" */
  components: z.record(z.string().regex(COMPONENT_KEY_RE, "components 키는 <컴포넌트id>@<버전> 형식이어야 합니다"), ComponentBodySchema).default({}),
```

`superRefine` 안의 `walkElements(r.elements, …)` 콜백을 다음으로 바꾼다(기존 id·템플릿 검사는 그대로, 끝에 ref 검사 추가. id 유일성은 레포트 본문 트리에만 적용되고 `components` 내부 id는 여기서 보지 않는다):
```ts
  walkElements(r.elements, (el, _parent, _i, ancestors) => {
    if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: ["elements"] });
    seen.add(el.id);
    const inTemplate = ancestors.some((a) => a.type === "repeater");
    if (inTemplate && el.type === "repeater") ctx.addIssue({ code: "custom", message: `repeater inside repeater template: ${el.id}`, path: ["elements"] });
    if (inTemplate && el.type === "table" && el.overflow !== "clip") {
      ctx.addIssue({ code: "custom", message: `table inside repeater template must be overflow "clip": ${el.id}`, path: ["elements"] });
    }
    if (el.type === "ref") {
      const key = componentKey(el.ref, el.version);
      const body = Object.hasOwn(r.components, key) ? r.components[key] : undefined;
      if (!body) {
        ctx.addIssue({ code: "custom", message: `missing component ${key}: ${el.id}`, path: ["elements"] });
        return;
      }
      if (Math.abs(el.w - body.w) > 1e-6 || Math.abs(el.h - body.h) > 1e-6) {
        ctx.addIssue({ code: "custom", message: `ref size differs from component ${key}: ${el.id}`, path: ["elements"] });
      }
      if (inTemplate && hasFlowElement(body.elements)) {
        ctx.addIssue({ code: "custom", message: `component with continue table or repeater inside repeater template: ${el.id}`, path: ["elements"] });
      }
    }
  });
```

- [ ] **Step 6: index 재export**

`packages/core/src/index.ts`의 `export * from "./schema/tree";` 줄 아래에 추가:
```ts
export * from "./schema/component";
```

- [ ] **Step 7: 새 테스트 통과, 기존 테스트 실패 확인**

Run: `cd packages/core && pnpm exec vitest run src/__tests__/component-schema.test.ts`
Expected: PASS (25 tests).

Run: `pnpm --filter @daport/core test`
Expected: FAIL 1건 — `schema.test.ts > accepts table/barcode/ref/pageNumber types`에서 `elements.2.version: Invalid input: expected number, received undefined`. ref에 `version`이 필수가 되었기 때문이다(다음 단계에서 고친다).

- [ ] **Step 8: 기존 테스트의 ref 요소 갱신**

저장소에서 `type: "ref"`를 만드는 테스트·픽스처는 아래 세 곳뿐이다(`grep -rn '"ref"' packages apps --include='*.ts' --include='*.tsx' --include='*.json' --exclude-dir=node_modules`로 확인. studio 테스트·JSON 픽스처에는 없다). 셋 다 `version: 1`과 크기가 같은 빈 내용 `components`를 더한다. 렌더러 기대값(`placeholder`)은 바꾸지 않는다(펼치기는 Task 4).

`packages/core/src/__tests__/schema.test.ts`의 `accepts table/barcode/ref/pageNumber types (declared only)` 테스트 앞부분을 바꾼다:
```ts
    const r = parseReport({ ...base, components: { "hdr@1": { name: "hdr", w: 40, h: 5 } }, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "qr", value: "{{ params.lot }}" },
      { id: "p", type: "pageNumber", x: 0, y: 280, w: 40, h: 5 },
      { id: "c", type: "ref", x: 0, y: 0, w: 40, h: 5, ref: "hdr", version: 1 },
```

`packages/renderer/src/__tests__/place.test.ts`의 `const flat = …` 줄을 다음 두 줄로 바꾼다:
```ts
const components = { "hdr@1": { name: "hdr", w: 5, h: 5 } };
const flat = (els: unknown[]) => flatten(parseReport({ id: "r", version: 1, page, components, elements: els as never }).elements);
```
같은 파일의 ref 요소 줄:
```ts
      { id: "c", type: "ref", x: 0, y: 0, w: 5, h: 5, ref: "hdr", version: 1 },
```

`packages/renderer/src/__tests__/layout.test.ts`의 `draws a barcode as svg, a table as a flowBox and keeps ref as a placeholder` 테스트 앞부분을 바꾼다:
```ts
    const r = parseReport({ id: "r", version: 1, page, components: { "hdr@1": { name: "hdr", w: 10, h: 5 } }, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
      { id: "c", type: "ref", x: 0, y: 0, w: 10, h: 5, ref: "hdr", version: 1 },
```

- [ ] **Step 9: 전체 통과와 타입 검사**

Run: `pnpm --filter @daport/core test`
Expected: 모두 통과.

Run: `pnpm --filter @daport/renderer test`
Expected: 모두 통과(골든 스냅샷 변화 없음).

Run: `pnpm typecheck`
Expected: 오류 없음. `Report` 타입에 `components`가 생겼지만 레포트 객체는 모두 `parseReport`를 거쳐 만들어지므로 studio·pdf·label 코드는 바꿀 것이 없다.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/schema/ids.ts packages/core/src/schema/component.ts packages/core/src/schema/elements.ts \
  packages/core/src/schema/report.ts packages/core/src/index.ts \
  packages/core/src/__tests__/component-schema.test.ts packages/core/src/__tests__/schema.test.ts \
  packages/renderer/src/__tests__/place.test.ts packages/renderer/src/__tests__/layout.test.ts
git commit -m "$(cat <<'EOF'
feat(core): 컴포넌트 내용 스키마, ref 버전·입력값, report.components 참조 검증

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: core 정규 JSON과 SHA-256 내용 해시

**Files:**
- Create: `packages/core/src/schema/hash.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/hash.test.ts`

규칙(스펙 4.2): `canonicalJson`은 객체 키를 정렬하고 값이 `undefined`인 속성을 지우며 배열 순서는 유지한다. 공백 없이 쓴다. `sha256Hex`는 문자열을 UTF-8로 인코딩해 순수 JS로 해시한다(`node:crypto`·`crypto.subtle` 없음. `crypto.subtle`은 비동기라 동기 API로 쓸 수 없고, `node:crypto`는 브라우저 번들에서 쓸 수 없다). `node:crypto`는 테스트에서 기대값을 만들 때만 쓴다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/hash.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Hex, componentHash } from "../schema/hash";
import { parseComponentBody, type ComponentBody } from "../schema/component";
import * as core from "../index";

const nodeSha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
    expect(canonicalJson([{ z: 1, y: 2 }, { x: 3 }])).toBe('[{"y":2,"z":1},{"x":3}]');
  });
  it("gives the same string regardless of key insertion order", () => {
    expect(canonicalJson({ name: "h", w: 1, props: [], elements: [] })).toBe(canonicalJson({ elements: [], props: [], w: 1, name: "h" }));
  });
  it("removes undefined properties but keeps null, false, 0 and empty string", () => {
    expect(canonicalJson({ a: undefined, b: null, c: false, d: 0, e: "" })).toBe('{"b":null,"c":false,"d":0,"e":""}');
    expect(canonicalJson({ a: { label: undefined } })).toBe('{"a":{}}');
  });
  it("writes scalars and escapes strings like JSON.stringify, without whitespace", () => {
    expect(canonicalJson("따옴표\"와\n줄바꿈")).toBe(JSON.stringify("따옴표\"와\n줄바꿈"));
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
    expect(canonicalJson({ "키 b": 1, "키 a": 2 })).toBe('{"키 a":2,"키 b":1}');
  });
});

describe("sha256Hex", () => {
  it("matches the published SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
      .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
  it("hashes the UTF-8 bytes of Korean text like node:crypto", () => {
    for (const s of ["품질보증서", "회사 헤더 {{ props.title }}", "가".repeat(1000)]) expect(sha256Hex(s)).toBe(nodeSha(s));
  });
  it("agrees with node:crypto across padding boundaries (55, 56, 63, 64, 65 bytes and multi-block)", () => {
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const s = "a".repeat(n);
      expect(sha256Hex(s)).toBe(nodeSha(s));
    }
  });
  it("does not import node or web crypto so it runs the same in the browser", () => {
    const src = readFileSync(new URL("../schema/hash.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'](node:)?crypto["']/);
    expect(src).not.toMatch(/crypto\.subtle|require\(/);
  });
  it("returns 64 lowercase hex characters", () => {
    expect(sha256Hex("daport")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("componentHash", () => {
  const body: ComponentBody = parseComponentBody({
    name: "회사 헤더", w: 180, h: 24,
    props: [{ name: "title", type: "string", default: "품질보증서", label: "제목" }],
    elements: [{ id: "title", type: "text", x: 0, y: 0, w: 180, h: 10, value: "{{ props.title }}" }],
  });
  it("equals sha256Hex of the canonical JSON", () => {
    expect(componentHash(body)).toBe(sha256Hex(canonicalJson(body)));
    expect(componentHash(body)).toBe(nodeSha(canonicalJson(body)));
  });
  it("does not depend on key order or undefined properties", () => {
    const reordered = JSON.parse(canonicalJson(body)) as Record<string, unknown>;
    const shuffled = { elements: reordered.elements, props: reordered.props, h: reordered.h, w: reordered.w, name: reordered.name, extra: undefined };
    expect(componentHash(shuffled as unknown as ComponentBody)).toBe(componentHash(body));
    const clone = structuredClone(body);
    expect(componentHash(clone)).toBe(componentHash(body));
  });
  it("changes when one character of the content changes", () => {
    const changed = structuredClone(body);
    const t = changed.elements[0];
    if (t.type === "text") t.value = "{{ props.titlE }}";
    expect(componentHash(changed)).not.toBe(componentHash(body));
    expect(componentHash({ ...body, name: "회사 헤더2" })).not.toBe(componentHash(body));
  });
  it("changes when array order changes", () => {
    const two = { ...body, props: [...body.props, { name: "no", type: "number" as const, default: 1 }] };
    const swapped = { ...two, props: [two.props[1], two.props[0]] };
    expect(componentHash(swapped)).not.toBe(componentHash(two));
  });
  it("is exported from the package index", () => {
    expect(core.componentHash).toBe(componentHash);
    expect(core.sha256Hex).toBe(sha256Hex);
    expect(core.canonicalJson).toBe(canonicalJson);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/core && pnpm exec vitest run src/__tests__/hash.test.ts`
Expected: FAIL — `Failed to resolve import "../schema/hash"` (파일이 아직 없다).

- [ ] **Step 3: canonicalJson 구현**

`packages/core/src/schema/hash.ts` (파일 앞부분):
```ts
import type { ComponentBody } from "./component";

/**
 * 정규 JSON: 객체 키를 코드 단위 순서로 정렬하고 값이 undefined인 속성을 지우며 배열 순서는 유지한다.
 * 배열 안의 undefined·함수는 JSON.stringify와 같게 null로 쓴다. 해시 입력이므로 공백을 넣지 않는다
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined && typeof obj[k] !== "function").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
```

- [ ] **Step 4: sha256Hex·componentHash 구현**

같은 파일에 이어서 추가:
```ts
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256(UTF-8(text))의 소문자 16진 문자열. node:crypto·WebCrypto 없이 Node·브라우저에서 같은 값을 낸다 */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const bitLen = data.length * 8;
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6));
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const s15 = W[t - 15], s2 = W[t - 2];
      const r1 = ((s15 >>> 7) | (s15 << 25)) ^ ((s15 >>> 18) | (s15 << 14)) ^ (s15 >>> 3);
      const r2 = ((s2 >>> 17) | (s2 << 15)) ^ ((s2 >>> 19) | (s2 << 13)) ^ (s2 >>> 10);
      W[t] = (r2 + W[t - 7] + r1 + W[t - 16]) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const T1 = (S1 + ((e & f) ^ (~e & g)) + h + K[t] + W[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const T2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + T1) | 0; d = c; c = b; b = a; a = (T1 + T2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
}

/** 컴포넌트 내용 해시: sha256Hex(canonicalJson(body)) */
export function componentHash(body: ComponentBody): string {
  return sha256Hex(canonicalJson(body));
}
```

`packages/core/src/index.ts`의 `export * from "./schema/component";` 줄(Task 1에서 추가) 아래에 추가:
```ts
export * from "./schema/hash";
```

- [ ] **Step 5: 통과 확인**

Run: `cd packages/core && pnpm exec vitest run src/__tests__/hash.test.ts`
Expected: PASS (14 tests).

Run: `pnpm --filter @daport/core test`
Expected: 모두 통과.

- [ ] **Step 6: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schema/hash.ts packages/core/src/index.ts packages/core/src/__tests__/hash.test.ts
git commit -m "$(cat <<'EOF'
feat(core): 정규 JSON과 순수 JS SHA-256 컴포넌트 내용 해시

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: core 기하·컴포넌트 변환·그룹 변환

**Files:**
- Create: `packages/core/src/ops/geometry.ts`, `packages/core/src/ops/components.ts`, `packages/core/src/ops/group.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/ops-geometry.test.ts`, `packages/core/src/__tests__/ops-components.test.ts`, `packages/core/src/__tests__/ops-group.test.ts`

전제: Task 1이 끝나 `ComponentBody`·`componentKey`·`COMPONENT_KEY_RE`(`schema/component.ts`), `ref.version`, `report.components`가 있다.

결정 사항(스펙이 정하지 않은 부분):
- 좌표 계산 결과는 1e-6mm로 반올림한다. 상대좌표로 옮겼다가 되돌려도(그룹화 → 해제) 부동소수 오차가 남지 않아 되돌림이 정확히 원래 트리와 같다.
- `upgradeRefs`는 새 버전으로 모든 인스턴스를 올리므로 규칙 3은 "이 컴포넌트의 다른 버전 키를 모두 지운다"와 같다. 다른 컴포넌트의 항목은 쓰이지 않아도 건드리지 않는다(`pruneComponents`의 일이다).
- `sameParent`는 선택 1개 이상을 허용한다(7.3은 1개 허용, 7.4는 개수 조건이 없다). 중복 id는 무시한다. `allowRefs: false`는 선택 요소 자손(그룹 안)의 `ref`까지 막는다(중첩 금지).
- 선택이 문서 순서로 이어져 있지 않으면 그룹화 후 해제한 결과는 자식들이 첫 선택 자리에 모인다. 되돌림 테스트는 이어진 선택으로 원래 트리와 같음을 검증하고, 떨어진 선택의 순서 변화도 테스트로 고정한다.
- `extractComponent`는 크기 0 상자(가로선 하나 등)를 막지 않는다. `ComponentBodySchema`(w·h 양수)가 `POST /api/components`에서 400으로 거부한다.

- [ ] **Step 1: 기하 실패 테스트 작성**

`packages/core/src/__tests__/ops-geometry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ElementSchema, type Element } from "../schema/elements";
import { elementBox, unionBox, translateElement } from "../ops/geometry";

const el = (input: unknown) => ElementSchema.parse(input);

describe("elementBox", () => {
  it("uses x, y, w, h for boxed elements", () => {
    expect(elementBox(el({ id: "t", type: "text", x: 3, y: 4, w: 20, h: 5 }))).toEqual({ x: 3, y: 4, w: 20, h: 5 });
  });
  it("uses both end points for a line drawn right-to-left and bottom-to-top", () => {
    expect(elementBox(el({ id: "l", type: "line", x: 40, y: 30, w: 0, h: 0, x2: 10, y2: 20 }))).toEqual({ x: 10, y: 20, w: 30, h: 10 });
  });
  it("gives a flat line zero height", () => {
    expect(elementBox(el({ id: "l", type: "line", x: 5, y: 8, w: 0, h: 0, x2: 25, y2: 8 }))).toEqual({ x: 5, y: 8, w: 20, h: 0 });
  });
});

describe("unionBox", () => {
  it("covers every box", () => {
    expect(unionBox([{ x: 10, y: 20, w: 5, h: 5 }, { x: 2, y: 30, w: 4, h: 10 }, { x: 12, y: 1, w: 1, h: 1 }])).toEqual({ x: 2, y: 1, w: 13, h: 39 });
  });
  it("returns a single box unchanged and throws on an empty list", () => {
    expect(unionBox([{ x: 1, y: 2, w: 3, h: 4 }])).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(() => unionBox([])).toThrow();
  });
  it("does not leave floating point noise", () => {
    expect(unionBox([{ x: 0.1, y: 0.2, w: 0.2, h: 0.1 }])).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 });
  });
});

describe("translateElement", () => {
  it("returns a moved copy and leaves the original alone", () => {
    const t = el({ id: "t", type: "text", x: 3, y: 4, w: 20, h: 5, value: "A" });
    const moved = translateElement(t, 10, -2);
    expect(moved).toMatchObject({ id: "t", x: 13, y: 2, w: 20, h: 5, value: "A" });
    expect(t).toMatchObject({ x: 3, y: 4 });
    expect(moved).not.toBe(t);
  });
  it("moves both end points of a line", () => {
    const moved = translateElement(el({ id: "l", type: "line", x: 40, y: 30, w: 30, h: 10, x2: 10, y2: 20 }), -10, 5);
    expect(moved).toMatchObject({ x: 30, y: 35, x2: 0, y2: 25 });
  });
  it("moves a group by its own x/y only, keeping nested children (relative) untouched", () => {
    const g = el({ id: "g", type: "group", x: 10, y: 10, w: 30, h: 30, children: [
      { id: "l", type: "line", x: 1, y: 2, w: 0, h: 0, x2: 5, y2: 2 },
      { id: "inner", type: "group", x: 3, y: 3, w: 10, h: 10, children: [{ id: "r", type: "rect", x: 1, y: 1, w: 2, h: 2 }] },
    ]}) as Extract<Element, { type: "group" }>;
    const moved = translateElement(g, 5, 5) as typeof g;
    expect(moved).toMatchObject({ x: 15, y: 15 });
    expect(moved.children).toEqual(g.children);
    expect(moved.children).not.toBe(g.children);   // 깊은 복제본
  });
  it("keeps coordinates free of floating point noise", () => {
    expect(translateElement(el({ id: "r", type: "rect", x: 0.1, y: 0.7, w: 1, h: 1 }), 0.2, -0.1)).toMatchObject({ x: 0.3, y: 0.6 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core exec vitest run src/__tests__/ops-geometry.test.ts`
Expected: FAIL (`Failed to resolve import "../ops/geometry"`).

- [ ] **Step 3: 기하 구현**

`packages/core/src/ops/geometry.ts`:
```ts
import type { Element } from "../schema/elements";

export type Box = { x: number; y: number; w: number; h: number };

/** 좌표를 1e-6mm 단위로 반올림한다. 상대좌표로 옮겼다가 되돌려도(그룹화 → 해제) 부동소수 오차가 남지 않게 한다 */
const snap = (v: number) => Math.round(v * 1e6) / 1e6;

/** 요소의 경계 상자(요소가 들어 있는 배열 기준 좌표). 선은 두 끝점으로 만든다(x/y가 끝점보다 오른쪽·아래일 수 있다) */
export function elementBox(el: Element): Box {
  if (el.type === "line") {
    return { x: Math.min(el.x, el.x2), y: Math.min(el.y, el.y2), w: Math.abs(el.x2 - el.x), h: Math.abs(el.y2 - el.y) };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** 상자들을 모두 담는 가장 작은 상자. 빈 배열이면 던진다 */
export function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) throw new Error("unionBox: no boxes");
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: snap(x), y: snap(y), w: snap(right - x), h: snap(bottom - y) };
}

/**
 * 요소를 (dx, dy)만큼 옮긴 복제본. 선은 끝점(x2, y2)도 옮긴다.
 * 그룹·반복 영역의 자식은 부모 기준 상대좌표라 그대로 둔다(자기 x/y만 바뀐다)
 */
export function translateElement<T extends Element>(el: T, dx: number, dy: number): T {
  const copy = structuredClone(el);
  copy.x = snap(copy.x + dx);
  copy.y = snap(copy.y + dy);
  if (copy.type === "line") { copy.x2 = snap(copy.x2 + dx); copy.y2 = snap(copy.y2 + dy); }
  return copy;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core exec vitest run src/__tests__/ops-geometry.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: 컴포넌트 변환 실패 테스트 작성**

`packages/core/src/__tests__/ops-components.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, type Report } from "../schema/report";
import { ElementSchema, type Element } from "../schema/elements";
import type { ComponentBody } from "../schema/component";
import { refsTo, upgradeRefs, pruneComponents, extractComponent } from "../ops/components";

const page = { width: 210, height: 297 };
const hdrV1: ComponentBody = {
  name: "헤더", w: 180, h: 24,
  props: [{ name: "title", type: "string", default: "제목" }, { name: "showLogo", type: "boolean", default: true }],
  elements: [ElementSchema.parse({ id: "t", type: "text", x: 0, y: 0, w: 180, h: 10, value: "{{ props.title }}" })],
};
const hdrV2: ComponentBody = {
  name: "헤더", w: 180, h: 30,
  props: [{ name: "title", type: "string", default: "제목" }],
  elements: [ElementSchema.parse({ id: "t", type: "text", x: 0, y: 0, w: 180, h: 12, value: "{{ props.title }}" })],
};
const sign: ComponentBody = { name: "서명", w: 50, h: 20, props: [], elements: [ElementSchema.parse({ id: "s", type: "rect", x: 0, y: 0, w: 50, h: 20 })] };

function sample(): Report {
  return parseReport({ id: "r", page, components: { "hdr@1": hdrV1, "sign@1": sign, "sign@2": sign }, elements: [
    { id: "top", type: "ref", ref: "hdr", version: 1, x: 15, y: 10, w: 180, h: 24, props: { title: "{{ record.T }}", showLogo: false } },
    { id: "g", type: "group", x: 0, y: 100, w: 200, h: 50, children: [
      { id: "inner", type: "ref", ref: "hdr", version: 1, x: 5, y: 5, w: 180, h: 24, props: { showLogo: true } },
    ]},
    { id: "cards", type: "repeater", x: 0, y: 160, w: 200, h: 100, source: "rows", item: { w: 190, h: 30, children: [
      { id: "card-hdr", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 180, h: 24 },
    ]}},
    { id: "sig", type: "ref", ref: "sign", version: 1, x: 150, y: 270, w: 50, h: 20 },
  ]});
}

describe("refsTo", () => {
  it("finds refs to one component at the top level, inside groups and inside repeater templates, in document order", () => {
    expect(refsTo(sample(), "hdr").map((r) => r.id)).toEqual(["top", "inner", "card-hdr"]);
    expect(refsTo(sample(), "sign").map((r) => r.id)).toEqual(["sig"]);
    expect(refsTo(sample(), "none")).toEqual([]);
  });
});

describe("upgradeRefs", () => {
  it("rule 1: puts the new body under id@version", () => {
    const out = upgradeRefs(sample(), "hdr", 2, hdrV2);
    expect(out.components["hdr@2"]).toEqual(hdrV2);
    expect(out.components["hdr@2"]).not.toBe(hdrV2);   // 호출자의 내용과 공유하지 않는다
  });
  it("rule 2: moves every instance to the new version and size, keeps declared values and drops undeclared ones", () => {
    const out = upgradeRefs(sample(), "hdr", 2, hdrV2);
    const refs = refsTo(out, "hdr");
    expect(refs.map((r) => [r.id, r.version, r.w, r.h])).toEqual([["top", 2, 180, 30], ["inner", 2, 180, 30], ["card-hdr", 2, 180, 30]]);
    expect(refs[0].props).toEqual({ title: "{{ record.T }}" });   // showLogo는 v2 선언에 없다
    expect(refs[1].props).toEqual({});
    expect(refs[0]).toMatchObject({ x: 15, y: 10 });                // 위치는 그대로
  });
  it("rule 3: removes old versions of this component only, leaving other components' entries (even unused ones)", () => {
    const out = upgradeRefs(sample(), "hdr", 2, hdrV2);
    expect(Object.keys(out.components).sort()).toEqual(["hdr@2", "sign@1", "sign@2"]);
    expect(refsTo(out, "sign")[0]).toMatchObject({ version: 1, w: 50, h: 20 });
  });
  it("does not mutate the input report and the result passes the report schema", () => {
    const input = sample();
    const before = JSON.parse(JSON.stringify(input));
    const out = upgradeRefs(input, "hdr", 2, hdrV2);
    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
    expect(() => parseReport(JSON.parse(JSON.stringify(out)))).not.toThrow();
  });
  it("adds the body even when the report has no instance of the component", () => {
    const out = upgradeRefs(sample(), "fresh", 1, sign);
    expect(out.components["fresh@1"]).toEqual(sign);
    expect(out.elements).toEqual(sample().elements);
  });
});

describe("pruneComponents", () => {
  it("drops entries no ref points at, including refs inside groups and repeater templates", () => {
    const out = pruneComponents(sample());
    expect(Object.keys(out.components).sort()).toEqual(["hdr@1", "sign@1"]);
  });
  it("returns a new report without touching the input", () => {
    const input = sample();
    const out = pruneComponents(input);
    expect(out).not.toBe(input);
    expect(Object.keys(input.components).sort()).toEqual(["hdr@1", "sign@1", "sign@2"]);
  });
  it("empties components when there are no refs", () => {
    const r = parseReport({ id: "r", page, components: { "sign@1": sign }, elements: [{ id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 }] });
    expect(pruneComponents(r).components).toEqual({});
  });
});

describe("extractComponent", () => {
  const parent: Element[] = [
    ElementSchema.parse({ id: "title", type: "text", x: 20, y: 15, w: 100, h: 10, value: "품질보증서" }),
    ElementSchema.parse({ id: "other", type: "rect", x: 0, y: 200, w: 10, h: 10 }),
    ElementSchema.parse({ id: "rule", type: "line", x: 130, y: 30, w: 0, h: 0, x2: 10, y2: 30 }),
    ElementSchema.parse({ id: "logo-box", type: "group", x: 140, y: 10, w: 30, h: 15, children: [
      { id: "logo", type: "image", x: 1, y: 1, w: 28, h: 13, src: "asset://logo" },
    ]}),
  ];

  it("computes the bounding box using both line end points", () => {
    const { box } = extractComponent(parent, ["rule", "title", "logo-box"], "헤더");
    expect(box).toEqual({ x: 10, y: 10, w: 160, h: 20 });
  });
  it("copies the elements in parent order with coordinates relative to the box, line ends included, and no props", () => {
    const { body } = extractComponent(parent, ["rule", "title", "logo-box"], "헤더");
    expect(body).toMatchObject({ name: "헤더", w: 160, h: 20, props: [] });
    expect(body.elements.map((e) => e.id)).toEqual(["title", "rule", "logo-box"]);
    expect(body.elements[0]).toMatchObject({ x: 10, y: 5, w: 100, h: 10, value: "품질보증서" });
    expect(body.elements[1]).toMatchObject({ x: 120, y: 20, x2: 0, y2: 20 });
    expect(body.elements[2]).toMatchObject({ x: 130, y: 0 });
    // 그룹 자식은 그룹 기준 좌표라 그대로다
    expect((body.elements[2] as Extract<Element, { type: "group" }>).children[0]).toMatchObject({ x: 1, y: 1 });
  });
  it("does not change the parent array or its elements", () => {
    const before = JSON.parse(JSON.stringify(parent));
    const { body } = extractComponent(parent, ["title"], "제목");
    body.elements[0].x = 999;
    expect(JSON.parse(JSON.stringify(parent))).toEqual(before);
  });
  it("works for a single element (the box is the element itself)", () => {
    const { body, box } = extractComponent(parent, ["logo-box"], "로고");
    expect(box).toEqual({ x: 140, y: 10, w: 30, h: 15 });
    expect(body.elements[0]).toMatchObject({ x: 0, y: 0, w: 30, h: 15 });
  });
  it("throws when an id is not in the parent array (for example a group child)", () => {
    expect(() => extractComponent(parent, ["title", "logo"], "x")).toThrow(/logo/);
    expect(() => extractComponent(parent, [], "x")).toThrow();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm --filter @daport/core exec vitest run src/__tests__/ops-components.test.ts`
Expected: FAIL (`Failed to resolve import "../ops/components"`).

- [ ] **Step 7: 컴포넌트 변환 구현**

`packages/core/src/ops/components.ts`:
```ts
import type { Element } from "../schema/elements";
import type { Report } from "../schema/report";
import { walkElements } from "../schema/tree";
import { componentKey, COMPONENT_KEY_RE, type ComponentBody } from "../schema/component";
import { elementBox, unionBox, translateElement, type Box } from "./geometry";

type RefElement = Extract<Element, { type: "ref" }>;

/** 레포트 본문(그룹 안·반복 영역 템플릿 안 포함)에서 이 컴포넌트를 가리키는 ref를 문서 순서로 모은다. 버전은 가리지 않는다 */
export function refsTo(report: Report, componentId: string): RefElement[] {
  const out: RefElement[] = [];
  walkElements(report.elements, (el) => { if (el.type === "ref" && el.ref === componentId) out.push(el); });
  return out;
}

/**
 * 레포트 안의 이 컴포넌트 인스턴스를 모두 새 버전으로 올린다(스펙 7.2 규칙 1~3). 입력 레포트는 바꾸지 않는다.
 * 1. components[id@version] = body
 * 2. ref.version = version, ref.w/h = body.w/h, 새 선언에 없는 입력값 이름은 지운다(선언된 값은 그대로)
 * 3. 이 컴포넌트의 다른 버전 항목을 지운다(모든 인스턴스가 새 버전을 가리키므로 쓰이지 않는다). 다른 컴포넌트 항목은 건드리지 않는다
 * 스키마 검증(규칙 4)은 호출하는 쪽이 한다
 */
export function upgradeRefs(report: Report, componentId: string, version: number, body: ComponentBody): Report {
  const next = structuredClone(report);
  const content = structuredClone(body);
  const declared = new Set(content.props.map((p) => p.name));
  for (const ref of refsTo(next, componentId)) {
    ref.version = version;
    ref.w = content.w;
    ref.h = content.h;
    for (const name of Object.keys(ref.props)) if (!declared.has(name)) delete ref.props[name];
  }
  const components: Report["components"] = {};
  for (const [key, value] of Object.entries(next.components)) {
    const m = COMPONENT_KEY_RE.exec(key);
    if (m && m[1] === componentId) continue;
    components[key] = value;
  }
  components[componentKey(componentId, version)] = content;
  next.components = components;
  return next;
}

/** 본문의 어떤 ref도 가리키지 않는 components 항목을 지운 새 레포트. 요소 트리는 그대로 공유한다 */
export function pruneComponents(report: Report): Report {
  const used = new Set<string>();
  walkElements(report.elements, (el) => { if (el.type === "ref") used.add(componentKey(el.ref, el.version)); });
  const components: Report["components"] = {};
  for (const [key, value] of Object.entries(report.components)) if (used.has(key)) components[key] = value;
  return { ...report, components };
}

/**
 * 같은 부모 배열 안의 요소들로 컴포넌트 내용을 만든다(스펙 7.3 1~2). 선택 조건 검사는 sameParent가 한다.
 * box는 부모 기준 경계 상자(선은 두 끝점), body.elements는 box 기준 상대좌표로 옮긴 복제본(부모 배열 순서), props는 빈 배열
 */
export function extractComponent(parent: Element[], ids: string[], name: string): { body: ComponentBody; box: Box } {
  const wanted = new Set(ids);
  if (wanted.size === 0) throw new Error("extractComponent: no ids");
  const picked = parent.filter((el) => wanted.has(el.id));
  if (picked.length !== wanted.size) {
    const missing = [...wanted].filter((id) => !picked.some((el) => el.id === id));
    throw new Error(`elements not in parent: ${missing.join(", ")}`);
  }
  const box = unionBox(picked.map(elementBox));
  const elements = picked.map((el) => translateElement(el, -box.x, -box.y));
  return { body: { name, w: box.w, h: box.h, props: [], elements }, box };
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm --filter @daport/core exec vitest run src/__tests__/ops-components.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 9: 그룹 변환 실패 테스트 작성**

`packages/core/src/__tests__/ops-group.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ElementSchema, type Element } from "../schema/elements";
import { sameParent, groupElements, ungroupElement } from "../ops/group";

type Group = Extract<Element, { type: "group" }>;
type Repeater = Extract<Element, { type: "repeater" }>;
const parse = (list: unknown[]): Element[] => list.map((e) => ElementSchema.parse(e));

function tree(): Element[] {
  return parse([
    { id: "a", type: "text", x: 10.3, y: 10.1, w: 20, h: 5, value: "A" },
    { id: "b", type: "rect", x: 40, y: 12.7, w: 10, h: 10 },
    { id: "l", type: "line", x: 60, y: 30, w: 0, h: 0, x2: 45, y2: 30 },
    { id: "g", type: "group", x: 100, y: 100, w: 50, h: 50, children: [
      { id: "g1", type: "rect", x: 1, y: 1, w: 5, h: 5 },
      { id: "g2", type: "text", x: 10, y: 10, w: 5, h: 5 },
    ]},
    { id: "hdr", type: "ref", ref: "hdr", version: 1, x: 0, y: 200, w: 30, h: 10 },
    { id: "cards", type: "repeater", x: 0, y: 220, w: 200, h: 60, source: "rows", item: { w: 90, h: 20, children: [
      { id: "c1", type: "text", x: 1, y: 1, w: 10, h: 5 },
      { id: "c2", type: "text", x: 20, y: 1, w: 10, h: 5 },
    ]}},
  ]);
}
const allow = { allowInTemplate: true, allowRefs: true };
const strict = { allowInTemplate: false, allowRefs: false };

describe("sameParent", () => {
  it("returns the real parent array and sorted indices for top-level siblings", () => {
    const els = tree();
    const info = sameParent(els, ["l", "a"], strict);
    expect(info).toEqual({ parent: els, indices: [0, 2] });
    if ("parent" in info) expect(info.parent).toBe(els);
  });
  it("accepts children of the same group and a single element", () => {
    const els = tree();
    const info = sameParent(els, ["g2", "g1"], strict);
    expect("parent" in info && info.parent).toBe((els[3] as Group).children);
    expect("parent" in info && info.indices).toEqual([0, 1]);
    expect(sameParent(els, ["g"], strict)).toEqual({ parent: els, indices: [3] });
  });
  it("rejects an empty selection, unknown ids and mixed parents with Korean reasons", () => {
    const els = tree();
    expect(sameParent(els, [], allow)).toEqual({ error: "선택한 요소가 없습니다" });
    expect(sameParent(els, ["a", "zz"], allow)).toEqual({ error: "요소를 찾을 수 없습니다: zz" });
    expect(sameParent(els, ["a", "g1"], allow)).toEqual({ error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" });
    expect(sameParent(els, ["g", "g1"], allow)).toEqual({ error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" });
  });
  it("allowInTemplate controls repeater template children", () => {
    const els = tree();
    expect(sameParent(els, ["c1", "c2"], strict)).toEqual({ error: "반복 영역 템플릿 안의 요소는 컴포넌트로 만들 수 없습니다" });
    const info = sameParent(els, ["c1", "c2"], allow);
    expect("parent" in info && info.parent).toBe((els[5] as Repeater).item.children);
    expect(sameParent(els, ["cards"], strict)).toEqual({ parent: els, indices: [5] });   // 반복 영역 자체는 템플릿 안이 아니다
  });
  it("allowRefs controls refs in the selection and inside selected groups", () => {
    const els = parse([...tree(), { id: "wrap", type: "group", x: 0, y: 0, w: 30, h: 10, children: [
      { id: "inner-ref", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 30, h: 10 },
    ]}]);
    const reason = { error: "컴포넌트 인스턴스는 다른 컴포넌트에 넣을 수 없습니다" };
    expect(sameParent(els, ["a", "hdr"], strict)).toEqual(reason);
    expect(sameParent(els, ["wrap"], strict)).toEqual(reason);
    expect(sameParent(els, ["a", "hdr"], allow)).toEqual({ parent: els, indices: [0, 4] });
  });
  it("ignores duplicate ids", () => {
    const els = tree();
    expect(sameParent(els, ["a", "a", "b"], strict)).toEqual({ parent: els, indices: [0, 1] });
  });
});

describe("groupElements", () => {
  it("wraps the selection in a group at the first selected index, with the bounding box (line end points) and relative children", () => {
    const els = tree();
    const out = groupElements(els, ["l", "b"], "group-1");
    expect(out.map((e) => e.id)).toEqual(["a", "group-1", "g", "hdr", "cards"]);
    const g = out[1] as Group;
    expect(g).toMatchObject({ type: "group", x: 40, y: 12.7, w: 20, h: 17.3, flow: "once" });
    expect(g.visible).toBeUndefined();
    expect(g.children.map((c) => c.id)).toEqual(["b", "l"]);             // 부모 배열 순서
    expect(g.children[0]).toMatchObject({ x: 0, y: 0, w: 10, h: 10 });
    expect(g.children[1]).toMatchObject({ x: 20, y: 17.3, x2: 5, y2: 17.3 });
    expect(() => ElementSchema.parse(g)).not.toThrow();
  });
  it("uses document order, not selection order, to place the group", () => {
    const out = groupElements(tree(), ["hdr", "a"], "group-1");
    expect(out.map((e) => e.id)).toEqual(["group-1", "b", "l", "g", "cards"]);
    expect((out[0] as Group).children.map((c) => c.id)).toEqual(["a", "hdr"]);
  });
  it("groups inside a group's children and keeps nested groups' own children untouched", () => {
    const els = tree();
    const inner = (els[3] as Group).children;
    const out = groupElements(parse([...inner, { id: "n", type: "group", x: 20, y: 20, w: 10, h: 10, children: [{ id: "n1", type: "rect", x: 2, y: 2, w: 1, h: 1 }] }]), ["g2", "n"], "group-1");
    const g = out[1] as Group;
    expect(g).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
    expect((g.children[1] as Group).children[0]).toMatchObject({ x: 2, y: 2 });
  });
  it("does not modify the input array or elements and throws for ids outside the array", () => {
    const els = tree();
    const before = JSON.parse(JSON.stringify(els));
    groupElements(els, ["a", "b"], "group-1");
    expect(JSON.parse(JSON.stringify(els))).toEqual(before);
    expect(() => groupElements(els, ["a", "g1"], "group-1")).toThrow();
  });
});

describe("ungroupElement", () => {
  it("puts the children back in place, in order, with parent coordinates (line end points too)", () => {
    const els = parse([
      { id: "x", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "g", type: "group", x: 100, y: 50, w: 50, h: 50, children: [
        { id: "l", type: "line", x: 10, y: 5, w: 0, h: 0, x2: 0, y2: 5 },
        { id: "t", type: "text", x: 1, y: 2, w: 5, h: 5 },
      ]},
      { id: "z", type: "rect", x: 0, y: 0, w: 1, h: 1 },
    ]);
    const out = ungroupElement(els, "g");
    expect(out.map((e) => e.id)).toEqual(["x", "l", "t", "z"]);
    expect(out[1]).toMatchObject({ x: 110, y: 55, x2: 100, y2: 55 });
    expect(out[2]).toMatchObject({ x: 101, y: 52 });
    expect((els[1] as Group).children[1]).toMatchObject({ x: 1, y: 2 });   // 입력은 그대로
  });
  it("refuses a group with a visible condition and ids that are not groups in the array", () => {
    const els = parse([{ id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, visible: "{{ params.show }}", children: [] }, { id: "r", type: "rect", x: 0, y: 0, w: 1, h: 1 }]);
    expect(() => ungroupElement(els, "g")).toThrow("group has visible");
    expect(() => ungroupElement(els, "r")).toThrow();
    expect(() => ungroupElement(els, "nope")).toThrow();
  });
  it("round-trips: grouping contiguous siblings then ungrouping gives the original tree", () => {
    const els = tree();
    const grouped = groupElements(els, ["a", "b", "l"], "group-1");
    expect(ungroupElement(grouped, "group-1")).toEqual(els);
    const inner = (els[3] as Group).children;
    expect(ungroupElement(groupElements(inner, ["g1", "g2"], "group-2"), "group-2")).toEqual(inner);
    const cards = (els[5] as Repeater).item.children;
    expect(ungroupElement(groupElements(cards, ["c1", "c2"], "group-3"), "group-3")).toEqual(cards);
  });
  it("round-trips non-contiguous siblings except that they end up adjacent at the first position", () => {
    const els = tree();
    const out = ungroupElement(groupElements(els, ["a", "l"], "group-1"), "group-1");
    expect(out.map((e) => e.id)).toEqual(["a", "l", "b", "g", "hdr", "cards"]);
    expect(out[0]).toEqual(els[0]);
    expect(out[1]).toEqual(els[2]);
  });
});

describe("package entry", () => {
  it("exports geometry, component and group ops", async () => {
    const core = await import("../index");
    for (const name of ["elementBox", "unionBox", "translateElement", "refsTo", "upgradeRefs", "pruneComponents", "extractComponent", "sameParent", "groupElements", "ungroupElement"]) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
```

- [ ] **Step 10: 실패 확인**

Run: `pnpm --filter @daport/core exec vitest run src/__tests__/ops-group.test.ts`
Expected: FAIL (`Failed to resolve import "../ops/group"`).

- [ ] **Step 11: 그룹 변환 구현과 재export**

`packages/core/src/ops/group.ts`:
```ts
import { ElementSchema, type Element, type GroupElement } from "../schema/elements";
import { walkElements } from "../schema/tree";
import { elementBox, unionBox, translateElement } from "./geometry";

export type ParentInfo = { parent: Element[]; indices: number[] } | { error: string };

/**
 * 선택한 요소들이 모두 같은 부모 배열(최상위, 같은 그룹의 children, 같은 반복 영역 밴드)에 있는지 본다(스펙 7.3·7.4).
 * 성공하면 그 배열(elements 트리 안의 실제 배열 참조)과 요소 위치(오름차순)를 돌려준다. 실패하면 사용자에게 보일 사유.
 * allowInTemplate=false면 반복 영역 템플릿·밴드 안의 요소를 막고, allowRefs=false면 선택 요소나 그 자손에 ref가 있으면 막는다
 */
export function sameParent(elements: Element[], ids: string[], opts: { allowInTemplate: boolean; allowRefs: boolean }): ParentInfo {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return { error: "선택한 요소가 없습니다" };
  const found = new Map<string, { el: Element; parent: Element[]; index: number; ancestors: Element[] }>();
  walkElements(elements, (el, parent, index, ancestors) => {
    if (wanted.includes(el.id) && !found.has(el.id)) found.set(el.id, { el, parent, index, ancestors });
  });
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length) return { error: `요소를 찾을 수 없습니다: ${missing.join(", ")}` };
  const hits = wanted.map((id) => found.get(id)!);
  const parent = hits[0].parent;
  if (hits.some((h) => h.parent !== parent)) return { error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" };
  if (!opts.allowInTemplate && hits[0].ancestors.some((a) => a.type === "repeater")) {
    return { error: "반복 영역 템플릿 안의 요소는 컴포넌트로 만들 수 없습니다" };
  }
  if (!opts.allowRefs && walkElements(hits.map((h) => h.el), (el) => el.type === "ref")) {
    return { error: "컴포넌트 인스턴스는 다른 컴포넌트에 넣을 수 없습니다" };
  }
  return { parent, indices: hits.map((h) => h.index).sort((a, b) => a - b) };
}

/**
 * 부모 배열의 요소들을 group 하나로 묶은 새 배열(스펙 7.4). 그룹 x/y/w/h는 경계 상자(선은 두 끝점), 자식은 상자 기준 상대좌표로
 * 부모 배열 순서를 유지하고, 그룹은 첫 선택 요소(문서 순서) 자리에 들어간다. 입력 배열과 요소는 바꾸지 않는다
 */
export function groupElements(parent: Element[], ids: string[], groupId: string): Element[] {
  const wanted = new Set(ids);
  const picked = parent.filter((el) => wanted.has(el.id));
  if (wanted.size === 0 || picked.length !== wanted.size) throw new Error(`groupElements: ids not in parent: ${ids.join(", ")}`);
  const box = unionBox(picked.map(elementBox));
  const group = ElementSchema.parse({ id: groupId, type: "group", x: box.x, y: box.y, w: box.w, h: box.h, children: [] }) as GroupElement;
  group.children = picked.map((el) => translateElement(el, -box.x, -box.y));
  const out: Element[] = [];
  let placed = false;
  for (const el of parent) {
    if (!wanted.has(el.id)) { out.push(el); continue; }
    if (!placed) { out.push(group); placed = true; }
  }
  return out;
}

/**
 * 그룹을 풀어 자식을 그룹 자리에 순서대로 넣은 새 배열(스펙 7.4). 자식 좌표는 부모 기준으로 되돌린다.
 * 그룹에 visible이 있으면 풀면 조건이 사라지므로 던진다. 입력 배열과 요소는 바꾸지 않는다
 */
export function ungroupElement(parent: Element[], groupId: string): Element[] {
  const index = parent.findIndex((el) => el.id === groupId);
  const group = parent[index];
  if (!group || group.type !== "group") throw new Error(`group not found: ${groupId}`);
  if (group.visible !== undefined) throw new Error("group has visible");
  const children = group.children.map((c) => translateElement(c, group.x, group.y));
  return [...parent.slice(0, index), ...children, ...parent.slice(index + 1)];
}
```

`packages/core/src/index.ts` 끝에 추가:
```ts
export * from "./ops/geometry";
export * from "./ops/components";
export * from "./ops/group";
```

- [ ] **Step 12: 통과 확인**

Run: `pnpm --filter @daport/core exec vitest run src/__tests__/ops-group.test.ts`
Expected: PASS (15 tests).

Run: `pnpm --filter @daport/core test`
Expected: 전체 통과(기존 테스트 포함).

- [ ] **Step 13: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/ops packages/core/src/index.ts packages/core/src/__tests__/ops-geometry.test.ts packages/core/src/__tests__/ops-components.test.ts packages/core/src/__tests__/ops-group.test.ts
git commit -m "$(cat <<'EOF'
feat(core): 경계 상자·컴포넌트 추출·인스턴스 업그레이드·그룹화 순수 함수

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: renderer ref 펼치기, props 컨텍스트, id 규칙

**Files:**
- Create: `packages/renderer/src/layout/props.ts`
- Modify: `packages/renderer/src/layout/flatten.ts` (components 옵션, ref 펼치기, `RefOwner`, `refFlow`, `missing`)
- Modify: `packages/renderer/src/layout/place.ts` (`ref` 케이스는 내용 없음 #ERR, `refBoxItem()`·`ownedInstance()`·`refErrorItem()`·`ownItems()` 추가)
- Modify: `packages/renderer/src/layout/layout.ts` (`report.components` 전달, `refFlow`, owner 컨텍스트, id 규칙, refBox, `#ERR`)
- Modify: `packages/renderer/src/layout/types.ts` (role에 `"refBox"`)
- Modify: `packages/renderer/src/flow/types.ts` (`FlowOptions.components`)
- Modify: `packages/renderer/src/flow/children.ts` (flatten에 components 전달, owner 컨텍스트·id 규칙)
- Modify: `packages/renderer/src/__tests__/layout.test.ts`, `packages/renderer/src/__tests__/place.test.ts` (Task 1이 `version`·`components`를 더해 둔 ref 자리표시 기대값 제거: 이제 ref는 펼쳐진다)
- Test: `packages/renderer/src/__tests__/components.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (펼치기)**

`packages/renderer/src/__tests__/components.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, type ComponentBody } from "@daport/core";
import { flatten } from "../layout/flatten";
import { layout } from "../layout/layout";
import { resolveRefProps, withProps } from "../layout/props";

const page = { width: 100, height: 100, margin: [5, 5, 5, 5] as [number, number, number, number] };
const hdr: ComponentBody = { name: "헤더", w: 60, h: 20, props: [
  { name: "title", type: "string", default: "기본 제목" },
  { name: "show", type: "boolean", default: true },
], elements: [
  { id: "box", type: "group", x: 2, y: 3, w: 50, h: 15, visible: "{{ props.show }}", children: [
    { id: "logo", type: "text", x: 1, y: 1, w: 40, h: 6, value: "{{ props.title }}", flow: "every" },
  ] },
  { id: "rule", type: "line", x: 0, y: 19, w: 60, h: 0, x2: 60, y2: 19 },
] as unknown as ComponentBody["elements"] };
const std: ComponentBody = { name: "표", w: 80, h: 30, props: [{ name: "label", type: "string", default: "" }], elements: [
  { id: "cap", type: "text", x: 0, y: 0, w: 80, h: 6, value: "{{ props.label }}" },
  { id: "t", type: "table", x: 0, y: 6, w: 80, h: 24, source: "items", columns: [{ header: "N", value: "{{ props.label }}{{ row.N }}", w: 40 }] },
] as unknown as ComponentBody["elements"] };
const components = { "hdr@1": hdr, "std@2": std };
const ref = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "ref", ref: "hdr", version: 1, x: 10, y: 20, w: 60, h: 20, ...extra });
const mk = (elements: unknown[], extra: Record<string, unknown> = {}) => parseReport({ id: "r", version: 1, page, components, elements, ...extra });
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ N: i }));
const lines = (item: unknown) => (item as { lines: string[] }).lines.join("");

describe("flatten: ref", () => {
  it("expands a ref like a group: offsets (line x2/y2 too), owner with path, refFlow, visible chain", () => {
    const r = mk([ref("h1", { visible: "{{ params.on }}", flow: "every", props: { title: "A", extra: 1 } })]);
    const flat = flatten(r.elements, 0, 0, [], { components: r.components });
    expect(flat.map((e) => e.id)).toEqual(["logo", "rule"]);
    expect(flat[0]).toMatchObject({ x: 13, y: 24, refFlow: "every", ancestorsVisible: ["{{ params.on }}", "{{ props.show }}"] });
    expect(flat[1]).toMatchObject({ x: 10, y: 39, x2: 70, y2: 39, refFlow: "every", ancestorsVisible: ["{{ params.on }}"] });
    expect(flat[0].owner).toEqual({ refId: "h1", path: "box/logo", box: { x: 10, y: 20, w: 60, h: 20 }, decls: hdr.props, values: { title: "A", extra: 1 } });
    expect(flat[1].owner?.path).toBe("rule");
  });
  it("keeps the ref (missing: true) when the component is not in the map", () => {
    const r = mk([ref("h1")]);
    const flat = flatten(r.elements, 5, 5, [], { components: {} });
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ id: "h1", type: "ref", missing: true, x: 15, y: 25 });
  });
  it("expands a ref inside a group with the group offset and visible", () => {
    const r = mk([{ id: "g", type: "group", x: 1, y: 2, w: 90, h: 50, visible: "{{ params.g }}", children: [ref("h1", { x: 0, y: 0 })] }]);
    const flat = flatten(r.elements, 0, 0, [], { components: r.components });
    expect(flat[0]).toMatchObject({ id: "logo", x: 4, y: 6, ancestorsVisible: ["{{ params.g }}", "{{ props.show }}"] });
    expect(flat[0].owner?.refId).toBe("h1");
  });
});

describe("props context", () => {
  const owner = { refId: "h1", path: "box/logo", box: { x: 0, y: 0, w: 60, h: 20 }, decls: hdr.props, values: { title: "{{ record.T }} {{ page }}", show: "{{ params.on }}", nope: "x" } as Record<string, string | number | boolean> };
  it("resolveRefProps: defaults + evaluated values keeping whole-template types, undeclared names dropped", () => {
    expect(resolveRefProps(owner, { params: { on: false }, record: { T: "보증서" }, page: 2 })).toEqual({ title: "보증서 2", show: false });
    expect(resolveRefProps({ ...owner, values: {} }, { params: {} })).toEqual({ title: "기본 제목", show: true });
    expect(resolveRefProps({ ...owner, values: { title: 7 } }, { params: {} })).toEqual({ title: 7, show: true });
  });
  it("resolveRefProps throws ExpressionError for a bad template", () => {
    expect(() => resolveRefProps({ ...owner, values: { title: "{{ record. }}" } }, { params: {} })).toThrow(/Expression error/);
  });
  it("withProps: returns ctx without owner, caches per refId|page|copy", () => {
    const ctx = { params: { on: true }, record: { T: "A" }, page: 1, copy: 1 };
    expect(withProps(ctx, undefined, new Map())).toBe(ctx);
    const cache = new Map<string, Record<string, unknown>>();
    const a = withProps(ctx, owner, cache);
    expect(a.props).toEqual({ title: "A 1", show: true });
    expect(a.params).toBe(ctx.params);
    expect(withProps({ ...ctx, record: { T: "B" } }, owner, cache).props).toBe(a.props);   // 같은 페이지·부: 캐시
    expect(withProps({ ...ctx, page: 2 }, owner, cache).props).toEqual({ title: "A 2", show: true });
    expect([...cache.keys()]).toEqual(["h1|1|1", "h1|2|1"]);
  });
});

describe("layout: component instances", () => {
  const t = { id: "t", type: "table", x: 5, y: 80, w: 60, h: 15, source: "items", columns: [{ header: "N", value: "{{ row.N }}", w: 30 }] };
  const noCells = (items: { role?: string }[]) => items.filter((i) => i.role !== "cell" && i.role !== "border" && i.role !== "flowBox");
  it("elementId = ref id, instance = refId/path, refBox first, ref.flow decides pages (inner flow ignored), props per instance", () => {
    const r = mk([ref("h1", { props: { title: "첫째" } }), ref("h2", { y: 50, flow: "every", props: { title: "{{ params.name }}-{{ page }}" } }), t]);
    const pages = layout(r, { params: { name: "N" }, items: rows(2) });
    expect(pages).toHaveLength(2);
    expect(noCells(pages[0].items).map((i) => [i.kind, i.role, i.elementId, i.instance])).toEqual([
      ["rect", "refBox", "h1", undefined], ["text", undefined, "h1", "h1/box/logo"], ["line", undefined, "h1", "h1/rule"],
      ["rect", "refBox", "h2", undefined], ["text", undefined, "h2", "h2/box/logo"], ["line", undefined, "h2", "h2/rule"],
    ]);
    expect(pages[0].items[0]).toMatchObject({ x: 10, y: 20, w: 60, h: 20 });
    expect(pages[0].items[1]).toMatchObject({ x: 13, y: 24, lines: ["첫째"] });
    expect(lines(pages[0].items[4])).toBe("N-1");
    expect(noCells(pages[1].items).map((i) => [i.elementId, i.instance])).toEqual([["h2", undefined], ["h2", "h2/box/logo"], ["h2", "h2/rule"]]);
    expect(lines(pages[1].items[1])).toBe("N-2");
    for (const p of pages) {
      const keys = p.items.filter((i) => i.role === undefined || i.role === "refBox").map((i) => `${i.elementId}|${i.instance}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
  it("uses defaults, ignores undeclared values and applies props-based visibility", () => {
    const r = mk([ref("h1", { props: { show: false, nope: "x" } }), ref("h2", { y: 50 })]);
    const items = layout(r, { params: {} })[0].items;
    expect(items.map((i) => i.instance)).toEqual([undefined, "h1/rule", undefined, "h2/box/logo", "h2/rule"]);
    expect(lines(items[3])).toBe("기본 제목");
  });
  it("ref.visible hides the whole instance's children", () => {
    const r = mk([ref("h1", { visible: "{{ params.on }}" })]);
    expect(layout(r, { params: { on: false } })[0].items.map((i) => i.role)).toEqual(["refBox"]);
    expect(layout(r, { params: { on: true } })[0].items).toHaveLength(3);
  });
  it("a missing component becomes one #ERR at the ref box", () => {
    const r = mk([ref("h1")]);
    const items = layout({ ...r, components: {} }, { params: {} })[0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "text", elementId: "h1", x: 10, y: 20, w: 60, h: 20, lines: ["#ERR"], error: "component hdr@1 not found" });
  });
  it("a props evaluation error draws no children and one #ERR at the ref box; fail mode throws", () => {
    const bad = mk([ref("h1", { props: { title: "{{ params. }}" } }), ref("h2", { y: 50 })]);
    const items = layout(bad, { params: {} })[0].items;
    expect(items.map((i) => [i.elementId, i.instance, i.role])).toEqual([["h1", undefined, undefined], ["h2", undefined, "refBox"], ["h2", "h2/box/logo", undefined], ["h2", "h2/rule", undefined]]);
    expect(items[0]).toMatchObject({ x: 10, y: 20, w: 60, h: 20, lines: ["#ERR"], error: expect.stringContaining("Expression error") });
    expect(() => layout(mk([ref("h1", { props: { title: "{{ params. }}" } })], { onExpressionError: "fail" }), { params: {} })).toThrow(/Expression error/);
  });
});

describe("layout: flow elements inside a component", () => {
  const sref = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "ref", ref: "std", version: 2, x: 10, y: 30, w: 80, h: 30, ...extra });
  it("a continue table in a component splits pages with the instance prefix, props in cells, flowBox owned by the ref", () => {
    const pages = layout(mk([sref("s1", { props: { label: "L" } })]), { params: {}, items: rows(10) });
    expect(pages).toHaveLength(2);                                            // 첫 영역 24mm: 머리 7 + 2행, 다음 영역 95-36=59mm: 머리 + 8행
    const cells = (i: number) => pages[i].items.filter((it) => it.role === "cell");
    expect(cells(0).map((c) => c.instance)).toEqual(["s1/t/t#h", "s1/t/t#0", "s1/t/t#1"]);
    expect(cells(1).map((c) => c.instance)).toEqual(["s1/t/t#h", ...Array.from({ length: 8 }, (_, k) => `s1/t/t#${k + 2}`)]);
    expect(pages.flatMap((p) => p.items).every((it) => it.elementId === "s1")).toBe(true);
    expect(lines(cells(0)[1])).toBe("L0");
    expect(pages[0].items.slice(0, 3).map((i) => [i.role, i.instance])).toEqual([["refBox", undefined], [undefined, "s1/cap"], ["flowBox", "s1/t"]]);
    expect(pages[0].items[2]).toMatchObject({ x: 10, y: 36, w: 80, h: 24 });
    expect(pages[1].items.slice(0, 2).map((i) => [i.role, i.instance])).toEqual([["refBox", undefined], ["flowBox", "s1/t"]]);   // cap은 ref.flow once
  });
  it("the same component twice keeps (elementId, instance) unique and props separate", () => {
    const pages = layout(mk([sref("s1", { props: { label: "A" } }), sref("s2", { x: 10, y: 62, h: 30, props: { label: "B" } })]), { params: {}, items: rows(1) });
    expect(pages).toHaveLength(1);
    const items = pages[0].items;
    const keys = items.filter((i) => i.role !== "border").map((i) => `${i.elementId}|${i.instance}|${i.role}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.filter((i) => i.role === "cell" && i.instance?.endsWith("t#0")).map((i) => [i.elementId, lines(i)])).toEqual([["s1", "A0"], ["s2", "B0"]]);
  });
  it("a props error on a component with a continue table gives one #ERR on the first page only", () => {
    const pages = layout(mk([sref("s1", { props: { label: "{{ params. }}" } })]), { params: {}, items: rows(10) });
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(1);
    expect(pages[0].items[0]).toMatchObject({ elementId: "s1", x: 10, y: 30, w: 80, h: 30, lines: ["#ERR"] });
  });
});

describe("repeater templates and bands with refs", () => {
  it("expands refs in item templates with the instance after the item path and props from the item", () => {
    const r = mk([{ id: "cards", type: "repeater", x: 5, y: 5, w: 90, h: 90, source: "lots",
      item: { w: 90, h: 25, children: [ref("hd", { x: 0, y: 0, props: { title: "{{ item.NAME }}" } })] },
      groups: [{ by: "item.G", header: { h: 22, children: [ref("gh", { x: 0, y: 1, props: { title: "G{{ group.key }}" } })] } }] }]);
    const items = layout(r, { params: {}, lots: [{ NAME: "L1", G: 1 }, { NAME: "L2", G: 1 }] })[0].items;
    const own = items.filter((i) => i.elementId === "hd" || i.elementId === "gh");
    expect(own.map((i) => [i.elementId, i.role, i.instance])).toEqual([
      ["gh", "refBox", "cards#g0h0"], ["gh", undefined, "cards#g0h0/gh/box/logo"], ["gh", undefined, "cards#g0h0/gh/rule"],
      ["hd", "refBox", "cards#0"], ["hd", undefined, "cards#0/hd/box/logo"], ["hd", undefined, "cards#0/hd/rule"],
      ["hd", "refBox", "cards#1"], ["hd", undefined, "cards#1/hd/box/logo"], ["hd", undefined, "cards#1/hd/rule"],
    ]);
    expect(own.filter((i) => i.kind === "text").map(lines)).toEqual(["G1", "L1", "L2"]);
    expect(own.find((i) => i.instance === "cards#1")).toMatchObject({ x: 5, y: 52, w: 60, h: 20 });   // 5 + 머리 22 + 항목 25
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/renderer && pnpm exec vitest run src/__tests__/components.test.ts`
Expected: FAIL (`../layout/props`를 찾지 못함, `flatten`이 ref를 펼치지 않음).

- [ ] **Step 3: 타입 확장**

`packages/renderer/src/layout/types.ts`의 `role` 줄과 주석을 바꾼다:
```ts
  /** flowBox: 표·반복 영역 전체 영역(선택·히트용). cell: 표 셀 텍스트. border: 표 테두리. template: 반복 영역 첫 항목 자리. refBox: 컴포넌트 인스턴스 상자(선택·히트용) */
  role?: "flowBox" | "cell" | "border" | "template" | "refBox";
```

`packages/renderer/src/flow/types.ts`의 import와 `FlowOptions`를 바꾼다:
```ts
import type { ComponentBody } from "@daport/core";
import type { PlacedItem } from "../layout/types";
import type { MeasureCache } from "../text/cache";
// ... (Region·BlockKind·PageFlowContext·Block·FlowInput·FlowPlacement·FlowPage는 그대로)
/** components: 레포트가 품은 컴포넌트 내용. 반복 영역 항목·밴드의 ref를 펼칠 때 쓴다 */
export type FlowOptions = { measure: MeasureCache; onExpressionError: "blank" | "fail"; instancePrefix?: string; components?: Record<string, ComponentBody> };
```

- [ ] **Step 4: flatten 구현**

`packages/renderer/src/layout/flatten.ts` 전체:
```ts
import { componentKey, type ComponentBody, type ComponentProp, type Element } from "@daport/core";

/**
 * 컴포넌트 인스턴스 정보. path는 컴포넌트 트리 안의 요소 id 경로("logo", 그룹 안이면 "box/logo").
 * box는 ref 상자의 페이지 절대좌표(refBox 항목과 인스턴스 #ERR 자리)
 */
export type RefOwner = {
  refId: string; path: string; box: { x: number; y: number; w: number; h: number };
  decls: ComponentProp[]; values: Record<string, string | number | boolean>;
};
type FlatBase = { ancestorsVisible: string[]; owner?: RefOwner; refFlow?: "once" | "every" | "last" };
/** 평탄화된 요소. ancestorsVisible은 바깥부터 모은 조상 그룹·ref의 visible 표현식. 내용을 못 찾은 ref만 missing으로 남는다 */
export type FlatElement = (Exclude<Element, { type: "group" | "ref" }> & FlatBase)
  | (Extract<Element, { type: "ref" }> & FlatBase & { missing: true });
export type FlattenOptions = { components?: Record<string, ComponentBody>; owner?: RefOwner; refFlow?: "once" | "every" | "last" };

/**
 * 그룹과 ref를 풀어 모든 요소를 페이지 절대좌표로 만든다. 순서는 문서 순서 유지.
 * 그룹·ref의 visible은 평가하지 않고 자손에게 넘긴다(순수 함수 유지).
 * ref는 components["<ref>@<version>"]의 elements를 그룹처럼 펼치고 자식마다 owner·refFlow를 붙인다(스펙 5.1).
 * 내용이 없거나 이미 컴포넌트 안(중첩, 스키마가 막는다)이면 펼치지 않고 missing ref 하나로 남긴다
 */
export function flatten(elements: Element[], dx = 0, dy = 0, ancestorsVisible: string[] = [], opts: FlattenOptions = {}): FlatElement[] {
  return walk(elements, dx, dy, ancestorsVisible, opts, "");
}

function walk(elements: Element[], dx: number, dy: number, chain: string[], opts: FlattenOptions, prefix: string): FlatElement[] {
  const out: FlatElement[] = [];
  const tag = <T extends object>(o: T): T => {
    if (opts.owner) Object.assign(o, { owner: opts.owner, refFlow: opts.refFlow });
    return o;
  };
  for (const el of elements) {
    const next = el.visible === undefined ? chain : [...chain, el.visible];
    if (el.type === "group") {
      out.push(...walk(el.children, dx + el.x, dy + el.y, next, opts, `${prefix}${el.id}/`));
      continue;
    }
    if (el.type === "ref") {
      const body = opts.owner ? undefined : opts.components?.[componentKey(el.ref, el.version)];
      if (!body) {
        out.push(tag({ ...el, x: el.x + dx, y: el.y + dy, ancestorsVisible: chain, missing: true as const }));
        continue;
      }
      const x = el.x + dx, y = el.y + dy;
      const base: RefOwner = { refId: el.id, path: "", box: { x, y, w: el.w, h: el.h }, decls: body.props, values: el.props };
      out.push(...walkOwned(body.elements, x, y, next, { components: opts.components, owner: base, refFlow: el.flow }));
      continue;
    }
    const moved = tag({ ...el, x: el.x + dx, y: el.y + dy, ancestorsVisible: chain } as FlatElement);
    if (moved.type === "line") { moved.x2 += dx; moved.y2 += dy; }
    if (opts.owner) moved.owner = { ...opts.owner, path: `${prefix}${el.id}` };
    out.push(moved);
  }
  return out;
}

/** 컴포넌트 내용 트리. path는 컴포넌트 루트부터 다시 센다 */
function walkOwned(elements: Element[], dx: number, dy: number, chain: string[], opts: FlattenOptions): FlatElement[] {
  return walk(elements, dx, dy, chain, opts, "");
}
```

- [ ] **Step 5: 입력값 컨텍스트 구현**

`packages/renderer/src/layout/props.ts`:
```ts
import { evaluateTemplateValue, type DataContext } from "@daport/core";
import type { RefOwner } from "./flatten";

/**
 * 인스턴스 입력값 (스펙 5.2): 선언 기본값 위에 인스턴스 값을 덮는다. 문자열 값은 템플릿으로 평가하고(값 전체가 {{ }} 하나면 원래 타입),
 * 선언에 없는 이름은 버린다. ExpressionError는 그대로 던진다(호출자가 인스턴스 #ERR로 바꾼다)
 */
export function resolveRefProps(owner: RefOwner, ctx: DataContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of owner.decls) {
    const v = Object.prototype.hasOwnProperty.call(owner.values, d.name) ? owner.values[d.name] : undefined;
    out[d.name] = v === undefined ? d.default : typeof v === "string" ? evaluateTemplateValue(v, ctx) : v;
  }
  return out;
}

/**
 * owner가 있으면 ctx에 props를 더한 새 컨텍스트. 같은 인스턴스는 페이지·부마다 한 번만 평가한다(키 `${refId}|${page}|${copy}`).
 * 캐시는 호출자가 범위를 정한다: layout 2단계는 layout 호출 하나, 1단계(조각 생성)는 부마다, 반복 영역 자식은 항목 칠하기마다 새로 만든다
 */
export function withProps(ctx: DataContext, owner: RefOwner | undefined, cache: Map<string, Record<string, unknown>>): DataContext {
  if (!owner) return ctx;
  const key = `${owner.refId}|${String(ctx.page)}|${String(ctx.copy)}`;
  let props = cache.get(key);
  if (!props) { props = resolveRefProps(owner, ctx); cache.set(key, props); }
  return { ...ctx, props };
}
```

- [ ] **Step 6: place.ts — 내용 없는 ref, refBox, 인스턴스 항목 변환**

`packages/renderer/src/layout/place.ts`의 1~2행 import를 바꾼다:
```ts
import { interpolate, evaluate, evaluateTemplateValue, hasTemplate, ExpressionError, StyleSchema, type DataContext, type Style } from "@daport/core";
import type { FlatElement, RefOwner } from "./flatten";
```

`placeStatic`의 `case "ref"` 줄을 바꾼다(펼친 뒤 남는 ref는 내용을 못 찾은 것뿐이다):
```ts
      case "ref": return [errorItem(el, `component ${el.ref}@${el.version} not found`, opts.instance)];
```

파일 끝에 추가한다:
```ts
const REF_BOX_STYLE: Style = { ...StyleSchema.parse({}), fill: undefined, stroke: undefined };

/** 컴포넌트 인스턴스 상자 전체의 선택·히트용 항목. 인스턴스가 그려지는 페이지마다 그 인스턴스의 첫 항목 (반복 영역 안이면 항목 경로를 instance로) */
export function refBoxItem(owner: RefOwner, instance?: string): PlacedItem {
  const item: PlacedItem = { kind: "rect", role: "refBox", elementId: owner.refId, ...owner.box, style: REF_BOX_STYLE };
  if (instance !== undefined) item.instance = instance;
  return item;
}

/** 인스턴스 경로: [바깥 항목 경로/] + refId/path. 예 "hdr/box/logo", "cards#3/hdr/logo" */
export function ownedInstance(owner: RefOwner, outer?: string): string {
  return `${outer !== undefined ? `${outer}/` : ""}${owner.refId}/${owner.path}`;
}

/** 인스턴스 #ERR (내용 없음·입력값 평가 오류): ref 상자 자리, elementId는 인스턴스 id */
export function refErrorItem(owner: RefOwner, message: string, instance?: string): PlacedText {
  return errorItem({ id: owner.refId, ...owner.box, style: REF_BOX_STYLE }, message, instance);
}

/**
 * 펼친 요소 elId에서 나온 항목을 인스턴스 규칙으로 바꾼다(스펙 5.3): elementId = refId, instance가 없으면 base.
 * 요소 자신이 아닌 항목(컴포넌트 안 반복 영역의 항목 자식)은 자기 id를 뒤에 붙여 (elementId, instance)를 유일하게 한다
 */
export function ownItems(items: PlacedItem[], owner: RefOwner, elId: string, base: string): PlacedItem[] {
  return items.map((it) => ({ ...it, elementId: owner.refId, instance: `${it.instance ?? base}${it.elementId !== elId ? `/${it.elementId}` : ""}` }));
}
```

- [ ] **Step 7: layout.ts — components 전달, refFlow, owner 컨텍스트, id 규칙, refBox**

`packages/renderer/src/layout/layout.ts` 전체를 아래로 바꾼다(네 조각으로 나눠 적는다. 컴포넌트가 없으면 모든 분기가 기존 코드와 같은 항목을 같은 순서로 만든다).

(1) import·도우미:
```ts
import { evaluateSource, ExpressionError, StyleSchema, type Report, type DataContext, type Style } from "@daport/core";
import { flatten, type FlatElement, type RefOwner } from "./flatten";
import { placeStatic, isVisible, errorItem, refBoxItem, refErrorItem, ownedInstance, ownItems } from "./place";
import { withProps } from "./props";
import { LayoutLimitError, MAX_PAGES, RegionTooSmallError } from "./errors";
import type { Page, PlacedItem, PlacedText } from "./types";
import { lineHeightMm } from "../text/measure";
import { createMeasureCache } from "../text/cache";
import { paginate } from "../flow/paginate";
import { tableFlow } from "../flow/table";
import { repeaterFlow } from "../flow/repeater";
import { flowBoxItem, paintFlowPage, paintClipped } from "../flow/paint";
import type { FlowOptions, FlowPage, PageFlowContext, Region } from "../flow/types";

type FlowEl = Extract<FlatElement, { type: "table" | "repeater" }>;
/** 부(copy) 하나의 계획. flows는 흐름 요소 → 나눠진 페이지들 또는 #ERR 항목. propErr는 입력값 평가 오류로 #ERR가 된 인스턴스 흐름 요소 */
type CopyPlan = { ctx: DataContext; flows: Map<FlatElement, FlowPage[] | PlacedItem>; propErr: Set<FlatElement>; nPages: number; extra: PlacedItem[] };
type PropsCache = Map<string, Record<string, unknown>>;

const DEFAULT_STYLE: Style = StyleSchema.parse({});
const isContinueFlow = (el: FlatElement): el is FlowEl => (el.type === "table" || el.type === "repeater") && el.overflow === "continue";
/** 고정 요소가 나오는 페이지 규칙. 펼친 요소는 ref의 flow를 따른다(컴포넌트 내부 flow는 무시, 스펙 5.1) */
const flowOf = (el: FlatElement) => el.refFlow ?? el.flow;

function flowVisible(flow: "once" | "every" | "last", p: number, n: number): boolean {
  return flow === "every" || (flow === "once" ? p === 0 : p === n - 1);
}

/** 인스턴스 요소의 흐름 옵션: 인스턴스 접두사 `<refId>/<path>/` */
function ownedOpts(fopts: FlowOptions, owner: RefOwner | undefined): FlowOptions {
  return owner ? { ...fopts, instancePrefix: `${ownedInstance(owner)}/` } : fopts;
}
/** 인스턴스 요소의 항목을 id 규칙으로 바꾼다. owner가 없으면 그대로 */
function own(items: PlacedItem[], el: FlatElement): PlacedItem[] {
  return el.owner ? ownItems(items, el.owner, el.id, ownedInstance(el.owner)) : items;
}
```

(2) 영역·안내 항목·가시성·clip 반복 영역 (`regions`만 `s.flow` → `flowOf(s)`로 바뀐다):
```ts
/**
 * 첫 영역은 템플릿 상자 그대로. 이어지는 페이지 영역은 원래 x·y·w를 유지하고 아랫단 B까지 쓴다.
 * B = min(하단 여백선, 템플릿 하단 아래에 있고 가로로 겹치는 every·last 고정 요소들의 윗변). 마지막 페이지를 미리 모르므로 last 자리도
 * 모든 이어지는 페이지에서 비운다. 다른 continue 흐름 요소는 넣지 않는다(겹침 허용, pushDown은 이후 단계).
 * 펼친 고정 요소의 flow는 ref의 flow다
 */
function regions(el: FlowEl, report: Report, flat: FlatElement[]): { first: Region; next: Region } {
  const first = { x: el.x, y: el.y, w: el.w, h: el.h };
  const EPS = 1e-6;
  let bottom = report.page.height - report.page.margin[2];
  for (const s of flat) {
    if (s === el || isContinueFlow(s) || flowOf(s) === "once") continue;
    const top = s.type === "line" ? Math.min(s.y, s.y2) : s.y;
    const left = s.type === "line" ? Math.min(s.x, s.x2) : s.x;
    const width = s.type === "line" ? Math.abs(s.x2 - s.x) : s.w;
    const overlaps = left < el.x + el.w - EPS && left + Math.max(width, EPS) > el.x + EPS;
    if (top >= el.y + el.h - EPS && overlaps) bottom = Math.min(bottom, top);
  }
  return { first, next: { ...first, h: bottom - el.y } };
}

/** 여백 좌상단의 안내 항목 (#NODATA, repeat 소스 #ERR) */
function marginItem(report: Report, id: string, text: string, error?: string): PlacedText {
  const item: PlacedText = { kind: "text", elementId: id, x: report.page.margin[3], y: report.page.margin[0], w: 60, h: 8, style: DEFAULT_STYLE,
    lines: [text], lineHeight: lineHeightMm(DEFAULT_STYLE.fontSize, DEFAULT_STYLE.lineHeight), overflow: false };
  if (error) item.error = error;
  return item;
}

/** 요소와 조상 그룹·ref의 visible. 오류는 blank 모드에서 #ERR 항목, fail 모드에서 던진다 */
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
```

(3) `layout` 1단계:
```ts
/**
 * 순수 레이아웃 (스펙 5.3).
 * 1단계: 부마다 흐름 요소(continue 표·반복 영역)를 paginate하고 부의 페이지 수 = max(요소별 페이지 수, 1)을 정한다.
 * 2단계: 전체 페이지 수(sheets)가 정해진 뒤 페이지마다 고정 요소(flow 규칙)와 흐름 조각을 칠한다.
 * 페이지 상한을 넘으면 LayoutLimitError. 표현식 오류 격리는 1단계 규칙(onExpressionError)과 같다.
 * 컴포넌트 인스턴스(3b 스펙 5장): report.components로 ref를 펼치고, 인스턴스 요소는 props 컨텍스트로 평가하며
 * 항목 elementId = ref id, instance = refId/path(+자기 경로), 인스턴스가 그려지는 페이지마다 refBox를 첫 항목으로 둔다
 */
export function layout(report: Report, data: DataContext, opts: { maxPages?: number } = {}): Page[] {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const mode = report.onExpressionError;
  const fopts: FlowOptions = { measure: createMeasureCache(), onExpressionError: mode, components: report.components };
  const flat = flatten(report.elements, 0, 0, [], { components: report.components });

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
    const propErr = new Set<FlatElement>();
    const cache: PropsCache = new Map();   // 부마다: 이 단계의 컨텍스트에는 page·copy가 없어 키가 부를 가리지 못한다
    let nPages = 1;
    for (const el of flat) {
      if (!isContinueFlow(el)) continue;
      let ectx: DataContext;
      try { ectx = withProps(ctx, el.owner, cache); }
      catch (e) {
        if (!(e instanceof ExpressionError) || mode === "fail") throw e;
        flows.set(el, refErrorItem(el.owner!, e.message)); propErr.add(el); continue;   // 인스턴스 #ERR는 첫 페이지에 하나
      }
      const vis = visibility(el, ectx, mode);
      if (vis === false) continue;
      if (vis !== true) { flows.set(el, own([vis], el)[0]); continue; }
      try {
        const eopts = ownedOpts(fopts, el.owner);
        const input = el.type === "table" ? tableFlow(el, ectx, eopts) : repeaterFlow(el, ectx, eopts);
        const pages = paginate(input, { ...regions(el, report, flat), repeatHeader: el.type === "table" ? el.repeatHeader : false, clip: false });
        if (total + pages.length > maxPages) throw new LayoutLimitError(total + pages.length, maxPages);
        flows.set(el, pages);
        nPages = Math.max(nPages, pages.length);
      } catch (e) {
        if (!(e instanceof ExpressionError || e instanceof RegionTooSmallError) || mode === "fail") throw e;
        flows.set(el, own([errorItem(el, e.message)], el)[0]);   // 소스 오류·배열 아님·영역 부족: 흐름 요소 전체를 #ERR 한 칸
      }
    }
    total += nPages;
    if (total > maxPages) throw new LayoutLimitError(total, maxPages);
    const extra: PlacedItem[] = [];
    if (c.nodata) extra.push(marginItem(report, "__nodata", "#NODATA"));
    if (repeatError && ci === 0) extra.push(repeatError);
    plans.push({ ctx, flows, propErr, nPages, extra });
  });
```

(4) `layout` 2단계:
```ts
  // 2단계: sheets가 정해졌으니 칠한다
  const pages: Page[] = [];
  const cache: PropsCache = new Map();   // layout 호출 하나: 키에 page·copy가 들어간다
  plans.forEach((plan, ci) => {
    for (let p = 0; p < plan.nPages; p++) {
      const pageCtx: PageFlowContext = { page: p + 1, total: plan.nPages, sheet: pages.length + 1, sheets: total, copy: ci + 1, copies: plans.length, pageRows: [] };
      const ctx: DataContext = { ...plan.ctx, ...pageCtx };
      const items: PlacedItem[] = p === 0 ? [...plan.extra] : [];
      const boxed = new Set<string>();    // 이 페이지에 refBox를 둔 인스턴스
      const broken = new Set<string>();   // 이 페이지에서 입력값 평가가 실패한 인스턴스 (#ERR 하나만)
      /** 인스턴스 요소를 이 페이지에 그리기 직전: 입력값 컨텍스트를 만들고 첫 번째면 refBox를 둔다. 실패면 null */
      const enter = (el: FlatElement): DataContext | null => {
        const owner = el.owner;
        if (!owner) return ctx;
        if (broken.has(owner.refId)) return null;
        let ectx: DataContext;
        try { ectx = withProps(ctx, owner, cache); }
        catch (e) {
          if (!(e instanceof ExpressionError) || mode === "fail") throw e;
          broken.add(owner.refId);
          if (!boxed.has(owner.refId)) items.push(refErrorItem(owner, e.message));
          return null;
        }
        if (!boxed.has(owner.refId)) { boxed.add(owner.refId); items.push(refBoxItem(owner)); }
        return ectx;
      };
      for (const el of flat) {
        const flow = plan.flows.get(el);
        if (flow) {
          if (!Array.isArray(flow)) {                                              // #ERR 항목은 첫 페이지에만
            if (p !== 0) continue;
            if (plan.propErr.has(el)) {
              const refId = el.owner!.refId;
              if (!broken.has(refId) && !boxed.has(refId)) items.push(flow);
              broken.add(refId);
              continue;
            }
            if (enter(el)) items.push(flow);
            continue;
          }
          const fp = flow[p];
          if (!fp) continue;                                                       // 이 요소의 페이지가 더 짧으면 그 뒤 페이지에는 없다
          if (!enter(el)) continue;
          items.push(...own([flowBoxItem(el, { overflow: fp.overflow }), ...paintFlowPage(fp, { x: el.x, y: el.y }, pageCtx)], el));
          continue;
        }
        // isContinueFlow(el)를 그대로 쓰면 "el is FlowEl" 타입가드의 부정 분기에서 clip 표·반복 영역까지
        // 타입에서 제거돼(false여도 table/repeater일 수 있으므로) 아래 el.type 비교가 타입 오류가 된다. 조건만 그대로 풀어 쓴다
        if ((el.type === "table" || el.type === "repeater") && el.overflow === "continue") continue;   // 숨긴 흐름 요소
        if (!flowVisible(flowOf(el), p, plan.nPages)) continue;
        const ectx = enter(el);
        if (!ectx) continue;
        if (el.type === "table" || el.type === "repeater") {                       // clip: 고정 요소처럼 flow 규칙, 첫 영역만
          const vis = visibility(el, ectx, mode);
          if (vis === false) continue;
          if (vis !== true) { items.push(...own([vis], el)); continue; }
          const eopts = ownedOpts(fopts, el.owner);
          items.push(...own(el.type === "table" ? paintClipped(el, ectx, eopts, pageCtx) : paintClippedRepeater(el, ectx, eopts, pageCtx), el));
          continue;
        }
        items.push(...own(placeStatic(el, ectx, { onExpressionError: mode, instance: el.owner ? ownedInstance(el.owner) : undefined }), el));
      }
      pages.push({ index: pages.length, width: report.page.width, height: report.page.height, items, copyIndex: ci, pageInCopy: p });
    }
  });
  return pages;
}
```

- [ ] **Step 8: 반복 영역 항목·밴드의 ref (flow/children.ts)**

`packages/renderer/src/flow/children.ts` 전체:
```ts
import { ExpressionError, type DataContext, type Element } from "@daport/core";
import { flatten } from "../layout/flatten";
import { placeStatic, refBoxItem, refErrorItem, ownedInstance, ownItems } from "../layout/place";
import { withProps } from "../layout/props";
import type { PlacedItem } from "../layout/types";
import { paintClipped } from "./paint";
import type { FlowOptions, PageFlowContext } from "./types";

/**
 * 반복 영역 항목·그룹 밴드의 자식을 origin 기준 절대좌표로 그린다. 페이지 값은 컨텍스트에 합친다.
 * 스키마가 템플릿 안의 repeater와 continue 표(컴포넌트 내용 안 포함)를 막으므로 여기서 table은 항상 clip이다.
 * ref는 layout과 같은 flatten으로 펼친다: elementId = ref id, instance = `<항목 경로>/<refId>/<path>`(+표 자기 경로),
 * refBox는 항목 경로를 instance로 갖고 인스턴스의 첫 항목이다. 입력값은 항목마다 새로 평가한다(캐시 범위 = 이 호출)
 */
export function paintChildren(children: Element[], origin: { x: number; y: number }, ctx: DataContext,
  opts: FlowOptions & { instance: string; pageCtx: PageFlowContext }): PlacedItem[] {
  const full: DataContext = { ...ctx, ...opts.pageCtx };
  const items: PlacedItem[] = [];
  const cache = new Map<string, Record<string, unknown>>();
  const boxed = new Set<string>(), broken = new Set<string>();
  for (const el of flatten(children, origin.x, origin.y, [], { components: opts.components })) {
    if (el.type === "repeater") continue;   // 스키마가 막는다. 방어적으로 건너뛴다
    const owner = el.owner;
    if (!owner) {
      if (el.type === "table") items.push(...paintClipped(el, full, opts, opts.pageCtx, opts.instance));
      else items.push(...placeStatic(el, full, { onExpressionError: opts.onExpressionError, instance: opts.instance }));
      continue;
    }
    if (broken.has(owner.refId)) continue;
    let ectx: DataContext;
    try { ectx = withProps(full, owner, cache); }
    catch (e) {
      if (!(e instanceof ExpressionError) || opts.onExpressionError === "fail") throw e;
      broken.add(owner.refId);
      if (!boxed.has(owner.refId)) items.push(refErrorItem(owner, e.message, opts.instance));
      continue;
    }
    if (!boxed.has(owner.refId)) { boxed.add(owner.refId); items.push(refBoxItem(owner, opts.instance)); }
    const base = ownedInstance(owner, opts.instance);
    const painted = el.type === "table"
      ? paintClipped(el, ectx, opts, opts.pageCtx, base)
      : placeStatic(el, ectx, { onExpressionError: opts.onExpressionError, instance: base });
    items.push(...ownItems(painted, owner, el.id, base));
  }
  return items;
}
```

- [ ] **Step 9: 기존 테스트의 ref 자리표시 기대값 정리**

Task 1이 두 테스트의 ref에 `version: 1`과 크기가 같은 빈 내용 `components`를 더해 두었다. 이제 ref는 펼쳐지므로(빈 내용이면 refBox도 없다) 자리표시 기대값이 깨진다. ref 동작은 `components.test.ts`가 검사하므로 두 테스트에서 ref를 뺀다.

`packages/renderer/src/__tests__/layout.test.ts`의 `it("draws a barcode as svg, a table as a flowBox and keeps ref as a placeholder", ...)` 전체(Task 1이 바꾼 `components: { "hdr@1": { name: "hdr", w: 10, h: 5 } }`와 `ref: "hdr", version: 1` 줄 포함)를 바꾼다:
```ts
  it("draws a barcode as svg and a table as a flowBox", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items.map((i) => i.kind)).toEqual(["svg", "rect"]);
    expect(items[1]).toMatchObject({ role: "flowBox", elementId: "t" });
  });
```

`packages/renderer/src/__tests__/place.test.ts`에서 Task 1이 넣은 두 줄
```ts
const components = { "hdr@1": { name: "hdr", w: 5, h: 5 } };
const flat = (els: unknown[]) => flatten(parseReport({ id: "r", version: 1, page, components, elements: els as never }).elements);
```
을 원래 한 줄로 되돌린다(ref가 없으니 `components`가 필요 없다):
```ts
const flat = (els: unknown[]) => flatten(parseReport({ id: "r", version: 1, page, elements: els as never }).elements);
```
그리고 첫 `it(...)`에서 제목, Task 1이 바꾼 `{ id: "c", type: "ref", x: 0, y: 0, w: 5, h: 5, ref: "hdr", version: 1 },` 줄(삭제), kind 기대값을 바꾼다:
```ts
  it("places text, pageNumber, image, line, rect and barcode like layout did, with an instance", () => {
    const els = flat([
      { id: "t", type: "text", x: 1, y: 2, w: 40, h: 8, value: "{{ order.NAME }}" },
      { id: "p", type: "pageNumber", x: 0, y: 0, w: 10, h: 5 },
      { id: "i", type: "image", x: 0, y: 0, w: 10, h: 5, src: "asset://{{ order.NAME }}" },
      { id: "l", type: "line", x: 0, y: 0, w: 5, h: 0, x2: 5, y2: 0 },
      { id: "r", type: "rect", x: 0, y: 0, w: 5, h: 5 },
      { id: "b", type: "barcode", x: 0, y: 0, w: 5, h: 5, format: "qr", value: "x" },
    ]);
    const items = els.flatMap((el) => placeStatic(el, { ...ctx, page: 2, total: 3 }, { onExpressionError: "blank", instance: "cards#1" }));
    expect(items.map((i) => i.kind)).toEqual(["text", "text", "image", "line", "rect", "svg"]);
```
(그 아래 `expect(items[0])` … `expect((items[5] …` 줄은 그대로 둔다.)

- [ ] **Step 10: 통과 확인**

Run: `cd packages/renderer && pnpm exec vitest run src/__tests__/components.test.ts`
Expected: PASS (펼치기 3, props 3, 고정 인스턴스 5, 흐름 인스턴스 3, 반복 영역 1).

Run: `pnpm --filter @daport/renderer test`
Expected: 전체 PASS. `golden.test.ts`·`golden-phase2.test.ts`·`golden-phase3.test.ts` 스냅샷이 바뀌지 않는다(`-u` 없이 통과해야 한다. 스냅샷 파일이 수정되면 안 된다: `git status packages/renderer/src/__tests__/__snapshots__`가 깨끗해야 한다).

- [ ] **Step 11: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음. (`FlatElement`가 `ref`를 `missing: true`로만 담으므로 `placeStatic`의 `switch`는 모든 경우를 다룬다. studio는 `flatten`·`FlatElement`를 직접 쓰지 않는다.)

- [ ] **Step 12: Commit**

```bash
git add packages/renderer/src/layout/flatten.ts packages/renderer/src/layout/props.ts packages/renderer/src/layout/place.ts \
  packages/renderer/src/layout/layout.ts packages/renderer/src/layout/types.ts packages/renderer/src/flow/types.ts \
  packages/renderer/src/flow/children.ts packages/renderer/src/__tests__/components.test.ts \
  packages/renderer/src/__tests__/layout.test.ts packages/renderer/src/__tests__/place.test.ts
git commit -m "$(cat <<'EOF'
feat(renderer): 컴포넌트 ref 펼치기, 인스턴스 입력값 컨텍스트, elementId·instance 규칙과 refBox

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 컴포넌트 예제 골든과 PDF 비교

**Files:**
- Create: `packages/renderer/src/__tests__/fixtures/component-demo.report.json` (A4, 헤더 컴포넌트 2회 + 넘기는 표 컴포넌트. 예제일 뿐 양식 전용 코드는 없다)
- Create: `packages/renderer/src/__tests__/golden-components.test.ts`
- Create(생성됨): `packages/renderer/src/__tests__/__snapshots__/golden-components.test.ts.snap`
- Modify: `packages/pdf/src/__tests__/multipage.test.ts` (예제 목록에 `component-demo` 추가)

- [ ] **Step 1: 골든 테스트 작성**

`packages/renderer/src/__tests__/golden-components.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { fixtureContext } from "./fixtures/context";
import demo from "./fixtures/component-demo.report.json";

const text = (i: unknown) => (i as { lines: string[] }).lines.join("");

describe("golden: component example", () => {
  it("component-demo lays out two header instances and a splitting table component, and matches its snapshot", () => {
    const report = parseReport(demo);
    const pages = layout(report, fixtureContext(report));
    expect(pages.flatMap((p) => p.items).filter((i) => i.error)).toEqual([]);
    expect(pages).toHaveLength(2);                                              // 첫 영역 112mm, 이어지는 영역 267-54=213mm, 40행
    for (const p of pages) {
      expect(p.items.filter((i) => i.role === "refBox").map((i) => i.elementId)).toEqual(["hdr-top", "checks", "hdr-bottom"]);
      const keys = p.items.filter((i) => i.role === undefined || i.role === "refBox").map((i) => `${i.elementId}|${i.instance}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(p.items.filter((i) => i.elementId === "hdr-top" && i.instance === "hdr-top/ttl").map(text)).toEqual(["품질 검사 성적서"]);
      expect(p.items.filter((i) => i.elementId === "hdr-bottom" && i.instance === "hdr-bottom/ttl").map(text)).toEqual(["확인"]);
      expect(p.items.filter((i) => i.instance === "checks/t/t#h" && i.role === "cell")).toHaveLength(3);   // 머리 반복
    }
    expect(pages.map((p) => text(p.items.find((i) => i.instance === "hdr-bottom/sub")))).toEqual(["L-2026-0917 · 1/2", "L-2026-0917 · 2/2"]);
    expect(pages.map((p) => text(p.items.find((i) => i.instance === "hdr-top/sub")))).toEqual(["LOT L-2026-0917", "LOT L-2026-0917"]);
    expect(pages[0].items.filter((i) => i.instance === "checks/cap").map(text)).toEqual(["2라인 검사 항목 (40건)"]);
    expect(pages[1].items.some((i) => i.instance === "checks/cap")).toBe(false);   // ref.flow once
    const rowCells = pages.map((p) => p.items.filter((i) => i.role === "cell" && /^checks\/t\/t#\d+$/.test(i.instance ?? "") && i.elementId === "checks"));
    expect(rowCells.every((c) => c.length > 0)).toBe(true);
    expect(new Set(rowCells.flat().map((i) => i.instance)).size).toBe(40);
    expect(rowCells.flat().filter((i) => i.x === 10).map(text).slice(0, 2)).toEqual(["1", "2"]);
    expect(pages.flatMap((p) => p.items).find((i) => i.role === "refBox" && i.elementId === "checks")).toMatchObject({ x: 10, y: 46, w: 190, h: 120 });
    expect(pages).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/renderer && pnpm exec vitest run src/__tests__/golden-components.test.ts`
Expected: FAIL (`./fixtures/component-demo.report.json`을 찾지 못함).

- [ ] **Step 3: 예제 레포트 작성**

`packages/renderer/src/__tests__/fixtures/component-demo.report.json` (`components`의 `w`·`h`는 각 `ref`의 `w`·`h`와 같다. 표는 이어지는 페이지 아랫단이 `hdr-bottom`(flow every) 윗변 267mm가 된다):
```json
{
  "id": "component-demo", "name": "컴포넌트 예제", "version": 1,
  "page": { "width": 210, "height": 297, "margin": [10, 10, 10, 10] },
  "datasets": [
    { "name": "doc", "type": "static", "rows": [{ "TITLE": "품질 검사 성적서", "LOT": "L-2026-0917", "LINE": "2라인" }] },
    { "name": "items", "type": "static", "rows": [
      { "NO": 1, "NAME": "치수 1", "RES": "합격" }, { "NO": 2, "NAME": "외관 2", "RES": "합격" }, { "NO": 3, "NAME": "경도 3", "RES": "합격" }, { "NO": 4, "NAME": "도막 4", "RES": "보류" },
      { "NO": 5, "NAME": "치수 5", "RES": "합격" }, { "NO": 6, "NAME": "외관 6", "RES": "합격" }, { "NO": 7, "NAME": "경도 7", "RES": "합격" }, { "NO": 8, "NAME": "도막 8", "RES": "합격" },
      { "NO": 9, "NAME": "치수 9", "RES": "합격" }, { "NO": 10, "NAME": "외관 10", "RES": "불합격" }, { "NO": 11, "NAME": "경도 11", "RES": "합격" }, { "NO": 12, "NAME": "도막 12", "RES": "합격" },
      { "NO": 13, "NAME": "치수 13", "RES": "합격" }, { "NO": 14, "NAME": "외관 14", "RES": "합격" }, { "NO": 15, "NAME": "경도 15", "RES": "합격" }, { "NO": 16, "NAME": "도막 16", "RES": "합격" },
      { "NO": 17, "NAME": "치수 17", "RES": "보류" }, { "NO": 18, "NAME": "외관 18", "RES": "합격" }, { "NO": 19, "NAME": "경도 19", "RES": "합격" }, { "NO": 20, "NAME": "도막 20", "RES": "합격" },
      { "NO": 21, "NAME": "치수 21", "RES": "합격" }, { "NO": 22, "NAME": "외관 22", "RES": "합격" }, { "NO": 23, "NAME": "경도 23", "RES": "합격" }, { "NO": 24, "NAME": "도막 24", "RES": "합격" },
      { "NO": 25, "NAME": "치수 25", "RES": "합격" }, { "NO": 26, "NAME": "외관 26", "RES": "합격" }, { "NO": 27, "NAME": "경도 27", "RES": "불합격" }, { "NO": 28, "NAME": "도막 28", "RES": "합격" },
      { "NO": 29, "NAME": "치수 29", "RES": "합격" }, { "NO": 30, "NAME": "외관 30", "RES": "합격" }, { "NO": 31, "NAME": "경도 31", "RES": "합격" }, { "NO": 32, "NAME": "도막 32", "RES": "합격" },
      { "NO": 33, "NAME": "치수 33", "RES": "합격" }, { "NO": 34, "NAME": "외관 34", "RES": "보류" }, { "NO": 35, "NAME": "경도 35", "RES": "합격" }, { "NO": 36, "NAME": "도막 36", "RES": "합격" },
      { "NO": 37, "NAME": "치수 37", "RES": "합격" }, { "NO": 38, "NAME": "외관 38", "RES": "합격" }, { "NO": 39, "NAME": "경도 39", "RES": "합격" }, { "NO": 40, "NAME": "도막 40", "RES": "합격" }
    ] }
  ],
  "components": {
    "doc-header@1": { "name": "문서 헤더", "w": 190, "h": 20,
      "props": [{ "name": "title", "type": "string", "default": "문서", "label": "제목" }, { "name": "sub", "type": "string", "default": "", "label": "부제" }],
      "elements": [
        { "id": "frame", "type": "rect", "x": 0, "y": 0, "w": 190, "h": 20, "style": { "stroke": "#333333", "strokeWidth": 0.3 } },
        { "id": "ttl", "type": "text", "x": 3, "y": 2, "w": 130, "h": 9, "value": "{{ props.title }}", "style": { "fontSize": 14, "bold": true } },
        { "id": "sub", "type": "text", "x": 3, "y": 12, "w": 130, "h": 6, "value": "{{ props.sub }}", "style": { "fontSize": 9 } },
        { "id": "pn", "type": "pageNumber", "x": 140, "y": 12, "w": 47, "h": 6, "style": { "fontSize": 9, "align": "right" } }
      ] },
    "check-table@1": { "name": "검사 항목 표", "w": 190, "h": 120,
      "props": [{ "name": "caption", "type": "string", "default": "검사 항목" }],
      "elements": [
        { "id": "cap", "type": "text", "x": 0, "y": 0, "w": 190, "h": 7, "value": "{{ props.caption }}", "style": { "fontSize": 10, "bold": true } },
        { "id": "t", "type": "table", "x": 0, "y": 8, "w": 190, "h": 112, "source": "items", "rowHeight": 7, "headerHeight": 7,
          "headerStyle": { "bold": true, "fill": "#eeeeee" },
          "columns": [
            { "header": "번호", "value": "{{ row.NO }}", "w": 30, "align": "center", "style": { "fontSize": 9, "padding": 1 } },
            { "header": "항목", "value": "{{ row.NAME }}", "w": 100, "style": { "fontSize": 9, "padding": 1 } },
            { "header": "판정", "value": "{{ row.RES }}", "w": 60, "align": "center", "style": { "fontSize": 9, "padding": 1 } }
          ] }
      ] }
  },
  "elements": [
    { "id": "hdr-top", "type": "ref", "ref": "doc-header", "version": 1, "x": 10, "y": 10, "w": 190, "h": 20, "flow": "every",
      "props": { "title": "{{ doc.TITLE }}", "sub": "LOT {{ doc.LOT }}" } },
    { "id": "info", "type": "text", "x": 10, "y": 34, "w": 190, "h": 8, "value": "라인: {{ doc.LINE }}" },
    { "id": "checks", "type": "ref", "ref": "check-table", "version": 1, "x": 10, "y": 46, "w": 190, "h": 120,
      "props": { "caption": "{{ doc.LINE }} 검사 항목 ({{ count(items) }}건)" } },
    { "id": "hdr-bottom", "type": "ref", "ref": "doc-header", "version": 1, "x": 10, "y": 267, "w": 190, "h": 20, "flow": "every",
      "props": { "title": "확인", "sub": "{{ doc.LOT }} · {{ page }}/{{ total }}" } }
  ]
}
```

- [ ] **Step 4: 통과 확인과 스냅샷 생성**

Run: `cd packages/renderer && pnpm exec vitest run src/__tests__/golden-components.test.ts`
Expected: PASS, `__snapshots__/golden-components.test.ts.snap` 새로 생성(1 snapshot written). 표 셀 높이는 9pt×1.3=4.13mm + 여백 2mm < 7mm라 행 높이가 7mm로 고정돼 첫 페이지 15행·둘째 페이지 25행이다.

Run: `pnpm --filter @daport/renderer test`
Expected: 전체 PASS, 기존 스냅샷 파일(`golden.test.ts.snap`·`golden-phase2.test.ts.snap`·`golden-phase3.test.ts.snap`) 변경 없음.

- [ ] **Step 5: PDF 비교 테스트에 예제 추가 (실패 확인 대상)**

`packages/pdf/src/__tests__/multipage.test.ts`의 픽스처 import 끝(`badges` import 아래)에 추가한다:
```ts
import componentDemo from "../../../renderer/src/__tests__/fixtures/component-demo.report.json";
```

`it.each([...])`의 목록을 바꾼다(기존 네 예제와 같은 페이지 수·페이지별 HTML 대비 픽셀 비교·가로선 줄 수 검사, 같은 `MAX_DIFF_RATIO_DENSE` 예산):
```ts
  it.each([["inspection-cert", inspection], ["invoice", invoice], ["shipping-order", shipping], ["badge-sheet", badges], ["component-demo", componentDemo]])(
```

- [ ] **Step 6: PDF 테스트 실행**

Run: `pnpm --filter @daport/pdf test -- src/__tests__/multipage.test.ts`
Expected: PASS 5건. `component-demo`는 PDF 페이지 수 2(= `layout` 결과)이고 1·2쪽 모두 `shiftTolerantDiffRatio < 0.01`, 가로선 줄 수 차이 ≤ 1. (펼친 요소는 일반 항목과 같은 페인터로 그려지고 `refBox`는 채움·선이 없어 PDF·HTML 모두에서 보이지 않는다.)

이 태스크 전(Task 4 이전 코드)이라면 `parseReport`는 통과해도 ref가 펼쳐지지 않아 1쪽만 나오고 표·헤더가 없으므로, Step 4의 골든 테스트가 이 경로의 회귀 검사를 맡는다.

- [ ] **Step 7: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음 (JSON import는 기존 픽스처와 같은 `resolveJsonModule` 설정을 쓴다).

- [ ] **Step 8: Commit**

```bash
git add packages/renderer/src/__tests__/fixtures/component-demo.report.json packages/renderer/src/__tests__/golden-components.test.ts \
  packages/renderer/src/__tests__/__snapshots__/golden-components.test.ts.snap packages/pdf/src/__tests__/multipage.test.ts
git commit -m "$(cat <<'EOF'
test(renderer): 컴포넌트 예제 레이아웃 골든과 PDF·HTML 페이지 비교

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: studio 컴포넌트 저장소와 DB 스키마

**Files:**
- Modify: `apps/studio/src/db/schema.ts` (`components`, `componentVersions` 테이블 추가)
- Create: `apps/studio/src/lib/component-store.ts`
- Test: `apps/studio/src/lib/__tests__/component-store.test.ts`

이 태스크는 스펙 6.1을 구현한다. 메모리 저장소는 단위 테스트로 모든 규칙(생성·중복·버전 증가·같은 내용이면 `created: false`·옛 버전 조회·삭제·반환값 복제)을 검증한다. `DbComponentStore`는 `DATABASE_URL`이 없는 테스트 환경에서 돌릴 수 없으므로 테스트하지 않고 타입 검사만 통과시킨다(프리셋 저장소와 같은 방침).

구현 메모:
- 저장소는 입력 내용을 `parseComponentBody`로 검증해 기본값을 채운 **파싱 결과**를 저장하고, 해시도 파싱 결과로 계산한다. 레포트의 `components`도 `ReportSchema`가 같은 스키마로 파싱하므로 Task 8의 해시 비교가 같은 값을 낸다.
- "해시가 최신과 같으면 버전을 올리지 않음"은 **최신 버전과만** 비교한다. 옛 버전과 같은 내용을 저장하면 새 버전이 생긴다(스펙 11장: 옛 버전 내용으로 새 버전 저장).
- `create`는 id를 `COMPONENT_ID_RE`로 검사하고 맞지 않으면 일반 `Error`(라우트 400)를 던진다. `save`·`get`은 id 형식을 따로 검사하지 않는다(형식이 틀린 id는 있을 수 없으므로 `save`는 `NotFoundError`, `get`은 `null`).
- `drizzle-orm/neon-http` 드라이버는 `db.transaction()`을 지원하지 않고 호출하면 `"No transactions support in neon-http driver"`를 던진다. 대신 `db.batch([...])`가 여러 문장을 Neon HTTP 트랜잭션 하나로 보낸다. `create`·`save`는 `batch`로 원자성을 얻는다. 동시에 두 요청이 같은 다음 버전을 넣으면 `(component_id, version)` PK 위반으로 뒤쪽 batch 전체가 되돌려지고 `ConflictError`가 된다(라우트 409).
- `component_versions.component_id`는 `components.id`를 `on delete cascade`로 참조한다. `delete`는 `components` 행 하나만 지우면 모든 버전이 함께 지워진다(한 문장이라 원자적).
- `ConflictError`는 contract대로 `preset-store.ts`의 것을 재사용하고, `NotFoundError`는 `report-store.ts`의 것을 쓴다. 두 클래스의 메시지는 프리셋·레포트 문구라서 라우트(Task 7)가 컴포넌트용 메시지를 따로 만든다.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/component-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { componentHash, parseComponentBody, type ComponentBody } from "@daport/core";
import { MemoryComponentStore } from "../component-store";
import { ConflictError } from "../preset-store";
import { NotFoundError } from "../report-store";

const text = (id: string, value: string) => ({ id, type: "text", x: 0, y: 0, w: 180, h: 10, value });
// 저장소가 기본값을 채운 파싱 결과를 저장·해시하는지 보려고 픽스처는 기본값을 비운 원본 입력으로 둔다
const V1 = { name: "머리글", w: 180, h: 24, props: [{ name: "title", type: "string", default: "제목" }], elements: [text("t", "{{ props.title }}")] } as ComponentBody;
const V2 = { ...V1, name: "머리글 넓게", h: 30, elements: [text("t", "{{ props.title }}"), text("sub", "부제")] } as ComponentBody;
const hashOf = (b: ComponentBody) => componentHash(parseComponentBody(b));

afterEach(() => { vi.useRealTimers(); });

describe("MemoryComponentStore", () => {
  let store: MemoryComponentStore;
  beforeEach(() => { store = new MemoryComponentStore(); });

  it("create stores version 1 of the parsed body and returns its hash", async () => {
    const res = await store.create("company-header", V1);
    expect(res).toEqual({ version: 1, hash: hashOf(V1) });
    const v = await store.getVersion("company-header", 1);
    expect(v).toEqual({ body: parseComponentBody(V1), hash: hashOf(V1) });
    expect(v!.body.elements[0]).toMatchObject({ flow: "once", style: expect.any(Object) });   // 기본값이 채워져 저장된다
  });

  it("fills props and elements defaults for a minimal body", async () => {
    const minimal = { name: "빈 상자", w: 10, h: 5 } as ComponentBody;
    const { hash } = await store.create("empty-box", minimal);
    const detail = await store.get("empty-box");
    expect(detail!.latest).toEqual({ name: "빈 상자", w: 10, h: 5, props: [], elements: [] });
    expect(hash).toBe(componentHash(detail!.latest));
  });

  it("rejects a duplicate id with ConflictError and keeps the first body", async () => {
    await store.create("company-header", V1);
    await expect(store.create("company-header", V2)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.get("company-header"))!.summary).toMatchObject({ name: "머리글", latestVersion: 1, h: 24 });
  });

  it("rejects an invalid id or an invalid body without storing anything", async () => {
    await expect(store.create("Bad_Id", V1)).rejects.toThrow(/component id/);
    await expect(store.create("-lead", V1)).rejects.toThrow(/component id/);
    const nested = { ...V1, elements: [{ id: "r", type: "ref", ref: "other", version: 1, x: 0, y: 0, w: 1, h: 1 }] } as ComponentBody;
    await expect(store.create("nested", nested)).rejects.toThrow();
    await expect(store.create("zero-width", { ...V1, w: 0 })).rejects.toThrow();
    const dupProps = { ...V1, props: [V1.props[0], V1.props[0]] } as ComponentBody;
    await expect(store.create("dup-props", dupProps)).rejects.toThrow();
    for (const id of ["Bad_Id", "-lead", "nested", "zero-width", "dup-props"]) expect(await store.get(id)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("save with changed content creates the next version and updates the summary; old versions stay readable", async () => {
    await store.create("company-header", V1);
    const res = await store.save("company-header", V2);
    expect(res).toEqual({ version: 2, hash: hashOf(V2), created: true });
    expect(res.hash).not.toBe(hashOf(V1));
    const detail = (await store.get("company-header"))!;
    expect(detail.summary).toMatchObject({ id: "company-header", name: "머리글 넓게", latestVersion: 2, w: 180, h: 30 });
    expect(detail.versions.map((v) => [v.version, v.hash])).toEqual([[1, hashOf(V1)], [2, hashOf(V2)]]);
    expect(detail.latest).toEqual(parseComponentBody(V2));
    expect((await store.getVersion("company-header", 1))!.body).toEqual(parseComponentBody(V1));
    expect((await store.getVersion("company-header", 2))!.hash).toBe(hashOf(V2));
  });

  it("save with the same content as the latest returns created:false and keeps the version, even with reordered keys or filled defaults", async () => {
    await store.create("company-header", V1);
    const reordered = { elements: V1.elements, props: V1.props, h: 24, w: 180, name: "머리글" } as ComponentBody;
    expect(await store.save("company-header", reordered)).toEqual({ version: 1, hash: hashOf(V1), created: false });
    expect(await store.save("company-header", parseComponentBody(V1))).toEqual({ version: 1, hash: hashOf(V1), created: false });
    const detail = (await store.get("company-header"))!;
    expect(detail.versions).toHaveLength(1);
    expect(detail.summary.latestVersion).toBe(1);
  });

  it("compares only with the latest version: saving v1's content again after v2 creates v3", async () => {
    await store.create("company-header", V1);
    await store.save("company-header", V2);
    expect(await store.save("company-header", V1)).toEqual({ version: 3, hash: hashOf(V1), created: true });
    expect((await store.get("company-header"))!.versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("save throws NotFoundError for an unknown id and rejects an invalid body without adding a version", async () => {
    await expect(store.save("nope", V1)).rejects.toBeInstanceOf(NotFoundError);
    await store.create("company-header", V1);
    await expect(store.save("company-header", { ...V1, h: -1 })).rejects.toThrow();
    expect((await store.get("company-header"))!.versions).toHaveLength(1);
  });

  it("getVersion and get return null for unknown ids or versions", async () => {
    await store.create("company-header", V1);
    expect(await store.getVersion("company-header", 2)).toBeNull();
    expect(await store.getVersion("company-header", 0)).toBeNull();
    expect(await store.getVersion("nope", 1)).toBeNull();
    expect(await store.get("nope")).toBeNull();
  });

  it("list returns summaries in creation order with the latest size", async () => {
    await store.create("company-header", V1);
    await store.create("sign-box", { name: "서명란", w: 60, h: 20 } as ComponentBody);
    await store.save("company-header", V2);
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(["company-header", "sign-box"]);
    expect(list[0]).toMatchObject({ name: "머리글 넓게", latestVersion: 2, w: 180, h: 30 });
    expect(list[1]).toMatchObject({ name: "서명란", latestVersion: 1, w: 60, h: 20 });
    expect(typeof list[0].updatedAt).toBe("string");
  });

  it("delete removes the component and all of its versions; unknown ids throw NotFoundError", async () => {
    await store.create("company-header", V1);
    await store.save("company-header", V2);
    await store.delete("company-header");
    expect(await store.get("company-header")).toBeNull();
    expect(await store.getVersion("company-header", 1)).toBeNull();
    expect(await store.getVersion("company-header", 2)).toBeNull();
    expect(await store.list()).toEqual([]);
    await expect(store.delete("company-header")).rejects.toBeInstanceOf(NotFoundError);
    // 지운 뒤 같은 id로 다시 만들면 버전 1부터 시작한다
    expect((await store.create("company-header", V2)).version).toBe(1);
  });

  it("returns copies so callers cannot mutate stored (immutable) versions", async () => {
    await store.create("company-header", V1);
    const v = (await store.getVersion("company-header", 1))!;
    v.body.name = "바뀜";
    v.body.elements.length = 0;
    const d = (await store.get("company-header"))!;
    d.latest.w = 1;
    d.summary.name = "바뀜";
    const again = (await store.get("company-header"))!;
    expect(again.latest).toEqual(parseComponentBody(V1));
    expect(again.summary.name).toBe("머리글");
    expect(await store.save("company-header", V1)).toMatchObject({ created: false });
  });

  it("tracks createdAt per version and updatedAt only when a version is created", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = "2026-09-17T00:00:00.000Z", t1 = "2026-09-17T00:00:01.000Z", t2 = "2026-09-17T00:00:02.000Z";
    vi.setSystemTime(new Date(t0));
    await store.create("company-header", V1);
    vi.setSystemTime(new Date(t1));
    await store.save("company-header", V1);                        // 변경 없음
    expect((await store.get("company-header"))!.summary.updatedAt).toBe(t0);
    vi.setSystemTime(new Date(t2));
    await store.save("company-header", V2);
    const d = (await store.get("company-header"))!;
    expect(d.summary.updatedAt).toBe(t2);
    expect(d.versions.map((v) => v.createdAt)).toEqual([t0, t2]);
  });
});

describe("getComponentStore", () => {
  it("uses the memory store without DATABASE_URL and shares one instance across module reloads (Next bundles apart)", async () => {
    delete process.env.DATABASE_URL;
    delete (globalThis as any).__daportComponentStore;
    vi.resetModules();
    const modA = await import("../component-store");
    const a = modA.getComponentStore();
    expect(a).toBeInstanceOf(modA.MemoryComponentStore);
    vi.resetModules();
    const b = (await import("../component-store")).getComponentStore();
    expect(b).toBe(a);
    delete (globalThis as any).__daportComponentStore;
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/component-store.test.ts`
Expected: FAIL — `Failed to resolve import "../component-store"` (파일이 아직 없다).

- [ ] **Step 3: DB 스키마에 테이블 추가**

`apps/studio/src/db/schema.ts` 첫 줄의 import를 다음으로 바꾼다(`primaryKey` 추가):
```ts
import { pgTable, text, jsonb, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
```

파일 끝(`presets` 테이블 뒤)에 추가한다:
```ts

/** 컴포넌트 라이브러리(스펙 6.1). 최신 버전 번호와 표시용 이름만 둔다 */
export const components = pgTable("components", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  latestVersion: integer("latest_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 컴포넌트 버전별 불변 내용. 지우거나 고치지 않고, 컴포넌트를 지우면 함께 지워진다 */
export const componentVersions = pgTable("component_versions", {
  componentId: text("component_id").notNull().references(() => components.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  body: jsonb("body").notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.componentId, t.version] })]);
```

DB를 쓰는 환경에서는 배포 전에 `pnpm --filter studio db:push`로 테이블을 만든다(테스트는 DB를 쓰지 않으므로 이 태스크에서 실행하지 않는다).

- [ ] **Step 4: 저장소 구현**

`apps/studio/src/lib/component-store.ts`:
```ts
import { and, asc, eq } from "drizzle-orm";
import { COMPONENT_ID_RE, ComponentBodySchema, componentHash, parseComponentBody, type ComponentBody } from "@daport/core";
import { db } from "@/db/client";
import { components, componentVersions } from "@/db/schema";
import { ConflictError } from "./preset-store";
import { NotFoundError } from "./report-store";

export type ComponentSummary = { id: string; name: string; latestVersion: number; w: number; h: number; updatedAt: string };
export type ComponentDetail = { summary: ComponentSummary; versions: { version: number; hash: string; createdAt: string }[]; latest: ComponentBody };

export interface ComponentStore {
  list(): Promise<ComponentSummary[]>;
  get(id: string): Promise<ComponentDetail | null>;
  getVersion(id: string, version: number): Promise<{ body: ComponentBody; hash: string } | null>;
  /** 버전 1을 만든다. id 중복이면 ConflictError, id 형식·내용 스키마 오류는 Error */
  create(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }>;
  /** 해시가 최신 버전과 같으면 created=false로 버전을 그대로 두고, 다르면 다음 버전을 만든다. 없는 id는 NotFoundError */
  save(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }>;
  /** 컴포넌트와 모든 버전을 지운다. 없는 id는 NotFoundError. 사용 중 검사는 라우트가 한다 */
  delete(id: string): Promise<void>;
}

/** 입력을 검증해 기본값이 채워진 내용과 그 해시를 만든다. 저장·비교는 늘 이 파싱 결과로 한다 */
function prepareBody(input: unknown): { body: ComponentBody; hash: string } {
  const body = parseComponentBody(input);
  return { body, hash: componentHash(body) };
}

function checkId(id: string): void {
  if (!COMPONENT_ID_RE.test(id)) throw new Error(`invalid component id: ${id} (영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다)`);
}

type MemVersion = { version: number; body: ComponentBody; hash: string; createdAt: string };
type MemEntry = { id: string; name: string; updatedAt: string; versions: MemVersion[] };

const latestOf = (e: MemEntry): MemVersion => e.versions[e.versions.length - 1];
const summaryOf = (e: MemEntry): ComponentSummary => {
  const latest = latestOf(e);
  return { id: e.id, name: e.name, latestVersion: latest.version, w: latest.body.w, h: latest.body.h, updatedAt: e.updatedAt };
};

export class MemoryComponentStore implements ComponentStore {
  private map = new Map<string, MemEntry>();

  async list() { return [...this.map.values()].map(summaryOf); }

  async get(id: string) {
    const e = this.map.get(id);
    if (!e) return null;
    return {
      summary: summaryOf(e),
      versions: e.versions.map(({ version, hash, createdAt }) => ({ version, hash, createdAt })),
      // 버전 내용은 불변이다. 호출자가 고쳐도 저장된 내용이 바뀌지 않게 복제해서 돌려준다
      latest: structuredClone(latestOf(e).body),
    };
  }

  async getVersion(id: string, version: number) {
    const v = this.map.get(id)?.versions.find((x) => x.version === version);
    return v ? { body: structuredClone(v.body), hash: v.hash } : null;
  }

  async create(id: string, input: ComponentBody) {
    checkId(id);
    const { body, hash } = prepareBody(input);
    if (this.map.has(id)) throw new ConflictError(id);
    const now = new Date().toISOString();
    this.map.set(id, { id, name: body.name, updatedAt: now, versions: [{ version: 1, body, hash, createdAt: now }] });
    return { version: 1 as const, hash };
  }

  async save(id: string, input: ComponentBody) {
    const e = this.map.get(id);
    if (!e) throw new NotFoundError(id);
    const { body, hash } = prepareBody(input);
    const latest = latestOf(e);
    if (latest.hash === hash) return { version: latest.version, hash, created: false };
    const now = new Date().toISOString();
    const version = latest.version + 1;
    e.versions.push({ version, body, hash, createdAt: now });
    e.name = body.name;
    e.updatedAt = now;
    return { version, hash, created: true };
  }

  async delete(id: string) {
    if (!this.map.delete(id)) throw new NotFoundError(id);
  }
}

/** Postgres unique_violation. drizzle가 드라이버 오류를 cause로 감싸므로 사슬을 따라간다(report-store와 같은 규칙) */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) if ((cur as { code?: unknown }).code === "23505") return true;
  return false;
}

type ComponentRow = typeof components.$inferSelect;
const rowSummary = (c: ComponentRow, body: ComponentBody): ComponentSummary =>
  ({ id: c.id, name: c.name, latestVersion: c.latestVersion, w: body.w, h: body.h, updatedAt: c.updatedAt.toISOString() });
/** components와 그 최신 버전 행을 잇는 조건 */
const latestJoin = and(eq(componentVersions.componentId, components.id), eq(componentVersions.version, components.latestVersion));

export class DbComponentStore implements ComponentStore {
  async list() {
    const rows = await db().select({ c: components, body: componentVersions.body })
      .from(components).innerJoin(componentVersions, latestJoin).orderBy(asc(components.createdAt));
    // 저장된 행 하나가 스키마에 안 맞아도 GET /api/components 전체가 죽지 않도록 그 행만 건너뛴다 (DbPresetStore와 같은 규칙)
    const out: ComponentSummary[] = [];
    for (const r of rows) {
      const parsed = ComponentBodySchema.safeParse(r.body);
      if (parsed.success) out.push(rowSummary(r.c, parsed.data));
      else console.warn(`잘못된 컴포넌트 행을 건너뜁니다: ${r.c.id}`, parsed.error);
    }
    return out;
  }

  async get(id: string) {
    const d = db();
    const [row] = await d.select({ c: components, body: componentVersions.body })
      .from(components).innerJoin(componentVersions, latestJoin).where(eq(components.id, id));
    if (!row) return null;
    const latest = parseComponentBody(row.body);
    const versions = await d.select({ version: componentVersions.version, hash: componentVersions.hash, createdAt: componentVersions.createdAt })
      .from(componentVersions).where(eq(componentVersions.componentId, id)).orderBy(asc(componentVersions.version));
    return {
      summary: rowSummary(row.c, latest),
      versions: versions.map((v) => ({ version: v.version, hash: v.hash, createdAt: v.createdAt.toISOString() })),
      latest,
    };
  }

  async getVersion(id: string, version: number) {
    const [row] = await db().select({ body: componentVersions.body, hash: componentVersions.hash }).from(componentVersions)
      .where(and(eq(componentVersions.componentId, id), eq(componentVersions.version, version)));
    return row ? { body: parseComponentBody(row.body), hash: row.hash } : null;
  }

  async create(id: string, input: ComponentBody) {
    checkId(id);
    const { body, hash } = prepareBody(input);
    const d = db();
    try {
      // neon-http는 transaction()을 지원하지 않는다. batch는 한 HTTP 트랜잭션으로 실행되어 둘 다 들어가거나 둘 다 안 들어간다
      await d.batch([
        d.insert(components).values({ id, name: body.name, latestVersion: 1 }),
        d.insert(componentVersions).values({ componentId: id, version: 1, body, hash }),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(id);
      throw e;
    }
    return { version: 1 as const, hash };
  }

  async save(id: string, input: ComponentBody) {
    const d = db();
    const [cur] = await d.select({ latestVersion: components.latestVersion, hash: componentVersions.hash })
      .from(components).innerJoin(componentVersions, latestJoin).where(eq(components.id, id));
    if (!cur) throw new NotFoundError(id);
    const { body, hash } = prepareBody(input);
    if (cur.hash === hash) return { version: cur.latestVersion, hash, created: false };
    const version = cur.latestVersion + 1;
    try {
      // 두 요청이 같은 최신 버전을 읽고 동시에 저장하면 뒤쪽의 (component_id, version) 삽입이 PK 위반으로 실패하고
      // batch 전체가 되돌려진다. update의 latest_version 조건은 그 사이 번호가 앞질러 가지 않게 하는 이중 안전장치다
      await d.batch([
        d.insert(componentVersions).values({ componentId: id, version, body, hash }),
        d.update(components).set({ name: body.name, latestVersion: version, updatedAt: new Date() })
          .where(and(eq(components.id, id), eq(components.latestVersion, cur.latestVersion))),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(id);
      throw e;
    }
    return { version, hash, created: true };
  }

  async delete(id: string) {
    // component_versions는 on delete cascade로 함께 지워진다(한 문장이라 원자적)
    const res = await db().delete(components).where(eq(components.id, id)).returning({ id: components.id });
    if (res.length === 0) throw new NotFoundError(id);
  }
}

// 레포트·프리셋 저장소와 같은 이유(Next가 페이지와 라우트 핸들러를 따로 번들)로 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportComponentStore?: ComponentStore };
export function getComponentStore(): ComponentStore {
  if (!holder.__daportComponentStore) holder.__daportComponentStore = process.env.DATABASE_URL ? new DbComponentStore() : new MemoryComponentStore();
  return holder.__daportComponentStore;
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/component-store.test.ts`
Expected: PASS (14개 테스트).

Run: `pnpm --filter studio test`
Expected: 기존 studio 테스트를 포함해 모두 통과.

- [ ] **Step 6: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음. `DbComponentStore`는 테스트가 없으므로 이 검사로 drizzle 쿼리(`innerJoin`의 `latestJoin`, `batch` 튜플, `returning`)와 `ComponentStore` 구현 시그니처가 맞는지 확인한다.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/db/schema.ts apps/studio/src/lib/component-store.ts apps/studio/src/lib/__tests__/component-store.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 저장소(메모리·DB)와 components·component_versions 테이블

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: studio 컴포넌트 API

**Files:**
- Create: `apps/studio/src/lib/component-usage.ts`
- Create: `apps/studio/src/app/api/components/route.ts`
- Create: `apps/studio/src/app/api/components/[id]/route.ts`
- Create: `apps/studio/src/app/api/components/[id]/versions/[v]/route.ts`
- Create: `apps/studio/src/app/api/components/[id]/usage/route.ts`
- Create: `apps/studio/src/app/api/components/[id]/apply-latest/route.ts`
- Test: `apps/studio/src/lib/__tests__/component-usage.test.ts`
- Test: `apps/studio/src/app/api/components/__tests__/components-route.test.ts`

이 태스크는 스펙 6.2와 7.2의 업데이트 규칙 서버 쪽(`apply-latest`)을 구현한다. Task 3의 `refsTo`·`upgradeRefs`, Task 6의 `getComponentStore`를 쓴다.

결정 사항:
- `findUsage`는 레포트 저장소의 모든 레포트를 `list()` → `get()`으로 훑어 `refsTo(report, id)`의 버전을 모은다. 버전 목록은 중복 없이 오름차순, 결과 순서는 저장소 `list()` 순서다. 라이브러리에 없는 컴포넌트 id도 훑기 자체는 할 수 있지만, 라우트는 컴포넌트가 없으면 404를 돌려준다(`usage`, `apply-latest`, `DELETE` 모두).
- `applyLatestToReports`는 인스턴스가 **모두 이미 최신 버전**인 레포트를 바꾸지 않고 `updated`에도 `skipped`에도 넣지 않는다(바뀐 것이 없으므로). 나머지는 `upgradeRefs` → `ReportSchema.safeParse` → 레포트 저장소 `update` 순서로 처리하고, 검증 실패나 저장 실패는 그 레포트만 `skipped`에 사유를 넣고 계속한다. 컴포넌트가 없으면 `NotFoundError`를 던진다.
- `DELETE`는 존재 확인(404) → 사용처 확인(409 `{ error, reports }`) → 삭제(204) 순서다.
- `POST /api/components`의 `id`가 문자열이 아니면 400, 형식이 틀리면 저장소의 `invalid component id` 오류로 400, 내용 스키마 오류 400, 중복 409(`component exists: <id>`).
- `PUT /api/components/:id`는 없는 id 404, 내용 오류 400, 동시 저장 충돌(`ConflictError`) 409.
- `GET /api/components/:id/versions/:v`의 `v`가 `^[1-9][0-9]*$`가 아니면 그런 버전은 있을 수 없으므로 404.
- `ConflictError`·`NotFoundError`의 메시지는 프리셋·레포트 문구이므로 라우트가 컴포넌트용 메시지를 만든다.
- 라우트 테스트와 사용처 테스트는 `beforeEach`에서 `DATABASE_URL`을 지우고 `__daportReportStore`·`__daportSeeded`·`__daportComponentStore` 전역을 지워(report-store 테스트와 같은 방식) 테스트마다 새 메모리 저장소로 시작한다. 레포트 저장소는 새로 만들 때 예제 픽스처 7개를 시드하므로 `await ready()` 뒤에 테스트 레포트를 넣는다(예제에는 `ref`가 없어 사용처 결과에 섞이지 않는다).

- [ ] **Step 1: 사용처·일괄 적용 실패 테스트 작성**

`apps/studio/src/lib/__tests__/component-usage.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseComponentBody, type ComponentBody, type ReportInput } from "@daport/core";
import { getStore, ready, NotFoundError, MemoryReportStore } from "../report-store";
import { getComponentStore } from "../component-store";
import { findUsage, applyLatestToReports } from "../component-usage";

const text = (id: string, value: string) => ({ id, type: "text", x: 0, y: 0, w: 180, h: 10, value });
const titleProp = { name: "title", type: "string", default: "제목" };
const V1 = parseComponentBody({ name: "머리글", w: 180, h: 24, props: [titleProp], elements: [text("t", "{{ props.title }}")] });
// v2는 크기가 바뀌고 입력값 sub가 늘며, 페이지를 넘기는 표(overflow 기본값 continue)를 담는다 → 반복 영역 템플릿 안에서는 쓸 수 없다
const V2 = parseComponentBody({
  name: "머리글", w: 180, h: 30,
  props: [titleProp, { name: "sub", type: "string", default: "" }],
  elements: [text("t", "{{ props.title }}"), { id: "tbl", type: "table", x: 0, y: 10, w: 180, h: 20, source: "items", columns: [{ header: "품목", value: "{{ row.NAME }}", w: 180 }] }],
});
const SIGN = parseComponentBody({ name: "서명란", w: 60, h: 20, elements: [{ id: "box", type: "rect", x: 0, y: 0, w: 60, h: 20 }] });

const page = { width: 210, height: 297 };
const ref = (id: string, version: 1 | 2, props: Record<string, string | number | boolean> = {}) =>
  ({ id, type: "ref", ref: "hdr", version, x: 10, y: 10, w: 180, h: version === 1 ? 24 : 30, props });
const report = (id: string, elements: unknown[], components: Record<string, ComponentBody>) =>
  ({ id, name: id, version: 1, page, elements, components }) as ReportInput;

async function setup() {
  await ready();
  const lib = getComponentStore();
  await lib.create("hdr", V1);
  await lib.save("hdr", V2);
  await lib.create("sign", SIGN);
  const store = getStore();
  await store.create(report("uses-v1", [ref("h1", 1, { title: "A", legacy: "x" })], { "hdr@1": V1 }));
  await store.create(report("mixed", [
    ref("h1", 1),
    { id: "g", type: "group", x: 0, y: 50, w: 190, h: 40, children: [ref("h2", 2, { sub: "B" })] },
  ], { "hdr@1": V1, "hdr@2": V2 }));
  await store.create(report("on-latest", [ref("h1", 2)], { "hdr@2": V2 }));
  await store.create(report("in-template", [{
    id: "cards", type: "repeater", x: 10, y: 10, w: 180, h: 200, source: "{{ items }}",
    item: { w: 180, h: 24, children: [{ ...ref("h1", 1), x: 0, y: 0 }] },
  }], { "hdr@1": V1 }));
  await store.create(report("other", [{ id: "s", type: "ref", ref: "sign", version: 1, x: 0, y: 0, w: 60, h: 20 }], { "sign@1": SIGN }));
  return { lib, store };
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete (globalThis as any).__daportReportStore;
  delete (globalThis as any).__daportSeeded;
  delete (globalThis as any).__daportComponentStore;
  vi.restoreAllMocks();
});

describe("findUsage", () => {
  it("scans every stored report, including refs in groups and repeater templates, with distinct sorted versions", async () => {
    await setup();
    expect(await findUsage("hdr")).toEqual([
      { reportId: "uses-v1", versions: [1] },
      { reportId: "mixed", versions: [1, 2] },
      { reportId: "on-latest", versions: [2] },
      { reportId: "in-template", versions: [1] },
    ]);
    expect(await findUsage("sign")).toEqual([{ reportId: "other", versions: [1] }]);
    expect(await findUsage("unused")).toEqual([]);
  });
});

describe("applyLatestToReports", () => {
  it("upgrades refs to the latest version, updates size, drops undeclared props and old entries; skips reports that fail validation", async () => {
    const { store } = await setup();
    const before = { onLatest: await store.get("on-latest"), inTemplate: await store.get("in-template"), other: await store.get("other") };
    const res = await applyLatestToReports("hdr");
    expect(res.updated).toEqual(["uses-v1", "mixed"]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reportId).toBe("in-template");
    expect(res.skipped[0].error).toEqual(expect.any(String));
    expect(res.skipped[0].error.length).toBeGreaterThan(0);

    const usesV1 = (await store.get("uses-v1"))!;
    expect(usesV1.elements[0]).toMatchObject({ type: "ref", ref: "hdr", version: 2, w: 180, h: 30, props: { title: "A" } });
    expect((usesV1.elements[0] as { props: Record<string, unknown> }).props).not.toHaveProperty("legacy");
    expect(Object.keys(usesV1.components)).toEqual(["hdr@2"]);
    expect(usesV1.components["hdr@2"]).toEqual(V2);

    const mixed = (await store.get("mixed"))!;
    expect(mixed.elements[0]).toMatchObject({ version: 2, h: 30 });
    expect((mixed.elements[1] as { children: unknown[] }).children[0]).toMatchObject({ version: 2, h: 30, props: { sub: "B" } });
    expect(Object.keys(mixed.components)).toEqual(["hdr@2"]);

    // 이미 최신인 레포트, 건너뛴 레포트, 다른 컴포넌트만 쓰는 레포트는 그대로다
    expect(await store.get("on-latest")).toEqual(before.onLatest);
    expect(await store.get("in-template")).toEqual(before.inTemplate);
    expect(await store.get("other")).toEqual(before.other);
  });

  it("is idempotent: a second run updates nothing and skips the same invalid report", async () => {
    await setup();
    await applyLatestToReports("hdr");
    const again = await applyLatestToReports("hdr");
    expect(again.updated).toEqual([]);
    expect(again.skipped.map((s) => s.reportId)).toEqual(["in-template"]);
  });

  it("records a store failure for one report as skipped and still applies the rest", async () => {
    await setup();
    vi.spyOn(MemoryReportStore.prototype, "update").mockRejectedValueOnce(new Error("boom"));
    const res = await applyLatestToReports("hdr");
    expect(res.skipped).toEqual(expect.arrayContaining([{ reportId: "uses-v1", error: "boom" }]));
    expect(res.updated).toEqual(["mixed"]);
    expect((await getStore().get("uses-v1"))!.components).toHaveProperty("hdr@1");
  });

  it("throws NotFoundError when the component is not in the library", async () => {
    await setup();
    await expect(applyLatestToReports("unused")).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/component-usage.test.ts`
Expected: FAIL — `Failed to resolve import "../component-usage"`.

- [ ] **Step 3: 사용처·일괄 적용 구현**

`apps/studio/src/lib/component-usage.ts`:
```ts
import { ReportSchema, refsTo, upgradeRefs, type Report } from "@daport/core";
import { getStore, ready, NotFoundError } from "./report-store";
import { getComponentStore } from "./component-store";

export type Usage = { reportId: string; versions: number[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 저장된 레포트를 list() 순서로 하나씩 읽는다. 이 단계에서는 사용처 색인이 없으므로 전체를 훑는다(스펙 6.2) */
async function* storedReports(): AsyncGenerator<Report> {
  await ready();
  const store = getStore();
  for (const s of await store.list()) {
    const r = await store.get(s.id);
    if (r) yield r;
  }
}

const versionsIn = (report: Report, componentId: string): number[] =>
  [...new Set(refsTo(report, componentId).map((ref) => ref.version))].sort((a, b) => a - b);

/** 이 컴포넌트를 참조하는 저장된 레포트와 각 레포트가 쓰는 버전들 */
export async function findUsage(componentId: string): Promise<Usage[]> {
  const out: Usage[] = [];
  for await (const r of storedReports()) {
    const versions = versionsIn(r, componentId);
    if (versions.length > 0) out.push({ reportId: r.id, versions });
  }
  return out;
}

/**
 * 저장된 모든 레포트에서 이 컴포넌트의 인스턴스를 라이브러리 최신 버전으로 올린다(스펙 7.2 규칙, core upgradeRefs).
 * 이미 모두 최신인 레포트는 건드리지 않는다. 검증·저장에 실패한 레포트는 skipped에 사유를 남기고 나머지를 계속한다
 */
export async function applyLatestToReports(componentId: string): Promise<{ updated: string[]; skipped: { reportId: string; error: string }[] }> {
  const detail = await getComponentStore().get(componentId);
  if (!detail) throw new NotFoundError(componentId);
  const { latestVersion } = detail.summary;
  const store = getStore();
  const updated: string[] = [];
  const skipped: { reportId: string; error: string }[] = [];
  for await (const r of storedReports()) {
    const versions = versionsIn(r, componentId);
    if (versions.length === 0 || versions.every((v) => v === latestVersion)) continue;
    try {
      const checked = ReportSchema.safeParse(upgradeRefs(r, componentId, latestVersion, detail.latest));
      if (!checked.success) {
        skipped.push({ reportId: r.id, error: checked.error.issues.map((i) => i.message).join("; ") });
        continue;
      }
      await store.update(r.id, checked.data);
      updated.push(r.id);
    } catch (e) {
      skipped.push({ reportId: r.id, error: message(e) });
    }
  }
  return { updated, skipped };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/component-usage.test.ts`
Expected: PASS (5개 테스트).

- [ ] **Step 5: 라우트 실패 테스트 작성**

`apps/studio/src/app/api/components/__tests__/components-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { componentHash, parseComponentBody, type ReportInput } from "@daport/core";
import { GET as listComponents, POST as createComponent } from "../route";
import { GET as getComponent, PUT as saveComponent, DELETE as deleteComponent } from "../[id]/route";
import { GET as getVersion } from "../[id]/versions/[v]/route";
import { GET as getUsage } from "../[id]/usage/route";
import { POST as applyLatest } from "../[id]/apply-latest/route";
import { getStore, ready } from "@/lib/report-store";

const base = "http://localhost/api/components";
const headers = { "content-type": "application/json" };
const json = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => createComponent(new Request(base, { method: "POST", headers, body: json(body) }));
const get = (id: string) => getComponent(new Request(`${base}/${id}`), ctx(id));
const put = (id: string, body: unknown) => saveComponent(new Request(`${base}/${id}`, { method: "PUT", headers, body: json(body) }), ctx(id));
const del = (id: string) => deleteComponent(new Request(`${base}/${id}`, { method: "DELETE" }), ctx(id));
const version = (id: string, v: string) => getVersion(new Request(`${base}/${id}/versions/${v}`), { params: Promise.resolve({ id, v }) });
const usage = (id: string) => getUsage(new Request(`${base}/${id}/usage`), ctx(id));
const apply = (id: string) => applyLatest(new Request(`${base}/${id}/apply-latest`, { method: "POST" }), ctx(id));

const text = (id: string, value: string) => ({ id, type: "text", x: 0, y: 0, w: 180, h: 10, value });
const V1 = { name: "머리글", w: 180, h: 24, props: [{ name: "title", type: "string", default: "제목" }], elements: [text("t", "{{ props.title }}")] };
const V2 = {
  ...V1, h: 30,
  elements: [text("t", "{{ props.title }}"), { id: "tbl", type: "table", x: 0, y: 10, w: 180, h: 20, source: "items", columns: [{ header: "품목", value: "{{ row.NAME }}", w: 180 }] }],
};
const hash = (b: unknown) => componentHash(parseComponentBody(b));
const page = { width: 210, height: 297 };
const refTo = (id: string, v: 1 | 2) => ({ id, type: "ref", ref: "hdr", version: v, x: 10, y: 10, w: 180, h: v === 1 ? 24 : 30 });
const reportUsingV1 = (id: string, elements: unknown[] = [refTo("h", 1)]) =>
  ({ id, name: id, version: 1, page, elements, components: { "hdr@1": parseComponentBody(V1) } }) as ReportInput;

beforeEach(() => {
  delete process.env.DATABASE_URL;   // 메모리 저장소
  delete (globalThis as any).__daportReportStore;
  delete (globalThis as any).__daportSeeded;
  delete (globalThis as any).__daportComponentStore;
});

describe("GET/POST /api/components", () => {
  it("POST creates version 1 with 201 and the summary is listed", async () => {
    expect(await (await listComponents()).json()).toEqual([]);
    const res = await post({ id: "hdr", body: V1 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ version: 1, hash: hash(V1) });
    const list = await (await listComponents()).json();
    expect(list).toEqual([{ id: "hdr", name: "머리글", latestVersion: 1, w: 180, h: 24, updatedAt: expect.any(String) }]);
  });

  it("POST returns 409 for a duplicate id and 400 for invalid ids, bodies and JSON", async () => {
    await post({ id: "hdr", body: V1 });
    const dup = await post({ id: "hdr", body: V2 });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toContain("hdr");
    const nested = { ...V1, elements: [{ id: "r", type: "ref", ref: "other", version: 1, x: 0, y: 0, w: 1, h: 1 }] };
    for (const bad of [
      { id: "Bad", body: V1 }, { body: V1 }, { id: 5, body: V1 }, { id: "no-body" },
      { id: "nested", body: nested }, { id: "neg", body: { ...V1, h: -1 } }, "not json", "5",
    ]) {
      const res = await post(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(await (await listComponents()).json()).toHaveLength(1);
  });

  it("POST returns 413 for a body over the readJsonBody limit", async () => {
    const big = `{"id":"big","pad":"${"x".repeat(21 * 1024 * 1024)}"}`;
    expect((await post(big)).status).toBe(413);
  });
});

describe("GET/PUT /api/components/:id and versions", () => {
  it("GET returns the summary, version list and latest body; 404 for an unknown id", async () => {
    await post({ id: "hdr", body: V1 });
    const res = await get("hdr");
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.summary).toMatchObject({ id: "hdr", name: "머리글", latestVersion: 1, w: 180, h: 24 });
    expect(detail.versions).toEqual([{ version: 1, hash: hash(V1), createdAt: expect.any(String) }]);
    expect(detail.latest).toEqual(parseComponentBody(V1));
    expect((await get("nope")).status).toBe(404);
  });

  it("PUT returns created:false for unchanged content and the next version for changed content", async () => {
    await post({ id: "hdr", body: V1 });
    const same = await put("hdr", { body: V1 });
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ version: 1, hash: hash(V1), created: false });
    const changed = await put("hdr", { body: V2 });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ version: 2, hash: hash(V2), created: true });
    const detail = await (await get("hdr")).json();
    expect(detail.summary).toMatchObject({ latestVersion: 2, h: 30 });
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  });

  it("PUT returns 404 for an unknown id and 400 for an invalid or missing body", async () => {
    expect((await put("nope", { body: V1 })).status).toBe(404);
    await post({ id: "hdr", body: V1 });
    expect((await put("hdr", { body: { ...V1, w: 0 } })).status).toBe(400);
    expect((await put("hdr", {})).status).toBe(400);
    expect((await put("hdr", "not json")).status).toBe(400);
    expect((await (await get("hdr")).json()).versions).toHaveLength(1);
  });

  it("GET versions/:v returns the immutable body and hash of that version; 404 otherwise", async () => {
    await post({ id: "hdr", body: V1 });
    await put("hdr", { body: V2 });
    const v1 = await version("hdr", "1");
    expect(v1.status).toBe(200);
    expect(await v1.json()).toEqual({ body: parseComponentBody(V1), hash: hash(V1) });
    expect(await (await version("hdr", "2")).json()).toEqual({ body: parseComponentBody(V2), hash: hash(V2) });
    for (const v of ["3", "0", "-1", "abc", "1.5", "01"]) expect((await version("hdr", v)).status, v).toBe(404);
    expect((await version("nope", "1")).status).toBe(404);
  });
});

describe("usage, apply-latest and DELETE", () => {
  it("GET usage lists stored reports that reference the component; 404 for an unknown component", async () => {
    await post({ id: "hdr", body: V1 });
    await post({ id: "unused", body: V1 });
    await ready();
    await getStore().create(reportUsingV1("r-hdr"));
    const res = await usage("hdr");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ reportId: "r-hdr", versions: [1] }]);
    expect(await (await usage("unused")).json()).toEqual([]);
    expect((await usage("nope")).status).toBe(404);
  });

  it("POST apply-latest upgrades using reports, reports skipped ones, and returns 404 for an unknown component", async () => {
    await post({ id: "hdr", body: V1 });
    await ready();
    const store = getStore();
    await store.create(reportUsingV1("r-hdr"));
    // v2는 넘기는 표를 담으므로 반복 영역 템플릿 안 인스턴스는 검증에 실패해 건너뛴다
    await store.create(reportUsingV1("r-template", [{
      id: "cards", type: "repeater", x: 10, y: 10, w: 180, h: 200, source: "{{ items }}",
      item: { w: 180, h: 24, children: [{ ...refTo("h", 1), x: 0, y: 0 }] },
    }]));
    await put("hdr", { body: V2 });

    const res = await apply("hdr");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toEqual(["r-hdr"]);
    expect(body.skipped).toEqual([{ reportId: "r-template", error: expect.any(String) }]);
    const upgraded = (await store.get("r-hdr"))!;
    expect(upgraded.elements[0]).toMatchObject({ ref: "hdr", version: 2, w: 180, h: 30 });
    expect(Object.keys(upgraded.components)).toEqual(["hdr@2"]);
    expect(Object.keys((await store.get("r-template"))!.components)).toEqual(["hdr@1"]);
    expect(await (await usage("hdr")).json()).toEqual([{ reportId: "r-hdr", versions: [2] }, { reportId: "r-template", versions: [1] }]);

    expect((await apply("nope")).status).toBe(404);
  });

  it("DELETE returns 409 with report ids while used, 204 once unused, and 404 for an unknown id", async () => {
    await post({ id: "hdr", body: V1 });
    await ready();
    await getStore().create(reportUsingV1("r-hdr"));
    await getStore().create(reportUsingV1("r-hdr-2"));
    const used = await del("hdr");
    expect(used.status).toBe(409);
    const usedBody = await used.json();
    expect(usedBody.reports).toEqual(["r-hdr", "r-hdr-2"]);
    expect(typeof usedBody.error).toBe("string");
    expect((await get("hdr")).status).toBe(200);   // 지워지지 않았다

    await post({ id: "free", body: V1 });
    const ok = await del("free");
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    expect((await get("free")).status).toBe(404);
    expect((await version("free", "1")).status).toBe(404);
    expect((await del("free")).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/app/api/components/__tests__/components-route.test.ts`
Expected: FAIL — `Failed to resolve import "../route"` (라우트 파일이 아직 없다).

- [ ] **Step 7: 라우트 구현**

`apps/studio/src/app/api/components/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { ComponentBody } from "@daport/core";
import { getComponentStore } from "@/lib/component-store";
import { ConflictError } from "@/lib/preset-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

export async function GET() { return NextResponse.json(await getComponentStore().list()); }

export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { id, body } = parsed.body;
  if (typeof id !== "string") return NextResponse.json({ error: "id는 문자열이어야 합니다" }, { status: 400 });
  try {
    // 저장소가 parseComponentBody로 검증하므로 검증 전 본문의 형태는 여기서 확정하지 않는다
    return NextResponse.json(await getComponentStore().create(id, body as ComponentBody), { status: 201 });
  } catch (e) {
    if (e instanceof ConflictError) return NextResponse.json({ error: `component exists: ${id}` }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`apps/studio/src/app/api/components/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { ComponentBody } from "@daport/core";
import { getComponentStore } from "@/lib/component-store";
import { findUsage } from "@/lib/component-usage";
import { ConflictError } from "@/lib/preset-store";
import { NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

type Ctx = { params: Promise<{ id: string }> };
const notFound = (id: string) => NextResponse.json({ error: `component not found: ${id}` }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const detail = await getComponentStore().get(id);
  return detail ? NextResponse.json(detail) : notFound(id);
}

export async function PUT(req: Request, { params }: Ctx) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { id } = await params;
  try {
    return NextResponse.json(await getComponentStore().save(id, parsed.body.body as ComponentBody));
  } catch (e) {
    if (e instanceof NotFoundError) return notFound(id);
    if (e instanceof ConflictError) return NextResponse.json({ error: `component ${id} was saved concurrently; reload and retry` }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const store = getComponentStore();
  if (!(await store.get(id))) return notFound(id);
  const usage = await findUsage(id);
  if (usage.length > 0) {
    return NextResponse.json({ error: `component ${id} is used by reports`, reports: usage.map((u) => u.reportId) }, { status: 409 });
  }
  try {
    await store.delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof NotFoundError) return notFound(id);   // 확인과 삭제 사이에 다른 요청이 지운 경우
    throw e;
  }
}
```

`apps/studio/src/app/api/components/[id]/versions/[v]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getComponentStore } from "@/lib/component-store";

type Ctx = { params: Promise<{ id: string; v: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, v } = await params;
  // 버전은 1부터의 정수다. 그 밖의 표기(0, 음수, 소수, 앞자리 0)는 있을 수 없는 버전이라 404
  const found = /^[1-9][0-9]*$/.test(v) ? await getComponentStore().getVersion(id, Number(v)) : null;
  return found ? NextResponse.json(found) : NextResponse.json({ error: `component version not found: ${id}@${v}` }, { status: 404 });
}
```

`apps/studio/src/app/api/components/[id]/usage/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getComponentStore } from "@/lib/component-store";
import { findUsage } from "@/lib/component-usage";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getComponentStore().get(id))) return NextResponse.json({ error: `component not found: ${id}` }, { status: 404 });
  return NextResponse.json(await findUsage(id));
}
```

`apps/studio/src/app/api/components/[id]/apply-latest/route.ts`:
```ts
import { NextResponse } from "next/server";
import { applyLatestToReports } from "@/lib/component-usage";
import { NotFoundError } from "@/lib/report-store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return NextResponse.json(await applyLatestToReports(id));
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: `component not found: ${id}` }, { status: 404 });
    throw e;
  }
}
```

`apply-latest`는 요청 본문을 쓰지 않으므로 `readJsonBody`로 읽지 않는다(본문이 있어도 무시).

- [ ] **Step 8: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/app/api/components/__tests__/components-route.test.ts src/lib/__tests__/component-usage.test.ts`
Expected: PASS (라우트 10개, 사용처 5개).

Run: `pnpm --filter studio test`
Expected: 기존 studio 테스트를 포함해 모두 통과.

- [ ] **Step 9: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음(Next 16 라우트 핸들러의 `params: Promise<...>` 시그니처, `Report.components`, `upgradeRefs` 반환 타입과 `ReportStore.update` 입력 타입 호환 확인).

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/lib/component-usage.ts apps/studio/src/lib/__tests__/component-usage.test.ts apps/studio/src/app/api/components
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 API(목록·조회·버전·생성·저장·사용처·일괄 적용·삭제)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 레포트 저장 검사와 렌더 라우트 props 필드

레포트 저장(`POST /api/reports`, `PUT /api/reports/:id`) 전에 쓰이지 않는 컴포넌트 항목을 정리하고, 품은 내용의 해시를 라이브러리와 비교한다(스펙 6.3). 다르면 409 `COMPONENT_MISMATCH`, 라이브러리에 없는 버전이면 저장하고 `X-Daport-Warnings` 헤더에 ASCII 경고를 담는다. 렌더 라우트(미리보기·PDF·라벨, 그리고 라벨을 렌더하는 인쇄 라우트)는 요청 본문의 선택 필드 `props`(객체)를 데이터셋 실행 결과 컨텍스트에 `props`로 넣는다(스펙 7.5).

**Files:**
- Create: `apps/studio/src/lib/report-guard.ts`
- Modify: `apps/studio/src/lib/body.ts` (`propsField` 추가)
- Modify: `apps/studio/src/app/api/reports/route.ts` (POST: 파싱 → 검사 → 저장, 경고 헤더)
- Modify: `apps/studio/src/app/api/reports/[id]/route.ts` (PUT: 파싱 → 검사 → 저장, 경고 헤더)
- Modify: `apps/studio/src/app/api/reports/[id]/preview/route.ts`, `apps/studio/src/app/api/reports/[id]/pdf/route.ts`, `apps/studio/src/app/api/reports/[id]/label/route.ts`, `apps/studio/src/app/api/print/route.ts` (본문 `props` → 컨텍스트 `props`)
- Test: `apps/studio/src/lib/__tests__/report-guard.test.ts` (신규)
- Test: `apps/studio/src/app/api/reports/__tests__/save-guard.test.ts` (신규)
- Test: `apps/studio/src/lib/__tests__/body.test.ts`, `apps/studio/src/app/api/reports/__tests__/preview-route.test.ts`, `apps/studio/src/app/api/reports/__tests__/pdf-route.test.ts`, `apps/studio/src/app/api/reports/__tests__/label-route.test.ts`, `apps/studio/src/app/api/print/__tests__/print-route.test.ts` (각 파일 끝에 describe 추가)

전제: Task 1(`parseComponentBody`, `COMPONENT_KEY_RE`, `ReportSchema.components`, `RESERVED_CONTEXT_NAMES`의 `props`), Task 2(`componentHash`), Task 3(`pruneComponents`), Task 6(`getComponentStore`, `MemoryComponentStore`)이 끝나 있다.

- [ ] **Step 1: 저장 검사 실패 테스트 작성**

`apps/studio/src/lib/__tests__/report-guard.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { parseReport, parseComponentBody } from "@daport/core";
import { checkReportComponents, WARNINGS_HEADER } from "../report-guard";
import { getComponentStore } from "../component-store";

// 라이브러리 v1 내용. 레포트에 품을 때도 같은 원본을 쓰므로 스키마 기본값이 같게 채워져 해시가 같다
const rawBody = { name: "헤더", w: 50, h: 10, props: [{ name: "title", type: "string", default: "T" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "{{ props.title }}" }] };
// 크기는 같고 텍스트 한 글자만 다른 내용 (해시 불일치)
const changedBody = { ...rawBody, elements: [{ ...rawBody.elements[0], value: "{{ props.title }}!" }] };
const ref = (id: string, component: string, version: number) => ({ id, type: "ref", ref: component, version, x: 10, y: 10, w: 50, h: 10 });
const report = (components: Record<string, unknown>, elements: unknown[]) =>
  parseReport({ id: "g", version: 1, page: { width: 100, height: 100 }, components, elements });

beforeAll(async () => {
  delete process.env.DATABASE_URL;   // 메모리 컴포넌트 저장소
  await getComponentStore().create("guard-hdr", parseComponentBody(rawBody));   // guard-hdr@1만 라이브러리에 있다
});

describe("checkReportComponents", () => {
  it("exports the warnings header name", () => {
    expect(WARNINGS_HEADER).toBe("X-Daport-Warnings");
  });

  it("passes a report without components unchanged and with no warnings", async () => {
    const r = report({}, [{ id: "a", type: "rect", x: 0, y: 0, w: 5, h: 5 }]);
    const res = await checkReportComponents(r);
    expect(res).toEqual({ ok: true, report: r, warnings: [] });
  });

  it("accepts an embedded body whose hash matches the library version", async () => {
    const r = report({ "guard-hdr@1": rawBody }, [ref("h1", "guard-hdr", 1), ref("h2", "guard-hdr", 1)]);
    const res = await checkReportComponents(r);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings).toEqual([]);
      expect(Object.keys(res.report.components)).toEqual(["guard-hdr@1"]);
    }
  });

  it("rejects an embedded body that differs from the library version with 409 COMPONENT_MISMATCH", async () => {
    const r = report({ "guard-hdr@1": changedBody }, [ref("h1", "guard-hdr", 1)]);
    expect(await checkReportComponents(r)).toEqual({
      ok: false, status: 409, body: { error: "component guard-hdr@1 differs from the library", code: "COMPONENT_MISMATCH" },
    });
  });

  it("warns in ASCII for versions that are not in the library, including unknown component ids, sorted by key", async () => {
    const r = report({ "guard-none@1": rawBody, "guard-hdr@2": changedBody }, [ref("a", "guard-none", 1), ref("b", "guard-hdr", 2)]);
    const res = await checkReportComponents(r);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings).toEqual(["component guard-hdr@2 is not in the library", "component guard-none@1 is not in the library"]);
    for (const w of res.warnings) expect(w).toMatch(/^[\x20-\x7e]+$/);
    expect(Object.keys(res.report.components).sort()).toEqual(["guard-hdr@2", "guard-none@1"]);   // 경고만 하고 내용은 그대로 둔다
  });

  it("prunes unused entries before checking, so an unused mismatched or unknown entry neither blocks nor warns", async () => {
    const r = report({ "guard-hdr@1": changedBody, "guard-hdr@7": rawBody, "guard-none@3": rawBody }, [ref("h", "guard-hdr", 7)]);
    const res = await checkReportComponents(r);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.report.components)).toEqual(["guard-hdr@7"]);
    expect(res.warnings).toEqual(["component guard-hdr@7 is not in the library"]);
    expect(Object.keys(r.components).sort()).toEqual(["guard-hdr@1", "guard-hdr@7", "guard-none@3"]);   // 입력 객체는 바꾸지 않는다
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/report-guard.test.ts`
Expected: FAIL — `Failed to resolve import "../report-guard"` (모듈이 아직 없다)

- [ ] **Step 3: 저장 검사 구현**

`apps/studio/src/lib/report-guard.ts`:
```ts
import { COMPONENT_KEY_RE, componentHash, pruneComponents, type Report } from "@daport/core";
import { getComponentStore } from "./component-store";

/** 라이브러리에 없는 버전을 품은 레포트를 저장했을 때 경고를 담는 응답 헤더 (스펙 6.3). 값은 ASCII 문자열의 JSON 배열 */
export const WARNINGS_HEADER = "X-Daport-Warnings";

export type GuardResult =
  | { ok: true; report: Report; warnings: string[] }
  | { ok: false; status: 409; body: { error: string; code: "COMPONENT_MISMATCH" } };

/**
 * 레포트 저장 전 검사 (스펙 6.3).
 * 1) 쓰이지 않는 components 항목을 먼저 지운다 — 클라이언트 정리가 빠져도 파일이 부풀지 않고, 안 쓰는 옛 내용이 저장을 막지 않는다
 * 2) 남은 "id@v"마다 라이브러리의 그 버전을 찾는다. 있고 해시가 다르면 409, 없으면 경고만 남기고 저장한다
 * 경고 문구는 HTTP 헤더에 들어가므로 ASCII만 쓴다 (컴포넌트 id는 [a-z0-9-]라 ASCII다)
 */
export async function checkReportComponents(report: Report): Promise<GuardResult> {
  const pruned = pruneComponents(report);
  const store = getComponentStore();
  const warnings: string[] = [];
  for (const key of Object.keys(pruned.components).sort()) {
    const m = COMPONENT_KEY_RE.exec(key);
    if (!m) continue;   // ReportSchema가 키 형식을 이미 검증했다
    const stored = await store.getVersion(m[1], Number(m[2]));
    if (!stored) { warnings.push(`component ${key} is not in the library`); continue; }
    if (componentHash(pruned.components[key]) !== stored.hash) {
      return { ok: false, status: 409, body: { error: `component ${key} differs from the library`, code: "COMPONENT_MISMATCH" } };
    }
  }
  return { ok: true, report: pruned, warnings };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/report-guard.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 저장 라우트 실패 테스트 작성**

`apps/studio/src/app/api/reports/__tests__/save-guard.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { parseComponentBody } from "@daport/core";
import { POST as createReport } from "../route";
import { GET as getReport, PUT as updateReport } from "../[id]/route";
import { getComponentStore } from "@/lib/component-store";

const base = "http://localhost/api/reports";
const headers = { "content-type": "application/json" };
const post = (body: unknown) => createReport(new Request(base, { method: "POST", headers, body: JSON.stringify(body) }));
const put = (id: string, body: unknown) => updateReport(new Request(`${base}/${id}`, { method: "PUT", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const get = async (id: string) => getReport(new Request(`${base}/${id}`), { params: Promise.resolve({ id }) });

const rawBody = { name: "헤더", w: 40, h: 8, props: [],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 8, value: "HEADER" }] };
const changedBody = { ...rawBody, elements: [{ ...rawBody.elements[0], value: "HEADER!" }] };
const ref = (id: string, version: number) => ({ id, type: "ref", ref: "sg-hdr", version, x: 5, y: 5, w: 40, h: 8 });
const report = (id: string, components: Record<string, unknown>, elements: unknown[]) =>
  ({ id, name: id, version: 1, page: { width: 100, height: 100 }, components, elements });

beforeAll(async () => {
  delete process.env.DATABASE_URL;   // 메모리 레포트·컴포넌트 저장소
  await getComponentStore().create("sg-hdr", parseComponentBody(rawBody));   // sg-hdr@1만 라이브러리에 있다
});

describe("POST /api/reports component guard", () => {
  it("saves a matching component, prunes unused entries from the response and the stored report, and sends no warnings header", async () => {
    const res = await post(report("sg-ok", { "sg-hdr@1": rawBody, "sg-hdr@9": changedBody }, [ref("h", 1)]));
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Daport-Warnings")).toBeNull();
    expect(Object.keys((await res.json()).components)).toEqual(["sg-hdr@1"]);
    expect(Object.keys((await (await get("sg-ok")).json()).components)).toEqual(["sg-hdr@1"]);
  });

  it("returns 409 COMPONENT_MISMATCH and does not save when the embedded body differs from the library", async () => {
    const res = await post(report("sg-bad", { "sg-hdr@1": changedBody }, [ref("h", 1)]));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "component sg-hdr@1 differs from the library", code: "COMPONENT_MISMATCH" });
    expect((await get("sg-bad")).status).toBe(404);
  });

  it("saves a version that is not in the library, keeps it in the body and lists it in the warnings header", async () => {
    const res = await post(report("sg-warn", { "sg-hdr@2": changedBody }, [ref("h", 2)]));
    expect(res.status).toBe(201);
    expect(JSON.parse(res.headers.get("X-Daport-Warnings")!)).toEqual(["component sg-hdr@2 is not in the library"]);
    expect(Object.keys((await res.json()).components)).toEqual(["sg-hdr@2"]);
  });

  it("keeps schema errors as 400, not 409, and never reaches the guard for them", async () => {
    const missing = await post(report("sg-schema", {}, [ref("h", 1)]));   // 품은 내용 없는 ref
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBeUndefined();
    const badSize = await post(report("sg-schema", { "sg-hdr@1": changedBody }, [{ ...ref("h", 1), w: 41 }]));   // 크기 불일치가 해시보다 먼저
    expect(badSize.status).toBe(400);
  });
});

describe("PUT /api/reports/:id component guard", () => {
  beforeAll(async () => {
    expect((await post(report("sg-put", {}, []))).status).toBe(201);
  });

  it("returns 409 and leaves the stored report untouched when the embedded body differs", async () => {
    const res = await put("sg-put", report("sg-put", { "sg-hdr@1": changedBody }, [ref("h", 1)]));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("COMPONENT_MISMATCH");
    const stored = await (await get("sg-put")).json();
    expect(stored.elements).toEqual([]);
    expect(stored.components).toEqual({});
  });

  it("saves with a warnings header for a version missing from the library", async () => {
    const res = await put("sg-put", report("sg-put", { "sg-hdr@3": rawBody }, [ref("h", 3)]));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.headers.get("X-Daport-Warnings")!)).toEqual(["component sg-hdr@3 is not in the library"]);
  });

  it("saves a matching component with unused entries pruned and no warnings header, using the URL id", async () => {
    const res = await put("sg-put", { ...report("other-id", { "sg-hdr@1": rawBody, "sg-hdr@3": rawBody }, [ref("h", 1)]) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Daport-Warnings")).toBeNull();
    const body = await res.json();
    expect(body.id).toBe("sg-put");
    expect(Object.keys(body.components)).toEqual(["sg-hdr@1"]);
    expect(Object.keys((await (await get("sg-put")).json()).components)).toEqual(["sg-hdr@1"]);
  });

  it("still returns 404 for a missing id and 400 for a schema error", async () => {
    expect((await put("sg-nope", report("sg-nope", {}, []))).status).toBe(404);
    expect((await put("sg-put", report("sg-put", {}, [ref("h", 1)]))).status).toBe(400);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/app/api/reports/__tests__/save-guard.test.ts`
Expected: FAIL — 불일치 내용이 409가 아니라 201/200으로 저장되고(`expected 201 to be 409`), 경고 헤더가 `null`이며, 쓰이지 않는 `sg-hdr@9`·`sg-hdr@3`가 응답에 남는다

- [ ] **Step 7: 저장 라우트에 검사 연결**

`apps/studio/src/app/api/reports/route.ts` 전체를 다음으로 바꾼다:
```ts
import { NextResponse } from "next/server";
import { parseReport, type ReportInput } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { checkReportComponents, WARNINGS_HEADER } from "@/lib/report-guard";

export async function GET() { await ready(); return NextResponse.json(await getStore().list()); }

export async function POST(req: Request) {
  // 2단계에서 sample.data가 레포트 안으로 들어와 본문이 가장 커질 수 있는 라우트다 (Finding 4)
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    await ready();
    // 스키마 오류(누락 참조·크기 불일치 포함)는 여기서 던져 400이 된다. 해시 검사는 검증된 모델에만 한다 (스펙 6.3)
    const guard = await checkReportComponents(parseReport(parsed.body));
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    // 저장소는 받은 값을 다시 parseReport한다. 검증된 모델이라 같은 결과가 나온다
    const r = await getStore().create(guard.report as ReportInput);
    const res = NextResponse.json(r, { status: 201 });
    if (guard.warnings.length) res.headers.set(WARNINGS_HEADER, JSON.stringify(guard.warnings));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`apps/studio/src/app/api/reports/[id]/route.ts` 전체를 다음으로 바꾼다:
```ts
import { NextResponse } from "next/server";
import { parseReport, type ReportInput } from "@daport/core";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { checkReportComponents, WARNINGS_HEADER } from "@/lib/report-guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await ready();
  const r = await getStore().get((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx) {
  // 2단계에서 sample.data가 레포트 안으로 들어와 본문이 가장 커질 수 있는 라우트다 (Finding 4)
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    await ready();
    const id = (await params).id;
    // URL id가 본문 id보다 우선한다(저장소 update와 같은 규칙). 스키마 오류는 던져 400, 검사는 검증된 모델에만 한다 (스펙 6.3)
    const guard = await checkReportComponents(parseReport({ ...parsed.body, id }));
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    const res = NextResponse.json(await getStore().update(id, guard.report as ReportInput));
    if (guard.warnings.length) res.headers.set(WARNINGS_HEADER, JSON.stringify(guard.warnings));
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
```

- [ ] **Step 8: 통과 확인 (기존 라우트 테스트 포함)**

Run: `cd apps/studio && pnpm exec vitest run src/app/api/reports/__tests__/save-guard.test.ts src/app/api/reports/__tests__/route.test.ts src/lib/__tests__/report-guard.test.ts`
Expected: PASS — save-guard 8 tests, route.test.ts 7 tests(중복 id·잘못된 본문 400, URL id 우선, 413 그대로), report-guard 6 tests

- [ ] **Step 9: 커밋**

```bash
git add apps/studio/src/lib/report-guard.ts apps/studio/src/lib/__tests__/report-guard.test.ts \
  apps/studio/src/app/api/reports/route.ts "apps/studio/src/app/api/reports/[id]/route.ts" \
  apps/studio/src/app/api/reports/__tests__/save-guard.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): 레포트 저장 전 컴포넌트 정리·해시 검사와 경고 헤더

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: props 필드 실패 테스트 작성**

`apps/studio/src/lib/__tests__/body.test.ts` 맨 위 import를 바꾼다:
```ts
import { readJsonBody, propsField } from "../body";
```
파일 끝에 추가:
```ts
describe("propsField", () => {
  it("returns the props object and undefined for anything that is not a plain object", () => {
    expect(propsField({ props: { title: "T", n: 2, on: true } })).toEqual({ title: "T", n: 2, on: true });
    expect(propsField({ props: {} })).toEqual({});
    for (const props of [undefined, null, "x", 5, true, [1, 2], [{ title: "T" }]]) expect(propsField({ props })).toBeUndefined();
    expect(propsField({})).toBeUndefined();
  });
});
```

`apps/studio/src/app/api/reports/__tests__/preview-route.test.ts` 파일 끝에 추가:
```ts
describe("POST /api/reports/[id]/preview props field", () => {
  const report = { id: "qc", version: 1, page: { width: 100, height: 40 },
    elements: [{ id: "t", type: "text", x: 0, y: 0, w: 90, h: 8, value: "제목={{ props.title }} 수량={{ props.qty + 1 }}" }] };

  it("puts the body props object into the layout context as props", async () => {
    const res = await call({ report, params: {}, props: { title: "샘플 제목", qty: 2 } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("제목=샘플 제목 수량=3");
  });

  it("does not accept props through data, because props is a reserved context name", async () => {
    const res = await call({ report, params: {}, data: { props: [{ title: "x" }] } });
    expect(res.status).toBe(400);
    expect((await res.json()).datasetErrors).toEqual([expect.objectContaining({ dataset: "props", code: "BAD_DATA" })]);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/pdf-route.test.ts` 파일 끝에 추가:
```ts
describe("POST /api/reports/[id]/pdf props field", () => {
  it("passes body props to the renderer context next to params, and omits props when the field is missing or not an object", async () => {
    renderPdf.mockResolvedValue(Buffer.from("%PDF-"));
    expect((await call({ report, params: { lot: "L1" }, props: { title: "T", n: 2 } })).status).toBe(200);
    const ctx = renderPdf.mock.calls[0][1] as Record<string, unknown>;
    expect(ctx.props).toEqual({ title: "T", n: 2 });
    expect((ctx.params as { lot: string }).lot).toBe("L1");
    await call({ report, params: { lot: "L1" } });
    expect(Object.hasOwn(renderPdf.mock.calls[1][1] as object, "props")).toBe(false);
    await call({ report, params: { lot: "L1" }, props: ["T"] });
    expect(Object.hasOwn(renderPdf.mock.calls[2][1] as object, "props")).toBe(false);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/label-route.test.ts` 파일 끝에 추가:
```ts
describe("POST /api/reports/[id]/label props field", () => {
  it("passes body props into the context for the label download and the bitmap preview, and omits a non-object props", async () => {
    renderLabel.mockResolvedValue({ language: "zpl", dpi: 203, pages: 1, data: Buffer.from("^XA^XZ\n"), mime: "text/plain", filename: "lb.zpl" });
    rasterizePages.mockResolvedValue([{ width: 8, height: 1, bits: new Uint8Array([0xf0]) }]);
    expect((await call({ report: label, params: {}, props: { code: "P-1" } })).status).toBe(200);
    expect((renderLabel.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ code: "P-1" });
    expect((await call({ report: label, params: {}, props: { code: "P-2" } }, "?preview=png")).status).toBe(200);
    expect((rasterizePages.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ code: "P-2" });
    await call({ report: label, params: {}, props: "P-3" });
    expect(Object.hasOwn(renderLabel.mock.calls[1][1] as object, "props")).toBe(false);
  });
});
```

`apps/studio/src/app/api/print/__tests__/print-route.test.ts` 파일 끝에 추가 (인쇄 라우트도 라벨 레포트를 렌더하므로 같은 규칙을 따른다):
```ts
describe("POST /api/print props field", () => {
  it("passes body props into the label render context", async () => {
    const res = await call({ printer: "가짜", report: label, params: {}, props: { code: "P-1" } });
    expect(res.status).toBe(200);
    expect((renderLabel.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ code: "P-1" });
    await call({ printer: "가짜", report: label, params: {} });
    expect(Object.hasOwn(renderLabel.mock.calls[1][1] as object, "props")).toBe(false);
  });
});
```

- [ ] **Step 11: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/body.test.ts src/app/api/reports/__tests__/preview-route.test.ts src/app/api/reports/__tests__/pdf-route.test.ts src/app/api/reports/__tests__/label-route.test.ts src/app/api/print/__tests__/print-route.test.ts`
Expected: FAIL — `propsField is not a function`; 미리보기 HTML에 `제목=샘플 제목 수량=3`이 없다(#ERR); pdf·label·print는 `expected undefined to deeply equal { title: 'T', n: 2 }` 등. `data.props` 거부 테스트는 Task 1에서 이미 통과한다

- [ ] **Step 12: propsField와 렌더 라우트 구현**

`apps/studio/src/lib/body.ts` 파일 끝(`objectField` 아래)에 추가:
```ts
/**
 * 렌더 요청 본문의 선택 필드 props (스펙 7.5). 컴포넌트 편집 화면이 미리보기용 샘플 입력값을 보낸다.
 * 객체가 아니면 undefined. 라우트는 데이터셋 실행 결과 컨텍스트에 props로 넣는다 (data의 키로는 예약어라 거부된다)
 */
export function propsField(body: Record<string, unknown>): Record<string, unknown> | undefined {
  return objectField(body, "props");
}
```

`apps/studio/src/app/api/reports/[id]/preview/route.ts`:
- import 줄 `import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";`를 `import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";`로 바꾼다.
- 다음 줄을
```ts
    const html = renderToHtml(resolveAssetUrls(report, origin), context, { fontBaseUrl: `${origin}/fonts` });
```
  아래로 바꾼다:
```ts
    const props = propsField(body);
    const html = renderToHtml(resolveAssetUrls(report, origin), props ? { ...context, props } : context, { fontBaseUrl: `${origin}/fonts` });
```

`apps/studio/src/app/api/reports/[id]/pdf/route.ts`:
- import 줄을 `import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";`로 바꾼다.
- 데이터셋 블록의 `data = context;`를 아래로 바꾼다:
```ts
    const props = propsField(body);
    data = props ? { ...context, props } : context;
```

`apps/studio/src/app/api/reports/[id]/label/route.ts`:
- import 줄을 `import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";`로 바꾼다.
- 데이터셋 블록의 `data = context;`를 아래로 바꾼다 (`renderLabel`과 `?preview=png`의 `rasterizePages`가 모두 이 `data`를 쓴다):
```ts
    const props = propsField(body);
    data = props ? { ...context, props } : context;
```

`apps/studio/src/app/api/print/route.ts`:
- import 줄을 `import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";`로 바꾼다.
- 다음 줄을
```ts
    const res = await renderLabel(resolveAssetUrls(report, new URL(req.url).origin), context);
```
  아래로 바꾼다:
```ts
    const props = propsField(body);
    const res = await renderLabel(resolveAssetUrls(report, new URL(req.url).origin), props ? { ...context, props } : context);
```

`context`는 `executeDatasets`가 own enumerable 속성으로만 만든 객체라 펼쳐 복사해도 데이터셋 값이 그대로 옮겨지고, 객체 리터럴의 `props` 키는 setter를 타지 않는다.

- [ ] **Step 13: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/body.test.ts src/app/api/reports/__tests__/preview-route.test.ts src/app/api/reports/__tests__/pdf-route.test.ts src/app/api/reports/__tests__/label-route.test.ts src/app/api/print/__tests__/print-route.test.ts`
Expected: PASS — 기존 테스트와 새 props 테스트 모두

- [ ] **Step 14: 전체 studio 테스트와 타입 검사**

Run: `pnpm --filter studio test`
Expected: PASS (실패 0)

Run: `pnpm typecheck`
Expected: 오류 없이 종료

- [ ] **Step 15: 커밋**

```bash
git add apps/studio/src/lib/body.ts apps/studio/src/lib/__tests__/body.test.ts \
  "apps/studio/src/app/api/reports/[id]/preview/route.ts" "apps/studio/src/app/api/reports/[id]/pdf/route.ts" \
  "apps/studio/src/app/api/reports/[id]/label/route.ts" apps/studio/src/app/api/print/route.ts \
  apps/studio/src/app/api/reports/__tests__/preview-route.test.ts apps/studio/src/app/api/reports/__tests__/pdf-route.test.ts \
  apps/studio/src/app/api/reports/__tests__/label-route.test.ts apps/studio/src/app/api/print/__tests__/print-route.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): 미리보기·PDF·라벨·인쇄 요청 본문의 props를 렌더 컨텍스트에 넣기

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: studio 스토어 액션과 그룹화 단축키

**Files:**
- Modify: `apps/studio/src/editor/store.ts`, `apps/studio/src/editor/useKeyboard.ts`
- Test: `apps/studio/src/editor/__tests__/store.test.ts`, `apps/studio/src/editor/__tests__/useKeyboard.test.tsx`

전제: Task 1(`ComponentBody`·`ComponentProp`·`componentKey`, `ref.version`, `report.components`)과 Task 3(`Box`, `upgradeRefs`, `extractComponent`, `sameParent`, `groupElements`, `ungroupElement`)이 `@daport/core`에서 export된다.

결정 사항(스펙이 정하지 않은 부분):
- 계약의 `componentMode` 타입과 액션 결과 타입에 이름을 붙여 export한다: `ComponentMode`, `ActionResult`(계약 추가). `createEditorStore(initial, opts?: { componentMode?: ComponentMode | null })`는 계약의 `EditorState["componentMode"]`와 같은 타입이다.
- `setComponentProps`·`setSampleProps`는 컴포넌트 모드가 아니면 아무것도 하지 않는다. `setComponentProps`는 히스토리 밖이지만 저장 대상이라 `dirty = true`, 샘플 값은 저장하지 않으므로 dirty를 바꾸지 않는다.
- `insertComponent`는 컴포넌트 모드에서 아무것도 하지 않는다(스펙 7.5 중첩 금지를 스토어에서도 막는다). 놓은 위치는 기존 편집과 같이 0.01mm로 반올림한다.
- `replaceWithComponent`는 선택 조건(`sameParent`, 템플릿 밖·ref 없음)이 안 맞으면 아무것도 하지 않는다. `ref`의 w·h는 `body.w`·`body.h`를 쓴다(스키마가 같음을 요구한다).
- `groupSelected`는 선택 1개 이상이면 묶는다(`sameParent`와 같은 조건, 반복 영역 밴드 안·ref 포함 허용).
- `ungroupSelected`는 선택 중 그룹만 문서 순서(바깥 먼저)로 푼다. 하나라도 `visible`이 있으면 아무것도 풀지 않고 사유를 돌려준다. 그룹이 없으면 "해제할 그룹을 선택하세요". 선택은 풀린 자식들(바깥과 안쪽 그룹을 함께 고르면 안쪽 그룹 자리에 그 자식들).
- 단축키 오류 표시: 이 코드베이스는 저장·PDF·인쇄 실패를 `alert`로 알린다(`Toolbar.tsx`). 같은 방식으로 `window.alert(res.error)`를 쓴다. 선택이 없으면 Cmd+G는 아무것도 하지 않고 브라우저 기본 동작도 막지 않는다(Delete와 같은 규칙).

- [ ] **Step 1: 스토어 실패 테스트 작성**

`apps/studio/src/editor/__tests__/store.test.ts`의 2행 import를 바꾼다:
```ts
import { parseReport, ElementSchema, extractComponent, type Element, type ComponentBody } from "@daport/core";
```

파일 끝(`describe("editor store (phase 3)", …)` 블록 뒤)에 추가:
```ts

describe("editor store (phase 3b: components)", () => {
  const hdr: ComponentBody = { name: "헤더", w: 60, h: 20, props: [{ name: "title", type: "string", default: "제목" }, { name: "sub", type: "string", default: "" }],
    elements: [ElementSchema.parse({ id: "t", type: "text", x: 0, y: 0, w: 60, h: 10, value: "{{ props.title }}" })] };
  const hdrV2: ComponentBody = { ...hdr, h: 25, props: [{ name: "title", type: "string", default: "제목" }] };
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
    { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
    { id: "l", type: "line", x: 50, y: 30, w: 20, h: 0, x2: 30, y2: 30 },   // w/h를 끝점과 맞춰 둔다(apply가 다시 계산하므로 원래 레포트와 비교가 깨지지 않게)
    { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
  ]});
  const refOf = (s: ReturnType<typeof createEditorStore>, id: string) => s.getState().findElement(id) as Extract<Element, { type: "ref" }>;

  it("componentMode is null by default and set from options; props are dirty edits outside history, sample props are not dirty", () => {
    const plain = createEditorStore(rep);
    expect(plain.getState().componentMode).toBeNull();
    plain.getState().setComponentProps([{ name: "x", type: "number", default: 1 }]);
    plain.getState().setSampleProps({ x: 2 });
    expect(plain.getState().componentMode).toBeNull();
    expect(plain.getState().dirty).toBe(false);

    const s = createEditorStore(rep, { componentMode: { componentId: "hdr", version: 3, props: hdr.props, sampleProps: {} } });
    s.getState().setSampleProps({ title: "샘플" });
    expect(s.getState().componentMode).toMatchObject({ componentId: "hdr", version: 3, sampleProps: { title: "샘플" } });
    expect(s.getState().dirty).toBe(false);
    s.getState().setComponentProps([{ name: "title", type: "string", default: "새 제목" }]);
    expect(s.getState().componentMode?.props).toEqual([{ name: "title", type: "string", default: "새 제목" }]);
    expect(s.getState().dirty).toBe(true);
    expect(s.getState().history.past).toHaveLength(0);
  });

  it("insertComponent embeds the body and adds a selected ref at the drop point, as one undo step", () => {
    const s = createEditorStore(rep);
    s.getState().insertComponent("hdr", 3, hdr, 12.345, 40);
    const ref = refOf(s, "hdr-1");
    expect(ref).toMatchObject({ type: "ref", ref: "hdr", version: 3, x: 12.35, y: 40, w: 60, h: 20, flow: "once", props: {} });
    expect(s.getState().report.elements.at(-1)?.id).toBe("hdr-1");
    expect(s.getState().report.components["hdr@3"]).toEqual(hdr);
    expect(s.getState().selection).toEqual(["hdr-1"]);
    s.getState().insertComponent("hdr", 3, hdr, 0, 0);
    expect(s.getState().findElement("hdr-2")).toBeTruthy();
    expect(Object.keys(s.getState().report.components)).toEqual(["hdr@3"]);
    expect(s.getState().replaceReport(JSON.parse(JSON.stringify(s.getState().report)))).toBe(true);   // 스키마를 통과한다
    s.getState().undo(); s.getState().undo();
    expect(s.getState().findElement("hdr-1")).toBeUndefined();
    expect(s.getState().report.components).toEqual({});
  });

  it("insertComponent does nothing in component mode (no nesting)", () => {
    const s = createEditorStore(rep, { componentMode: { componentId: "other", version: 1, props: [], sampleProps: {} } });
    s.getState().insertComponent("hdr", 3, hdr, 0, 0);
    expect(s.getState().findElement("hdr-1")).toBeUndefined();
    expect(s.getState().history.past).toHaveLength(0);
  });

  it("updateInstances upgrades every instance, drops undeclared values and old versions, as one undo step", () => {
    const s = createEditorStore(rep);
    s.getState().insertComponent("hdr", 1, hdr, 0, 0);
    s.getState().updateElement("hdr-1", { props: { title: "{{ params.t }}", sub: "부제" } } as Partial<Element>);
    s.getState().select(["a"]);
    const past = s.getState().history.past.length;
    s.getState().updateInstances("hdr", 2, hdrV2);
    expect(refOf(s, "hdr-1")).toMatchObject({ version: 2, w: 60, h: 25, props: { title: "{{ params.t }}" } });
    expect(refOf(s, "hdr-1").props).not.toHaveProperty("sub");
    expect(Object.keys(s.getState().report.components)).toEqual(["hdr@2"]);
    expect(s.getState().selection).toEqual(["a"]);
    expect(s.getState().history.past).toHaveLength(past + 1);
    s.getState().undo();
    expect(refOf(s, "hdr-1")).toMatchObject({ version: 1, h: 20, props: { sub: "부제" } });
    expect(Object.keys(s.getState().report.components)).toEqual(["hdr@1"]);
  });

  it("replaceWithComponent swaps the selection for a ref at the first selected position and selects it, as one undo step", () => {
    const s = createEditorStore(rep);
    const { body, box } = extractComponent(s.getState().report.elements, ["l", "a"], "머리");
    s.getState().select(["a", "l"]);
    s.getState().replaceWithComponent(["l", "a"], "head", 1, body, box);
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["head-1", "g"]);
    expect(refOf(s, "head-1")).toMatchObject({ ref: "head", version: 1, x: 10, y: 10, w: 40, h: 20, flow: "once", props: {} });
    expect(s.getState().report.components["head@1"]).toEqual(body);
    expect(s.getState().selection).toEqual(["head-1"]);
    expect(s.getState().replaceReport(JSON.parse(JSON.stringify(s.getState().report)))).toBe(true);
    s.getState().undo();
    expect(s.getState().report.elements.map((e) => e.id)).toEqual(["a", "l", "g"]);
    expect(s.getState().report.components).toEqual({});
  });

  it("replaceWithComponent replaces group children inside their group and ignores selections that break the rules", () => {
    const s = createEditorStore(rep);
    const { body, box } = extractComponent((s.getState().findElement("g") as Extract<Element, { type: "group" }>).children, ["b"], "상자");
    s.getState().replaceWithComponent(["b"], "box", 1, body, box);
    expect((s.getState().findElement("g") as Extract<Element, { type: "group" }>).children.map((c) => c.id)).toEqual(["box-1"]);
    expect(refOf(s, "box-1")).toMatchObject({ x: 1, y: 1, w: 5, h: 5 });

    const t = createEditorStore(rep);
    t.getState().select(["a"]);
    t.getState().replaceWithComponent(["a", "b"], "x", 1, body, box);   // 부모가 다르다
    expect(t.getState().history.past).toHaveLength(0);
    expect(t.getState().selection).toEqual(["a"]);
  });

  it("resizeElement leaves a ref's box unchanged", () => {
    const s = createEditorStore(rep);
    s.getState().insertComponent("hdr", 1, hdr, 5, 5);
    const past = s.getState().history.past.length;
    s.getState().resizeElement("hdr-1", { x: 0, y: 0, w: 90, h: 40 });
    expect(refOf(s, "hdr-1")).toMatchObject({ x: 5, y: 5, w: 60, h: 20 });
    expect(s.getState().history.past).toHaveLength(past);
  });
});

describe("editor store (phase 3b: group and ungroup)", () => {
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
    { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
    { id: "l", type: "line", x: 50, y: 30, w: 20, h: 0, x2: 30, y2: 30 },   // w/h를 끝점과 맞춰 둔다(apply가 다시 계산하므로 원래 레포트와 비교가 깨지지 않게)
    { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }, { id: "c", type: "rect", x: 10, y: 10, w: 5, h: 5 }] },
    { id: "cond", type: "group", x: 0, y: 80, w: 10, h: 10, visible: "{{ params.show }}", children: [{ id: "d", type: "rect", x: 0, y: 0, w: 5, h: 5 }] },
    { id: "cards", type: "repeater", x: 0, y: 90, w: 100, h: 10, source: "rows", item: { w: 50, h: 10, children: [
      { id: "c1", type: "text", x: 1, y: 1, w: 10, h: 5 }, { id: "c2", type: "text", x: 20, y: 1, w: 10, h: 5 },
    ]}},
  ]});
  type Group = Extract<Element, { type: "group" }>;
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(rep); });

  it("groups same-parent siblings into a new selected group at the first position, as one undo step", () => {
    store.getState().select(["l", "a"]);
    expect(store.getState().groupSelected()).toEqual({ ok: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["group-1", "g", "cond", "cards"]);
    const g = store.getState().findElement("group-1") as Group;
    expect(g).toMatchObject({ x: 10, y: 10, w: 40, h: 20 });
    expect(g.children.map((c) => c.id)).toEqual(["a", "l"]);
    expect(g.children[1]).toMatchObject({ x: 40, y: 20, x2: 20, y2: 20 });
    expect(store.getState().selection).toEqual(["group-1"]);
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().report).toEqual(rep);
  });

  it("groups inside a group and inside a repeater band", () => {
    store.getState().select(["b", "c"]);
    expect(store.getState().groupSelected()).toEqual({ ok: true });
    expect((store.getState().findElement("g") as Group).children.map((e) => e.id)).toEqual(["group-1"]);
    store.getState().select(["c1", "c2"]);
    expect(store.getState().groupSelected()).toEqual({ ok: true });
    expect(store.getState().findParentRepeater("group-2")).toBe("cards");
    expect(store.getState().selection).toEqual(["group-2"]);
  });

  it("returns the reason and changes nothing when the selection is not in one parent", () => {
    store.getState().select(["a", "b"]);
    expect(store.getState().groupSelected()).toEqual({ ok: false, error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" });
    store.getState().select([]);
    expect(store.getState().groupSelected()).toEqual({ ok: false, error: "선택한 요소가 없습니다" });
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().dirty).toBe(false);
  });

  it("ungroups selected groups back into their parent, selects the children, as one undo step", () => {
    store.getState().select(["g"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "l", "b", "c", "cond", "cards"]);
    expect(store.getState().findElement("b")).toMatchObject({ x: 51, y: 51 });
    expect(store.getState().findElement("c")).toMatchObject({ x: 60, y: 60 });
    expect(store.getState().selection).toEqual(["b", "c"]);
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().report).toEqual(rep);
  });

  it("group then ungroup gives back the original report", () => {
    store.getState().select(["a", "l"]);
    store.getState().groupSelected();
    store.getState().ungroupSelected();
    expect(store.getState().report).toEqual(rep);
    expect(store.getState().selection).toEqual(["a", "l"]);
  });

  it("ungroups an outer and an inner group selected together", () => {
    store.getState().select(["b", "c"]);
    store.getState().groupSelected();                         // g > group-1 > b, c
    store.getState().select(["group-1", "g"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "l", "b", "c", "cond", "cards"]);
    expect(store.getState().findElement("c")).toMatchObject({ x: 60, y: 60 });
    expect(store.getState().selection).toEqual(["b", "c"]);
    expect(store.getState().history.past).toHaveLength(2);    // 그룹화 1 + 해제 1
  });

  it("refuses to ungroup a group with a visible condition, or when no group is selected", () => {
    store.getState().select(["g", "cond"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: false, error: "표시 조건(visible)이 있는 그룹은 해제할 수 없습니다: cond" });
    expect(store.getState().findElement("g")).toBeTruthy();   // 함께 고른 다른 그룹도 풀지 않는다
    store.getState().select(["a"]);
    expect(store.getState().ungroupSelected()).toEqual({ ok: false, error: "해제할 그룹을 선택하세요" });
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().selection).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio exec vitest run src/editor/__tests__/store.test.ts`
Expected: FAIL — 기존 25개는 통과, 새 테스트 14개는 `s.getState(...).insertComponent is not a function`, `store.getState(...).groupSelected is not a function` 등으로 실패(`componentMode`는 `undefined`라 `toBeNull` 실패).

- [ ] **Step 3: 스토어 구현**

`apps/studio/src/editor/store.ts`

(1) 4행 core import를 바꾼다:
```ts
import {
  safeParseReport, walkElements, childArrays, collectIds, ElementSchema, componentKey, upgradeRefs, sameParent, groupElements, ungroupElement,
  type Report, type Element, type Page, type Preset, type ComponentBody, type ComponentProp, type Box,
} from "@daport/core";
```

(2) `export type BandTarget = …` 줄 바로 뒤에 추가:
```ts
/** 컴포넌트 편집 화면의 상태. 편집 대상 레포트는 componentToEditReport로 감싼 것이고, 입력값 선언은 레포트 밖에 둔다 */
export type ComponentMode = { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> };
export type ActionResult = { ok: true } | { ok: false; error: string };
```

(3) `EditorState`의 마지막 줄 `applyPreset(preset: Preset): void;          // page + output을 한 커밋으로` 뒤, 닫는 `};` 앞에 추가:
```ts
  /** 컴포넌트 편집 화면이면 편집 중인 컴포넌트 정보, 레포트 편집이면 null. 히스토리 밖 */
  componentMode: ComponentMode | null;
  setComponentProps(props: ComponentProp[]): void;            // 입력값 선언. 저장 대상이므로 dirty
  setSampleProps(values: Record<string, unknown>): void;      // 미리보기용 샘플 값. 저장하지 않으므로 dirty가 아니다
  /** components에 내용을 넣고 (x, y)에 ref를 추가해 선택한다. 컴포넌트 모드에서는 중첩 금지라 아무것도 하지 않는다 */
  insertComponent(id: string, version: number, body: ComponentBody, x: number, y: number): void;
  /** 이 레포트의 인스턴스를 모두 version으로 올린다(core upgradeRefs, 스펙 7.2) */
  updateInstances(id: string, version: number, body: ComponentBody): void;
  /** 선택 요소들을 부모 배열에서 지우고 첫 선택 자리에 ref(box 위치)를 넣는다(스펙 7.3의 4). 조건이 안 맞으면 아무것도 하지 않는다 */
  replaceWithComponent(ids: string[], id: string, version: number, body: ComponentBody, box: Box): void;
  groupSelected(): ActionResult;
  ungroupSelected(): ActionResult;
```

(4) 시그니처를 바꾼다:
```ts
export function createEditorStore(initial: Report, opts?: { componentMode?: ComponentMode | null }) {
```

(5) 초기 상태 줄 `view: { copyIndex: 0, pageInCopy: 0 }, liveData: false, bitmapPreview: false,` 바로 뒤에 추가:
```ts
      componentMode: opts?.componentMode ?? null,
```

(6) `resizeElement`를 찾아 앞 주석과 첫 줄을 아래로 바꾼다(`if (el.type === "line") {` 줄부터는 그대로):
```ts
      // box는 새 경계 상자다. 선은 두 끝점을 옛 상자에서 새 상자로 옮기고 w/h는 apply가 끝점에서 다시 계산한다.
      // 컴포넌트 인스턴스(ref)의 크기는 내용 크기와 같아야 하므로(스키마) 크기 조절을 받지 않는다
      resizeElement: (id, box) => apply((r) => { walkElements(r.elements, (el) => { if (el.id !== id) return;
        if (el.type === "ref") return true;
```

(7) 반환 객체의 마지막 항목 `applyPreset: (preset) => apply(…),` 줄 뒤에 추가:
```ts
      setComponentProps: (props) => { const cm = get().componentMode; if (cm) set({ componentMode: { ...cm, props }, dirty: true }); },
      setSampleProps: (sampleProps) => { const cm = get().componentMode; if (cm) set({ componentMode: { ...cm, sampleProps } }); },
      insertComponent: (id, version, body, x, y) => {
        if (get().componentMode) return;   // 중첩 컴포넌트 금지 (스펙 7.5)
        const ref = ElementSchema.parse({ id: get().allocateId(id), type: "ref", ref: id, version, x: round(x), y: round(y), w: body.w, h: body.h, flow: "once", props: {} });
        apply((r) => { r.components[componentKey(id, version)] = structuredClone(body); r.elements.push(ref); });
        set({ selection: [ref.id] });
      },
      updateInstances: (id, version, body) => apply((r) => {
        const next = upgradeRefs(r, id, version, body);
        r.elements = next.elements; r.components = next.components;
      }),
      replaceWithComponent: (ids, id, version, body, box) => {
        const refId = get().allocateId(id);
        let replaced = false;
        apply((r) => {
          const info = sameParent(r.elements, ids, { allowInTemplate: false, allowRefs: false });
          if ("error" in info) return;
          const ref = ElementSchema.parse({ id: refId, type: "ref", ref: id, version, x: box.x, y: box.y, w: body.w, h: body.h, flow: "once", props: {} });
          for (const i of [...info.indices].reverse()) info.parent.splice(i, 1);
          info.parent.splice(info.indices[0], 0, ref);
          r.components[componentKey(id, version)] = structuredClone(body);
          replaced = true;
        });
        if (replaced) set({ selection: [refId] });
      },
      groupSelected: () => {
        const { report, selection } = get();
        const opts = { allowInTemplate: true, allowRefs: true };
        const check = sameParent(report.elements, selection, opts);
        if ("error" in check) return { ok: false, error: check.error };
        const groupId = get().allocateId("group");
        apply((r) => {
          const info = sameParent(r.elements, selection, opts);
          if ("error" in info) return;
          info.parent.splice(0, info.parent.length, ...groupElements(info.parent, selection, groupId));
        });
        set({ selection: [groupId] });
        return { ok: true };
      },
      ungroupSelected: () => {
        // 문서 순서(바깥 그룹 먼저)로 푼다. 안쪽 그룹을 함께 골랐으면 바깥을 푼 뒤 그 자리에서 다시 찾는다
        const sel = new Set(get().selection);
        const groups: Extract<Element, { type: "group" }>[] = [];
        walkElements(get().report.elements, (el) => { if (sel.has(el.id) && el.type === "group") groups.push(el); });
        if (groups.length === 0) return { ok: false, error: "해제할 그룹을 선택하세요" };
        const conditional = groups.find((g) => g.visible !== undefined);
        if (conditional) return { ok: false, error: `표시 조건(visible)이 있는 그룹은 해제할 수 없습니다: ${conditional.id}` };
        const ids: string[] = [];
        apply((r) => {
          for (const g of groups) {
            walkElements(r.elements, (el, parent) => {
              if (el.id !== g.id || el.type !== "group") return;
              const childIds = el.children.map((c) => c.id);
              parent.splice(0, parent.length, ...ungroupElement(parent, g.id));
              // 앞에서 푼 그룹의 자식이었으면 그 자리를 이 그룹의 자식으로 바꾼다
              const at = ids.indexOf(g.id);
              if (at >= 0) ids.splice(at, 1, ...childIds); else ids.push(...childIds);
              return true;   // parent를 바꿨으므로 더 돌지 않는다
            });
          }
        });
        set({ selection: ids });
        return { ok: true };
      },
```

`apply` 한 번이 커밋 하나이므로 각 액션은 되돌리기 1단위다. `sameParent`가 돌려주는 `parent`는 draft 트리 안의 실제 배열이라 제자리에서 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio exec vitest run src/editor/__tests__/store.test.ts`
Expected: PASS (39 tests).

- [ ] **Step 5: 단축키 실패 테스트 작성**

`apps/studio/src/editor/__tests__/useKeyboard.test.tsx` 끝에 추가(파일 위쪽의 `report`, `setup`, `press`를 그대로 쓴다):
```tsx

describe("useKeyboard: group and ungroup", () => {
  it("groups the selection with cmd/ctrl+g and ungroups with shift, each one undo step", () => {
    const { store } = setup(["a", "b"]);
    expect(press("g", { metaKey: true })).toBe(true);
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["group-1"]);
    expect(store.getState().selection).toEqual(["group-1"]);
    expect(press("G", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a", "b"]);
    expect(store.getState().selection).toEqual(["a", "b"]);
    press("z", { metaKey: true });
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["group-1"]);
    press("z", { metaKey: true });
    expect(store.getState().report).toEqual(report);
  });

  it("alerts the reason when the action is refused", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { store } = setup(["a"]);
    expect(press("G", { metaKey: true, shiftKey: true })).toBe(true);
    expect(alert).toHaveBeenCalledWith("해제할 그룹을 선택하세요");
    expect(store.getState().report).toEqual(report);
    alert.mockRestore();
  });

  it("does nothing without a selection, in preview mode, or inside form controls", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { store, getByLabelText } = setup([]);
    expect(press("g", { metaKey: true })).toBe(false);
    store.getState().select(["a", "b"]);
    expect(press("g", { metaKey: true }, getByLabelText("field"))).toBe(false);
    store.getState().setMode("preview");
    expect(press("g", { metaKey: true })).toBe(false);
    expect(store.getState().report).toEqual(report);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm --filter studio exec vitest run src/editor/__tests__/useKeyboard.test.tsx`
Expected: FAIL — 새 테스트 2개가 실패(`press("g", { metaKey: true })`가 `false`, 요소가 그룹으로 묶이지 않음, alert 호출 없음). 기존 7개와 "does nothing without a selection…"은 통과.

- [ ] **Step 7: 단축키 구현**

`apps/studio/src/editor/useKeyboard.ts`에서 `if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); s.duplicateSelected(); return; }` 줄 바로 뒤에 추가(미리보기 모드 검사 `if (s.mode !== "design") return;` 뒤라 디자인 모드에서만 동작한다):
```ts
      // 그룹화(Cmd/Ctrl+G)·해제(Cmd/Ctrl+Shift+G). 선택이 없으면 브라우저 기본 동작(다음 찾기)을 막지 않는다. 조건이 안 맞으면 사유를 알린다(저장·PDF 실패와 같은 alert)
      if (meta && e.key.toLowerCase() === "g") {
        if (!s.selection.length) return;
        e.preventDefault();
        const res = e.shiftKey ? s.ungroupSelected() : s.groupSelected();
        if (!res.ok) window.alert(res.error);
        return;
      }
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm --filter studio exec vitest run src/editor/__tests__/useKeyboard.test.tsx`
Expected: PASS (10 tests).

Run: `pnpm --filter studio test`
Expected: 전체 통과.

- [ ] **Step 9: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 10: Commit**

```bash
git add apps/studio/src/editor/store.ts apps/studio/src/editor/useKeyboard.ts apps/studio/src/editor/__tests__/store.test.ts apps/studio/src/editor/__tests__/useKeyboard.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 삽입·업데이트·치환과 그룹화·해제 스토어 액션, Cmd+G 단축키

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 라이브러리 패널과 캔버스 드롭

**Files:**
- Create: `apps/studio/src/editor/library/api.ts`
- Create: `apps/studio/src/editor/library/sizeNotice.ts` (크기 변경 확인 문구. Task 11의 RefPanel도 쓴다)
- Create: `apps/studio/src/editor/library/LibraryPanel.tsx`
- Modify: `apps/studio/src/editor/Editor.tsx` (왼쪽 패널 "컴포넌트" 탭, `componentMode` prop을 받아 스토어에 넘기고 컴포넌트 모드에서는 탭을 숨김)
- Modify: `apps/studio/src/editor/canvas/Canvas.tsx` (`COMPONENT_MIME` 드롭 → `fetchComponent` → `insertComponent`)
- Test: `apps/studio/src/editor/library/__tests__/api.test.ts`
- Test: `apps/studio/src/editor/library/__tests__/sizeNotice.test.ts`
- Test: `apps/studio/src/editor/library/__tests__/LibraryPanel.test.tsx`
- Test: `apps/studio/src/editor/__tests__/Editor.test.tsx` (describe 블록 추가)
- Test: `apps/studio/src/editor/canvas/__tests__/Canvas.component.test.tsx`

이 태스크는 Task 7(API 라우트)의 응답 모양과 Task 9(스토어 `insertComponent`·`updateInstances`, `createEditorStore(initial, { componentMode })`), Task 3(core `refsTo`·`parseComponentBody`)을 그대로 쓴다. 테스트는 `fetch`를 가짜로 바꾸므로 서버를 띄우지 않는다.

- [ ] **Step 1: api.ts·sizeNotice 실패 테스트 작성**

`apps/studio/src/editor/library/__tests__/api.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseComponentBody } from "@daport/core";
import { COMPONENT_MIME, fetchComponents, fetchComponent, createComponent, saveComponent, fetchUsage, applyLatest, deleteComponent } from "../api";

afterEach(() => { vi.unstubAllGlobals(); });

const body = parseComponentBody({ name: "헤더", w: 40, h: 10, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 10, value: "H" }] });
const summary = { id: "hdr", name: "헤더", latestVersion: 3, w: 40, h: 10, updatedAt: "2026-09-17T00:00:00.000Z" };

function stub(response: () => Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status });

describe("library api", () => {
  it("uses the component drag mime type", () => {
    expect(COMPONENT_MIME).toBe("application/x-daport-component");
  });
  it("lists and reads components, encoding the id in the path", async () => {
    let fn = stub(json([summary]));
    expect(await fetchComponents()).toEqual([summary]);
    expect(fn.mock.calls[0][0]).toBe("/api/components");
    const detail = { summary, versions: [{ version: 3, hash: "abc", createdAt: "2026-09-17T00:00:00.000Z" }], latest: body };
    fn = stub(json(detail));
    expect(await fetchComponent("a b")).toEqual(detail);
    expect(fn.mock.calls[0][0]).toBe("/api/components/a%20b");
  });
  it("creates with POST {id, body} and saves with PUT {body}", async () => {
    let fn = stub(json({ version: 1, hash: "h1" }, 201));
    expect(await createComponent("hdr", body)).toEqual({ version: 1, hash: "h1" });
    let [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/components");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual({ id: "hdr", body });
    fn = stub(json({ version: 4, hash: "h4", created: true }));
    expect(await saveComponent("hdr", body)).toEqual({ version: 4, hash: "h4", created: true });
    [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/components/hdr");
    expect(init).toMatchObject({ method: "PUT" });
    expect(JSON.parse(init!.body as string)).toEqual({ body });
  });
  it("reads usage, applies the latest version with POST, and deletes with DELETE (204 has no body)", async () => {
    let fn = stub(json([{ reportId: "r", versions: [1, 2] }]));
    expect(await fetchUsage("hdr")).toEqual([{ reportId: "r", versions: [1, 2] }]);
    expect(fn.mock.calls[0][0]).toBe("/api/components/hdr/usage");
    fn = stub(json({ updated: ["r"], skipped: [{ reportId: "x", error: "bad" }] }));
    expect(await applyLatest("hdr")).toEqual({ updated: ["r"], skipped: [{ reportId: "x", error: "bad" }] });
    expect(fn.mock.calls[0]).toEqual(["/api/components/hdr/apply-latest", { method: "POST" }]);
    fn = stub(() => new Response(null, { status: 204 }));
    await expect(deleteComponent("hdr")).resolves.toBeUndefined();
    expect(fn.mock.calls[0]).toEqual(["/api/components/hdr", { method: "DELETE" }]);
  });
  it("throws an Error carrying the server error message, or the HTTP status when the body is not JSON", async () => {
    stub(json({ error: "component in use", reports: ["r"] }, 409));
    await expect(deleteComponent("hdr")).rejects.toThrow("component in use");
    stub(json({ error: "component exists: hdr" }, 409));
    await expect(createComponent("hdr", body)).rejects.toThrow("component exists: hdr");
    stub(json({ error: "not found" }, 404));
    await expect(fetchComponent("nope")).rejects.toThrow("not found");
    stub(() => new Response("<html>oops</html>", { status: 500 }));
    await expect(fetchComponents()).rejects.toThrow("HTTP 500");
  });
});
```

`apps/studio/src/editor/library/__tests__/sizeNotice.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sizeChangeNotice } from "../sizeNotice";

describe("sizeChangeNotice", () => {
  it("returns null when every instance already has the new size", () => {
    expect(sizeChangeNotice([{ w: 180, h: 24 }, { w: 180, h: 24 }], { w: 180, h: 24 })).toBeNull();
    expect(sizeChangeNotice([], { w: 180, h: 24 })).toBeNull();
  });
  it("lists each distinct old size once and warns about overlap", () => {
    expect(sizeChangeNotice([{ w: 180, h: 24 }, { w: 180, h: 24 }], { w: 180, h: 30 })).toBe("180×24 → 180×30, 아래 요소와 겹칠 수 있습니다");
    expect(sizeChangeNotice([{ w: 180, h: 24 }, { w: 90, h: 12.5 }, { w: 180, h: 30 }], { w: 180, h: 30 })).toBe("180×24, 90×12.5 → 180×30, 아래 요소와 겹칠 수 있습니다");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/library/__tests__/api.test.ts src/editor/library/__tests__/sizeNotice.test.ts`
Expected: FAIL — `Failed to resolve import "../api"` / `"../sizeNotice"`.

- [ ] **Step 3: api.ts·sizeNotice 구현**

`apps/studio/src/editor/library/api.ts`:
```ts
import type { ComponentBody } from "@daport/core";
// 타입만 가져온다. 저장소 모듈은 DB 클라이언트를 끌어오므로 값 import를 하면 클라이언트 번들이 깨진다
import type { ComponentSummary, ComponentDetail } from "@/lib/component-store";
import type { Usage } from "@/lib/component-usage";

/** 라이브러리 패널 → 캔버스 드래그 데이터. 값은 컴포넌트 id (스펙 7.1) */
export const COMPONENT_MIME = "application/x-daport-component";

const JSON_HEADERS = { "content-type": "application/json" };
const itemPath = (id: string) => `/api/components/${encodeURIComponent(id)}`;

/** 실패하면 서버가 준 error 메시지(없으면 HTTP 상태)로 Error를 던진다. 204는 본문이 없다 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const r = init ? await fetch(url, init) : await fetch(url);
  if (r.status === 204) return undefined as T;
  const body: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : `HTTP ${r.status}`);
  }
  return body as T;
}

export async function fetchComponents(): Promise<ComponentSummary[]> {
  return request<ComponentSummary[]>("/api/components");
}
export async function fetchComponent(id: string): Promise<ComponentDetail> {
  return request<ComponentDetail>(itemPath(id));
}
export async function createComponent(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }> {
  return request("/api/components", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id, body }) });
}
export async function saveComponent(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }> {
  return request(itemPath(id), { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ body }) });
}
export async function fetchUsage(id: string): Promise<Usage[]> {
  return request<Usage[]>(`${itemPath(id)}/usage`);
}
export async function applyLatest(id: string): Promise<{ updated: string[]; skipped: { reportId: string; error: string }[] }> {
  return request(`${itemPath(id)}/apply-latest`, { method: "POST" });
}
export async function deleteComponent(id: string): Promise<void> {
  await request<void>(itemPath(id), { method: "DELETE" });
}
```

`apps/studio/src/editor/library/sizeNotice.ts`:
```ts
type Sized = { w: number; h: number };

const num = (v: number) => String(Math.round(v * 100) / 100);
const label = (s: Sized) => `${num(s.w)}×${num(s.h)}`;
const differs = (a: Sized, b: Sized) => Math.abs(a.w - b.w) > 1e-6 || Math.abs(a.h - b.h) > 1e-6;

/**
 * 인스턴스를 새 버전으로 올릴 때 크기가 바뀌는 인스턴스가 있으면 확인 대화상자 문구를, 없으면 null을 준다 (스펙 7.2).
 * 예: "180×24 → 180×30, 아래 요소와 겹칠 수 있습니다". 옛 크기가 여럿이면 쉼표로 한 번씩 적는다
 */
export function sizeChangeNotice(refs: Sized[], body: Sized): string | null {
  const old = [...new Set(refs.filter((r) => differs(r, body)).map(label))];
  if (old.length === 0) return null;
  return `${old.join(", ")} → ${label(body)}, 아래 요소와 겹칠 수 있습니다`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/library/__tests__/api.test.ts src/editor/library/__tests__/sizeNotice.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: LibraryPanel 실패 테스트 작성**

`apps/studio/src/editor/library/__tests__/LibraryPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { parseReport, parseComponentBody, type ComponentBody, type Element } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { LibraryPanel } from "../LibraryPanel";
import { COMPONENT_MIME } from "../api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const v1 = parseComponentBody({ name: "헤더", w: 40, h: 10, props: [{ name: "title", type: "string", default: "제목" }, { name: "old", type: "string", default: "" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 10, value: "{{ props.title }}" }] });
const body = (w: number, h: number): ComponentBody => parseComponentBody({ name: "헤더", w, h, props: [{ name: "title", type: "string", default: "제목" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w, h, value: "{{ props.title }}" }] });
const ref = (id: string, y: number) => ({ id, type: "ref", ref: "hdr", version: 1, x: 10, y, w: 40, h: 10, props: { title: "A", old: "x" } });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, components: { "hdr@1": v1 }, elements: [ref("hdr-1", 10), ref("hdr-2", 40)] });

const summaries = [
  { id: "hdr", name: "헤더", latestVersion: 3, w: 40, h: 12, updatedAt: "2026-09-17T00:00:00.000Z" },
  { id: "sig", name: "서명란", latestVersion: 1, w: 60, h: 20, updatedAt: "2026-09-17T00:00:00.000Z" },
];
const detail = (b: ComponentBody, latestVersion = 3) => ({ summary: { ...summaries[0], latestVersion, w: b.w, h: b.h }, versions: [], latest: b });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

/** "METHOD url" → 응답. 등록하지 않은 요청은 500으로 실패시켜 테스트가 알아채게 한다 */
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    return routes[key] ? routes[key](init) : json({ error: `unexpected ${key}` }, 500);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const called = (fn: ReturnType<typeof stubFetch>, key: string) => fn.mock.calls.some(([url, init]) => `${init?.method ?? "GET"} ${url}` === key);

function setup(routes: Record<string, (init?: RequestInit) => Response>, store: EditorStore = createEditorStore(report)) {
  const fetchMock = stubFetch({ "GET /api/components": () => json(summaries), ...routes });
  const utils = render(<EditorContext.Provider value={store}><LibraryPanel /></EditorContext.Provider>);
  const openMenu = async (name: string) => {
    fireEvent.click(utils.getByRole("button", { name: `${name} 메뉴` }));
    return utils.findByRole("menu");
  };
  const refs = () => store.getState().report.elements.filter((e): e is Extract<Element, { type: "ref" }> => e.type === "ref");
  return { store, fetchMock, openMenu, refs, ...utils };
}

describe("LibraryPanel", () => {
  it("lists name, latest version and size, and puts the component id on dragstart", async () => {
    const { findByText, getByText, getByTestId } = setup({});
    expect(await findByText("헤더")).toBeTruthy();
    expect(getByText("v3")).toBeTruthy();
    expect(getByText("hdr · 40×12mm")).toBeTruthy();
    expect(getByText("서명란")).toBeTruthy();
    expect(getByText("sig · 60×20mm")).toBeTruthy();
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: "" };
    fireEvent.dragStart(getByTestId("component-sig"), { dataTransfer });
    expect(data[COMPONENT_MIME]).toBe("sig");
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(getByTestId("component-sig").getAttribute("draggable")).toBe("true");
  });
  it("shows the server error when the list request fails, and an empty hint for an empty library", async () => {
    const failed = setup({ "GET /api/components": () => json({ error: "db down" }, 500) });
    expect(await failed.findByText(/db down/)).toBeTruthy();
    cleanup();
    const empty = setup({ "GET /api/components": () => json([]) });
    expect(await empty.findByText("등록된 컴포넌트가 없습니다")).toBeTruthy();
  });
  it("편집 opens the component editor in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { findByText, openMenu, getByRole } = setup({ "GET /api/components/hdr/usage": () => json([]) });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "편집" }));
    expect(open).toHaveBeenCalledWith("/components/hdr", "_blank", "noopener");
  });
  it("이 레포트의 인스턴스 모두 최신으로: confirms a size change, then updates every instance as one undo step", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByText, openMenu, getByRole, store, refs } = setup({
      "GET /api/components/hdr/usage": () => json([]),
      "GET /api/components/hdr": () => json(detail(body(40, 12))),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    await waitFor(() => expect(refs().map((r) => r.version)).toEqual([3, 3]));
    expect(confirm).toHaveBeenCalledWith("40×10 → 40×12, 아래 요소와 겹칠 수 있습니다");
    expect(refs().map((r) => [r.id, r.w, r.h, r.props])).toEqual([["hdr-1", 40, 12, { title: "A" }], ["hdr-2", 40, 12, { title: "A" }]]);
    expect(Object.keys(store.getState().report.components)).toEqual(["hdr@3"]);
    expect(store.getState().history.past).toHaveLength(1);
    expect(await findByText("인스턴스 2개를 v3(으)로 올렸습니다")).toBeTruthy();
  });
  it("keeps the instances when the size-change confirm is cancelled, and skips the confirm when the size is unchanged", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let latest = body(40, 12);
    const { findByText, openMenu, getByRole, store, refs } = setup({
      "GET /api/components/hdr/usage": () => json([]),
      "GET /api/components/hdr": () => json(detail(latest)),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(refs().map((r) => r.version)).toEqual([1, 1]);
    expect(store.getState().history.past).toHaveLength(0);

    latest = body(40, 10);
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    await waitFor(() => expect(refs().map((r) => r.version)).toEqual([3, 3]));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("tells when the report has no instance of the component or they are already latest, without changing the report", async () => {
    const { findByText, openMenu, getByRole, store, fetchMock } = setup({
      "GET /api/components/sig/usage": () => json([]),
      "GET /api/components/hdr/usage": () => json([]),
      "GET /api/components/hdr": () => json(detail(body(40, 10), 1)),
    });
    await findByText("서명란");
    await openMenu("서명란");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    expect(await findByText("이 레포트에 이 컴포넌트의 인스턴스가 없습니다")).toBeTruthy();
    expect(called(fetchMock, "GET /api/components/sig")).toBe(false);
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    expect(await findByText("이미 최신 버전(v1)입니다")).toBeTruthy();
    expect(store.getState().history.past).toHaveLength(0);
  });
  it("모든 레포트에 최신 적용: confirms with the usage count, applies, summarizes and asks to reload when this report changed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByText, findByRole, openMenu, getByRole, fetchMock } = setup({
      "GET /api/components/hdr/usage": () => json([{ reportId: "r", versions: [1] }, { reportId: "other", versions: [2] }]),
      "POST /api/components/hdr/apply-latest": () => json({ updated: ["r"], skipped: [{ reportId: "other", error: "schema: overlap" }] }),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "모든 레포트에 최신 적용" }));
    await waitFor(() => expect(called(fetchMock, "POST /api/components/hdr/apply-latest")).toBe(true));
    expect(confirm).toHaveBeenCalledWith("이 컴포넌트를 쓰는 레포트 2개에 최신 버전(v3)을 적용할까요? 저장된 레포트가 바뀝니다.");
    const status = await findByText(/적용 1개, 건너뜀 1개/);
    expect(status.textContent).toContain("other: schema: overlap");
    expect((await findByRole("alert")).textContent).toBe("저장된 레포트가 바뀌었습니다. 새로 불러오세요");
  });
  it("sends nothing when the apply confirm is cancelled, and shows no reload notice when this report was not updated", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { findByText, openMenu, getByRole, queryByRole, fetchMock } = setup({
      "GET /api/components/hdr/usage": () => json([{ reportId: "other", versions: [1] }]),
      "POST /api/components/hdr/apply-latest": () => json({ updated: ["other"], skipped: [] }),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "모든 레포트에 최신 적용" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(called(fetchMock, "POST /api/components/hdr/apply-latest")).toBe(false);
    confirm.mockReturnValue(true);
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "모든 레포트에 최신 적용" }));
    expect(await findByText(/적용 1개, 건너뜀 0개/)).toBeTruthy();
    expect(queryByRole("alert")).toBeNull();
  });
  it("disables 삭제 with the using report ids while in use, and deletes an unused component after confirming", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    let list = summaries;
    const { findByText, queryByText, openMenu, getByRole, fetchMock } = setup({
      "GET /api/components": () => json(list),
      "GET /api/components/hdr/usage": () => json([{ reportId: "r", versions: [1] }, { reportId: "q", versions: [2] }]),
      "GET /api/components/sig/usage": () => json([]),
      "DELETE /api/components/sig": () => { list = [summaries[0]]; return new Response(null, { status: 204 }); },
    });
    await findByText("헤더");
    await openMenu("헤더");
    await waitFor(() => expect(getByRole("menuitem", { name: "삭제" }).getAttribute("title")).toBe("사용 중: r, q"));
    expect((getByRole("menuitem", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(true);

    await openMenu("서명란");
    await waitFor(() => expect((getByRole("menuitem", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole("menuitem", { name: "삭제" }));
    await waitFor(() => expect(queryByText("서명란")).toBeNull());
    expect(confirm).toHaveBeenCalledWith('컴포넌트 "서명란"(sig)을(를) 삭제할까요? 되돌릴 수 없습니다.');
    expect(called(fetchMock, "DELETE /api/components/sig")).toBe(true);
  });
  it("shows the server error when delete fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByText, openMenu, getByRole } = setup({
      "GET /api/components/sig/usage": () => json([]),
      "DELETE /api/components/sig": () => json({ error: "component in use", reports: ["z"] }, 409),
    });
    await findByText("서명란");
    await openMenu("서명란");
    await waitFor(() => expect((getByRole("menuitem", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole("menuitem", { name: "삭제" }));
    expect(await findByText("component in use")).toBeTruthy();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/library/__tests__/LibraryPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "../LibraryPanel"`.

- [ ] **Step 7: LibraryPanel 구현**

`apps/studio/src/editor/library/LibraryPanel.tsx`:
```tsx
"use client";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { refsTo } from "@daport/core";
import type { ComponentSummary } from "@/lib/component-store";
import type { Usage } from "@/lib/component-usage";
import { useEditor } from "../store";
import { COMPONENT_MIME, fetchComponents, fetchComponent, fetchUsage, applyLatest, deleteComponent } from "./api";
import { sizeChangeNotice } from "./sizeNotice";

const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
const item = "text-left text-xs px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 컴포넌트 라이브러리: 목록, 캔버스로 끌어다 놓기, 항목 메뉴 (스펙 7.1) */
export function LibraryPanel() {
  const report = useEditor((s) => s.report);
  const updateInstances = useEditor((s) => s.updateInstances);
  const [items, setItems] = useState<ComponentSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadNotice, setReloadNotice] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const openRef = useRef<string | null>(null);   // 늦게 도착한 사용처 응답이 다른 항목의 메뉴를 덮지 않게

  const load = useCallback(async () => {
    try { setItems(await fetchComponents()); setFailure(null); } catch (e) { setFailure(message(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const closeMenu = () => { openRef.current = null; setOpenId(null); };
  const toggleMenu = async (id: string) => {
    if (openRef.current === id) { closeMenu(); return; }
    openRef.current = id; setOpenId(id); setUsage(null);
    try {
      const u = await fetchUsage(id);
      if (openRef.current === id) setUsage(u);
    } catch (e) { if (openRef.current === id) setStatus(message(e)); }
  };

  const onDragStart = (e: DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData(COMPONENT_MIME, id);
    e.dataTransfer.effectAllowed = "copy";
  };

  const edit = (c: ComponentSummary) => {
    closeMenu();
    window.open(`/components/${encodeURIComponent(c.id)}`, "_blank", "noopener");
  };

  /** 이 레포트 안 인스턴스를 라이브러리 최신 버전으로 (스토어 updateInstances = core upgradeRefs, 되돌리기 1단위) */
  const updateHere = async (c: ComponentSummary) => {
    closeMenu(); setStatus(null);
    const refs = refsTo(report, c.id);
    if (refs.length === 0) { setStatus("이 레포트에 이 컴포넌트의 인스턴스가 없습니다"); return; }
    try {
      const detail = await fetchComponent(c.id);
      const version = detail.summary.latestVersion;
      if (refs.every((r) => r.version === version)) { setStatus(`이미 최신 버전(v${version})입니다`); return; }
      const notice = sizeChangeNotice(refs, detail.latest);
      if (notice && !window.confirm(notice)) return;
      updateInstances(c.id, version, detail.latest);
      setStatus(`인스턴스 ${refs.length}개를 v${version}(으)로 올렸습니다`);
    } catch (e) { setStatus(message(e)); }
  };

  /** 저장된 모든 레포트에 최신 적용. 열린 레포트가 바뀌었으면 새로 불러오라고 알린다 */
  const applyAll = async (c: ComponentSummary) => {
    closeMenu(); setStatus(null); setReloadNotice(false);
    try {
      const users = await fetchUsage(c.id);
      if (!window.confirm(`이 컴포넌트를 쓰는 레포트 ${users.length}개에 최신 버전(v${c.latestVersion})을 적용할까요? 저장된 레포트가 바뀝니다.`)) return;
      const res = await applyLatest(c.id);
      setStatus([`적용 ${res.updated.length}개, 건너뜀 ${res.skipped.length}개`, ...res.skipped.map((s) => `${s.reportId}: ${s.error}`)].join("\n"));
      if (res.updated.includes(report.id)) setReloadNotice(true);
    } catch (e) { setStatus(message(e)); }
  };

  const remove = async (c: ComponentSummary) => {
    closeMenu(); setStatus(null);
    if (!window.confirm(`컴포넌트 "${c.name}"(${c.id})을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteComponent(c.id);
      await load();
    } catch (e) { setStatus(message(e)); }
  };

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">컴포넌트</div>
        <button className={btn} onClick={() => void load()}>새로고침</button>
      </div>
      {failure && <div className="text-xs text-red-700">목록을 불러오지 못했습니다: {failure}</div>}
      {items && items.length === 0 && <div className="text-xs text-neutral-400">등록된 컴포넌트가 없습니다</div>}
      {reloadNotice && <div role="alert" className="text-xs bg-amber-100 border border-amber-400 rounded px-2 py-1">저장된 레포트가 바뀌었습니다. 새로 불러오세요</div>}
      {status && <div role="status" className="text-xs text-neutral-700 whitespace-pre-line">{status}</div>}
      <ul className="flex flex-col gap-1">
        {items?.map((c) => {
          const inUse = usage !== null && usage.length > 0;
          return (
            <li key={c.id} data-testid={`component-${c.id}`} draggable onDragStart={(e) => onDragStart(e, c.id)}
              className="border rounded px-2 py-1 text-xs cursor-grab hover:bg-neutral-50">
              <div className="flex items-center gap-1">
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-neutral-500">v{c.latestVersion}</span>
                <button aria-label={`${c.name} 메뉴`} className="px-1 rounded hover:bg-neutral-200" onClick={() => void toggleMenu(c.id)}>⋯</button>
              </div>
              <div className="text-neutral-400">{`${c.id} · ${c.w}×${c.h}mm`}</div>
              {openId === c.id && (
                <div role="menu" className="mt-1 flex flex-col border rounded bg-white">
                  <button role="menuitem" className={item} onClick={() => edit(c)}>편집</button>
                  <button role="menuitem" className={item} onClick={() => void updateHere(c)}>이 레포트의 인스턴스 모두 최신으로</button>
                  <button role="menuitem" className={item} onClick={() => void applyAll(c)}>모든 레포트에 최신 적용</button>
                  {/* 사용처를 받기 전에는 막아 둔다. 사용 중이면 툴팁에 레포트 id (스펙 7.1) */}
                  <button role="menuitem" className={item} disabled={usage === null || inUse}
                    title={inUse ? `사용 중: ${usage!.map((u) => u.reportId).join(", ")}` : undefined} onClick={() => void remove(c)}>삭제</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 8: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/library/__tests__/LibraryPanel.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 9: Editor 탭 실패 테스트 추가**

`apps/studio/src/editor/__tests__/Editor.test.tsx` 파일 맨 끝(기존 `describe("Editor", …)` 블록 뒤)에 추가한다. 위쪽 import와 `vi.mock`, `report`, `afterEach`는 그대로 쓴다:
```tsx
describe("Editor 컴포넌트 탭", () => {
  const summary = { id: "hdr", name: "회사 헤더", latestVersion: 2, w: 180, h: 24, updatedAt: "2026-09-17T00:00:00.000Z" };
  const stubFetch = () => vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(JSON.stringify(url === "/api/components" ? [summary] : []), { status: 200 })));

  it("shows the component library in a third left tab", async () => {
    stubFetch();
    render(<Editor initial={report} />);
    expect(screen.getByRole("button", { name: "요소" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "데이터" })).toBeTruthy();
    expect(screen.queryByText("회사 헤더")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "컴포넌트" }));
    expect(await screen.findByText("회사 헤더")).toBeTruthy();
    expect(screen.queryByText("+ 텍스트")).toBeNull();               // 팔레트 대신 라이브러리
  });

  it("hides the component tab in component mode (no nested components)", () => {
    stubFetch();
    render(<Editor initial={report} componentMode={{ componentId: "hdr", version: 2, props: [], sampleProps: {} }} />);
    expect(screen.getByRole("button", { name: "요소" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "컴포넌트" })).toBeNull();
  });
});
```

- [ ] **Step 10: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/Editor.test.tsx`
Expected: FAIL — 첫 테스트가 `Unable to find an accessible element with the role "button" and name "컴포넌트"`로 실패한다. 두 번째 테스트는 아직 탭이 두 개뿐이라 통과한다(prop을 무시해도 결과가 같다).

- [ ] **Step 11: Editor에 컴포넌트 탭과 componentMode prop 추가**

`apps/studio/src/editor/Editor.tsx`에서:

1) import 블록의 `import { createEditorStore, EditorContext, useEditor, type EditorStore } from "./store";`를 다음으로 바꾸고, `import { DataPanel } from "./data/DataPanel";` 아래에 LibraryPanel import를 추가한다:
```tsx
import { createEditorStore, EditorContext, useEditor, type EditorStore, type EditorState } from "./store";
```
```tsx
import { LibraryPanel } from "./library/LibraryPanel";
```

2) `export function Editor({ initial }: { initial: Report }) {`부터 `const [tab, setTab] = useState<"elements" | "data">("elements");`까지 네 줄을 다음으로 바꾼다:
```tsx
type Tab = "elements" | "data" | "components";
const TAB_LABEL: Record<Tab, string> = { elements: "요소", data: "데이터", components: "컴포넌트" };

/** componentMode가 있으면 컴포넌트 전용 편집 화면이다(스펙 7.5). 중첩 금지라 라이브러리 탭을 두지 않는다 */
export function Editor({ initial, componentMode }: { initial: Report; componentMode?: EditorState["componentMode"] }) {
  const store = useMemo(() => createEditorStore(initial, componentMode ? { componentMode } : undefined), [initial, componentMode]);
  const report = useStore(store, (s) => s.report);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<Tab>("elements");
  const tabs: Tab[] = componentMode ? ["elements", "data"] : ["elements", "data", "components"];
```

3) 왼쪽 aside의 탭 버튼과 본문 두 줄
```tsx
              {(["elements", "data"] as const).map((t) => (
                <button key={t} className={`flex-1 py-1 ${tab === t ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setTab(t)}>{t === "elements" ? "요소" : "데이터"}</button>
              ))}
            </div>
            {tab === "elements" ? <ElementPalette /> : <DataPanel reportId={initial.id} />}
```
을 다음으로 바꾼다:
```tsx
              {tabs.map((t) => (
                <button key={t} className={`flex-1 py-1 ${tab === t ? "font-semibold bg-neutral-100" : "text-neutral-500"}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
              ))}
            </div>
            {tab === "elements" && <ElementPalette />}
            {tab === "data" && <DataPanel reportId={initial.id} />}
            {tab === "components" && <LibraryPanel />}
```

- [ ] **Step 12: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/Editor.test.tsx`
Expected: PASS (기존 2개 + 새 2개).

- [ ] **Step 13: 캔버스 컴포넌트 드롭 실패 테스트 작성**

`apps/studio/src/editor/canvas/__tests__/Canvas.component.test.tsx`:
```tsx
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { parseReport, parseComponentBody } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";
import { COMPONENT_MIME } from "../../library/api";
import { DRAG_MIME } from "../../data/bindings";

const body = parseComponentBody({ name: "헤더", w: 40, h: 10, props: [{ name: "title", type: "string", default: "제목" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 10, value: "{{ props.title }}" }] });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 60, w: 20, h: 5, value: "A" },
]});
const detail = { summary: { id: "hdr", name: "헤더", latestVersion: 3, w: 40, h: 10, updatedAt: "2026-09-17T00:00:00.000Z" }, versions: [], latest: body };
const px = (mm: number) => mmToPxScaled(mm, 1);
const dt = (mime: string, value: string) => ({ types: [mime], getData: (k: string) => (k === mime ? value : ""), dropEffect: "copy" });

function mount(store: EditorStore) {
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  return { ...utils, q: (sel: string) => utils.container.querySelector(sel) as HTMLElement };
}
function stubFetch(response: () => Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", fn);
  return fn;
}

// Canvas.drop.test.tsx와 같은 이유로 DragEvent 대역을 둔다 (jsdom에는 DragEvent가 없어 clientX/clientY가 사라진다)
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  class DragEventStub extends MouseEvent { constructor(type: string, init: MouseEventInit = {}) { super(type, init); } }
  (window as unknown as { DragEvent: unknown }).DragEvent = DragEventStub;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Canvas component drop", () => {
  it("accepts the component mime on dragover", () => {
    const { q } = mount(createEditorStore(report));
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: dt(COMPONENT_MIME, "") })).toBe(false);   // preventDefault = 놓기 허용
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: { types: ["text/plain"], getData: () => "" } })).toBe(true);
  });
  it("fetches the latest version and inserts a ref at the snapped drop point as one undo step", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(detail), { status: 200 }));
    const store = createEditorStore(report);
    const { q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: px(20.3), clientY: px(10.2), dataTransfer: dt(COMPONENT_MIME, "hdr") });
    await waitFor(() => expect(store.getState().findElement("hdr-1")).toBeDefined());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/components/hdr");
    expect(store.getState().findElement("hdr-1")).toMatchObject({ type: "ref", ref: "hdr", version: 3, x: 20.5, y: 10, w: 40, h: 10, flow: "once", props: {} });
    expect(store.getState().report.components).toEqual({ "hdr@3": body });
    expect(store.getState().history.past).toHaveLength(1);
    expect(q('[data-testid="drop-warning"]')).toBeNull();
  });
  it("shows the server error and leaves the report unchanged when the component cannot be fetched", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "component not found: nope" }), { status: 404 }));
    const store = createEditorStore(report);
    const { findByTestId, q } = mount(store);
    fireEvent.drop(q(".dp-page"), { clientX: px(20), clientY: px(10), dataTransfer: dt(COMPONENT_MIME, "nope") });
    expect((await findByTestId("drop-warning")).textContent).toBe("컴포넌트를 넣지 못했습니다: component not found: nope");
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a"]);
    expect(store.getState().history.past).toHaveLength(0);
  });
  it("refuses component drops in component mode but still accepts data fields", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify(detail), { status: 200 }));
    const store = createEditorStore(report, { componentMode: { componentId: "sig", version: 1, props: [], sampleProps: {} } });
    const { q, findByTestId } = mount(store);
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: dt(COMPONENT_MIME, "") })).toBe(true);
    expect(fireEvent.dragOver(q(".dp-page"), { dataTransfer: dt(DRAG_MIME, "") })).toBe(false);
    fireEvent.drop(q(".dp-page"), { clientX: px(20), clientY: px(10), dataTransfer: dt(COMPONENT_MIME, "hdr") });
    expect((await findByTestId("drop-warning")).textContent).toBe("컴포넌트 안에는 컴포넌트를 넣을 수 없습니다");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().report.elements.map((e) => e.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 14: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.component.test.tsx`
Expected: FAIL — 첫 테스트의 dragOver가 `true`(허용하지 않음), 드롭 테스트는 `hdr-1`이 생기지 않아 `waitFor` 시간 초과, 오류·컴포넌트 모드 테스트는 `drop-warning`을 찾지 못함.

- [ ] **Step 15: Canvas에 컴포넌트 드롭 구현**

`apps/studio/src/editor/canvas/Canvas.tsx`에서:

1) import 블록 맨 끝 `import { resolveDrop, DRAG_MIME, type DragField, type DropTarget } from "../data/bindings";` 아래에 추가한다:
```tsx
import { COMPONENT_MIME, fetchComponent } from "../library/api";
```

2) `const findParentRepeater = useEditor((s) => s.findParentRepeater);` 아래에 추가한다:
```tsx
  const insertComponent = useEditor((s) => s.insertComponent);
  const componentMode = useEditor((s) => s.componentMode);
```

3) 기존 `onDragOver`·`onDrop` 두 정의
```tsx
  const onDragOver = (e: DragEvent<HTMLDivElement>) => { if (Array.from(e.dataTransfer.types).includes(DRAG_MIME)) e.preventDefault(); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const field = JSON.parse(raw) as DragField;
    const origin = e.currentTarget.querySelector(".dp-page")?.getBoundingClientRect();
    const x = snapMm(pxToMm(e.clientX - (origin?.left ?? 0), zoom)), y = snapMm(pxToMm(e.clientY - (origin?.top ?? 0), zoom));
    const result = resolveDrop(field, dropTargetAt(e, x, y), report, allocateId);
```
를 다음으로 바꾼다(`result` 줄 아래의 `addElement`·`addColumn`·`setWarning` 세 줄과 닫는 `};`는 그대로 둔다):
```tsx
  // 컴포넌트 편집 화면에서는 라이브러리 컴포넌트를 받지 않는다 (중첩 금지, 스펙 7.5)
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(DRAG_MIME) || (!componentMode && types.includes(COMPONENT_MIME))) e.preventDefault();
  };
  /** 놓인 자리(페이지 좌상단 기준 mm, 0.5mm 스냅) */
  const dropPoint = (e: DragEvent<HTMLDivElement>) => {
    const origin = e.currentTarget.querySelector(".dp-page")?.getBoundingClientRect();
    return { x: snapMm(pxToMm(e.clientX - (origin?.left ?? 0), zoom)), y: snapMm(pxToMm(e.clientY - (origin?.top ?? 0), zoom)) };
  };
  /** 라이브러리 최신 버전 내용을 받아 놓은 자리에 인스턴스로 넣는다 (스펙 7.1). 인스턴스는 늘 최상위에 들어간다 */
  const dropComponent = async (id: string, x: number, y: number) => {
    try {
      const detail = await fetchComponent(id);
      insertComponent(id, detail.summary.latestVersion, detail.latest, x, y);
      setWarning(null);
    } catch (err) {
      setWarning(`컴포넌트를 넣지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const componentId = e.dataTransfer.getData(COMPONENT_MIME);
    if (componentId) {
      e.preventDefault();
      if (componentMode) { setWarning("컴포넌트 안에는 컴포넌트를 넣을 수 없습니다"); return; }
      const { x, y } = dropPoint(e);
      void dropComponent(componentId, x, y);
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const field = JSON.parse(raw) as DragField;
    const { x, y } = dropPoint(e);
    const result = resolveDrop(field, dropTargetAt(e, x, y), report, allocateId);
```

- [ ] **Step 16: 통과 확인 (studio 전체)**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.component.test.tsx && pnpm --filter studio test`
Expected: 새 테스트 4개 PASS, studio 전체 테스트 통과(기존 `Canvas.drop.test.tsx`의 필드 드롭 동작 그대로).

- [ ] **Step 17: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 18: Commit**

```bash
git add apps/studio/src/editor/library apps/studio/src/editor/Editor.tsx apps/studio/src/editor/canvas/Canvas.tsx apps/studio/src/editor/__tests__/Editor.test.tsx apps/studio/src/editor/canvas/__tests__/Canvas.component.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 라이브러리 패널과 캔버스 드롭

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: RefPanel과 캔버스 인스턴스 선택

**Files:**
- Create: `apps/studio/src/editor/panels/RefPanel.tsx`
- Modify: `apps/studio/src/editor/panels/PropertyPanel.tsx` (`ref`면 X·Y·visible·flow만 두고 W·H·스타일을 숨기고 RefPanel에 맡김)
- Modify: `apps/studio/src/editor/canvas/pages.ts` (`primaryItem`이 `refBox` 항목을 먼저 고름)
- Modify: `apps/studio/src/editor/canvas/Canvas.tsx` (인스턴스 안쪽 클릭 → 인스턴스 선택, ref 크기 조절 핸들 숨김, 더블클릭 → 새 탭 `/components/:id`)
- Test: `apps/studio/src/editor/canvas/__tests__/pages.test.ts` (케이스 추가)
- Test: `apps/studio/src/editor/__tests__/RefPanel.test.tsx`
- Test: `apps/studio/src/editor/canvas/__tests__/Canvas.ref.test.tsx`

이 태스크는 Task 4의 레이아웃 결과(펼친 항목의 `elementId` = 인스턴스 id, 인스턴스마다 첫 항목으로 `role: "refBox"` 투명 rect), Task 9의 스토어 `updateInstances`, Task 10의 `editor/library/api.ts`(`fetchComponent`)와 `editor/library/sizeNotice.ts`(`sizeChangeNotice`)를 쓴다.

지금 Canvas의 `pickElementId`는 `primaryItem`이 채우기 없는 rect이면 선 근처일 때만 고른다. `refBox`는 채우기 없는 rect이므로 그대로 두면 인스턴스 안쪽을 눌러도 선택되지 않는다. 그래서 `refBox` 역할이거나 요소가 `ref`이면 곧바로 그 id를 고르게 한다. 선택 상자는 `boxes`가 `primaryItem`으로 계산하므로 `primaryItem`이 `refBox`를 먼저 고르면 인스턴스 전체 상자가 된다. 핸들은 `SelectionBox`의 `single`이 켤 때만 그리므로 ref면 `single`을 끈다(이동은 그대로 된다).

- [ ] **Step 1: primaryItem 실패 테스트 추가**

`apps/studio/src/editor/canvas/__tests__/pages.test.ts`의 `describe("pages", …)` 안, `it("primaryItem picks the first non-cell/border item of the element", …)` 바로 뒤에 추가한다:
```ts
  it("primaryItem picks a component instance's refBox even when a child item comes first", () => {
    const style = {} as Page["items"][number]["style"];
    const p = pg(0, 0, 0, [
      { kind: "text", elementId: "hdr", instance: "hdr/title", x: 12, y: 12, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
      { kind: "rect", elementId: "hdr", role: "refBox", x: 10, y: 10, w: 40, h: 10, style },
      { kind: "rect", elementId: "std", role: "flowBox", instance: "std/t", x: 0, y: 30, w: 50, h: 20, style },
      { kind: "rect", elementId: "std", role: "refBox", x: 0, y: 30, w: 50, h: 20, style },
    ]);
    expect(primaryItem(p, "hdr")).toMatchObject({ role: "refBox", x: 10, w: 40 });
    expect(primaryItem(p, "std")).toMatchObject({ role: "refBox" });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/pages.test.ts`
Expected: FAIL — `primaryItem(p, "hdr")`가 `instance: "hdr/title"` 텍스트 항목을 돌려준다.

- [ ] **Step 3: primaryItem 구현**

`apps/studio/src/editor/canvas/pages.ts`의 `primaryItem` 함수(주석 포함)를 다음으로 바꾼다:
```ts
/**
 * 선택 상자로 쓰는 항목. 컴포넌트 인스턴스는 refBox(인스턴스 전체 상자, 스펙 5.3)를 먼저 고른다.
 * 그 밖에는 문서 순서 첫 항목이며 표 셀·테두리는 제외한다 (표·반복 영역은 flowBox, 반복 자식은 첫 인스턴스)
 */
export function primaryItem(page: Page, elementId: string): PlacedItem | undefined {
  return page.items.find((i) => i.elementId === elementId && i.role === "refBox")
    ?? page.items.find((i) => i.elementId === elementId && i.role !== "cell" && i.role !== "border");
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/pages.test.ts`
Expected: PASS.

- [ ] **Step 5: RefPanel 실패 테스트 작성**

`apps/studio/src/editor/__tests__/RefPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport, parseComponentBody, type ComponentBody, type Element } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Ref = Extract<Element, { type: "ref" }>;
const body = (w: number, h: number): ComponentBody => parseComponentBody({ name: "회사 헤더", w, h,
  props: [
    { name: "title", type: "string", default: "제목", label: "제목" },
    { name: "qty", type: "number", default: 1 },
    { name: "showLogo", type: "boolean", default: true },
    { name: "logo", type: "image", default: "" },
  ],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w, h, value: "{{ props.title }}" }] });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, components: { "hdr@3": body(40, 10) }, elements: [
  { id: "hdr-1", type: "ref", ref: "hdr", version: 3, x: 10, y: 10, w: 40, h: 10, props: { title: "{{ record.NO }}" } },
  { id: "hdr-2", type: "ref", ref: "hdr", version: 3, x: 10, y: 40, w: 40, h: 10, props: {} },
]});
const detail = (b: ComponentBody, latestVersion: number) => ({ summary: { id: "hdr", name: "회사 헤더", latestVersion, w: b.w, h: b.h, updatedAt: "2026-09-17T00:00:00.000Z" }, versions: [], latest: b });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

/** GET /api/components/hdr 응답을 차례로 준다(마지막 응답은 계속 반복) */
function stubLibrary(...responses: (() => Response)[]) {
  let n = 0;
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => responses[Math.min(n++, responses.length - 1)]());
  vi.stubGlobal("fetch", fn);
  return fn;
}

function setup(...responses: (() => Response)[]) {
  const fetchMock = stubLibrary(...(responses.length ? responses : [() => json(detail(body(40, 10), 3))]));
  const store = createEditorStore(report);
  store.getState().select(["hdr-1"]);
  const utils = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
  const ref = (id = "hdr-1") => store.getState().findElement(id) as Ref;
  return { store, fetchMock, ref, ...utils };
}

describe("RefPanel (PropertyPanel의 ref 위임)", () => {
  it("shows the component name and version, keeps X/Y/visible/flow and hides W/H and style", async () => {
    const { getByText, findByText, getByLabelText, queryByLabelText, queryByRole, fetchMock, ref } = setup();
    expect(getByText("회사 헤더")).toBeTruthy();
    expect(getByText("v3")).toBeTruthy();
    expect(queryByLabelText("W")).toBeNull();
    expect(queryByLabelText("H")).toBeNull();
    expect(queryByLabelText("선색")).toBeNull();
    fireEvent.change(getByLabelText("X"), { target: { value: "15" } });
    fireEvent.change(getByLabelText("Y"), { target: { value: "12" } });
    fireEvent.change(getByLabelText("visible"), { target: { value: "{{ params.show }}" } });
    fireEvent.change(getByLabelText("flow"), { target: { value: "every" } });
    expect(ref()).toMatchObject({ x: 15, y: 12, w: 40, h: 10, visible: "{{ params.show }}", flow: "every" });
    expect(await findByText("라이브러리 최신")).toBeTruthy();                 // 라이브러리 최신 = v3
    expect(fetchMock.mock.calls[0][0]).toBe("/api/components/hdr");
    expect(queryByRole("button", { name: /업데이트/ })).toBeNull();
  });
  it("offers v3 → v5 update, confirms a size change and updates every instance as one undo step", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByRole, queryByRole, store, ref } = setup(() => json(detail(body(40, 12), 5)));
    fireEvent.click(await findByRole("button", { name: "v3 → v5 업데이트" }));
    await waitFor(() => expect(ref().version).toBe(5));
    expect(confirm).toHaveBeenCalledWith("40×10 → 40×12, 아래 요소와 겹칠 수 있습니다");
    expect(ref()).toMatchObject({ w: 40, h: 12, props: { title: "{{ record.NO }}" } });
    expect(ref("hdr-2")).toMatchObject({ version: 5, h: 12 });
    expect(Object.keys(store.getState().report.components)).toEqual(["hdr@5"]);
    expect(store.getState().history.past).toHaveLength(1);
    await waitFor(() => expect(queryByRole("button", { name: /업데이트/ })).toBeNull());
  });
  it("keeps the version when the size confirm is cancelled, and updates without a confirm when the size is unchanged", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { findByRole, store, ref } = setup(() => json(detail(body(40, 12), 5)), () => json(detail(body(40, 12), 5)), () => json(detail(body(40, 10), 6)));
    fireEvent.click(await findByRole("button", { name: "v3 → v5 업데이트" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(ref().version).toBe(3);
    expect(store.getState().history.past).toHaveLength(0);
    fireEvent.click(await findByRole("button", { name: "v3 → v5 업데이트" }));
    await waitFor(() => expect(ref().version).toBe(6));                      // 누르는 시점의 최신(v6)을 받는다
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("tells when the component is missing from the library or the update request fails", async () => {
    const missing = setup(() => json({ error: "component not found: hdr" }, 404));
    expect(await missing.findByText("라이브러리에서 찾지 못했습니다: component not found: hdr")).toBeTruthy();
    expect(missing.queryByRole("button", { name: /업데이트/ })).toBeNull();
    cleanup();
    const failing = setup(() => json(detail(body(40, 10), 4)), () => json({ error: "db down" }, 500));
    fireEvent.click(await failing.findByRole("button", { name: "v3 → v4 업데이트" }));
    expect(await failing.findByText("업데이트하지 못했습니다: db down")).toBeTruthy();
    expect(failing.ref().version).toBe(3);
  });
  it("edits string and number props as templates; clearing a field removes the value so the default applies", () => {
    const { getByLabelText, getByText, ref, store } = setup();
    const title = getByLabelText("입력값 title") as HTMLInputElement;
    expect(getByText("제목 (title)")).toBeTruthy();                            // 라벨이 있으면 라벨 (이름)
    expect(title.value).toBe("{{ record.NO }}");
    expect(title.placeholder).toBe("제목");
    fireEvent.change(title, { target: { value: "품질보증서" } });
    expect(ref().props).toEqual({ title: "품질보증서" });
    fireEvent.change(title, { target: { value: "" } });
    expect(ref().props).toEqual({});
    const qty = getByLabelText("입력값 qty") as HTMLInputElement;
    expect(qty.placeholder).toBe("1");
    fireEvent.change(qty, { target: { value: "12" } });
    expect(ref().props).toEqual({ qty: 12 });                                   // 숫자 리터럴은 number로
    fireEvent.change(qty, { target: { value: "{{ row.QTY }}" } });
    expect(ref().props).toEqual({ qty: "{{ row.QTY }}" });                      // 그 밖은 템플릿 문자열
    expect(qty.value).toBe("{{ row.QTY }}");
    expect(store.getState().history.past).toHaveLength(4);                     // 입력 한 번 = 커밋 한 번
    expect(ref("hdr-2").props).toEqual({});                                     // 다른 인스턴스는 그대로
  });
  it("edits a boolean prop with a checkbox, switches to a template input and back, and resets to the default", () => {
    const { getByLabelText, getByRole, queryByRole, ref } = setup();
    const check = () => getByLabelText("입력값 showLogo") as HTMLInputElement;
    expect(check().type).toBe("checkbox");
    expect(check().checked).toBe(true);                                         // 기본값 true
    expect(queryByRole("button", { name: "입력값 showLogo 기본값" })).toBeNull();
    fireEvent.click(check());
    expect(ref().props).toMatchObject({ showLogo: false });
    fireEvent.click(getByRole("button", { name: "입력값 showLogo 기본값" }));
    expect(ref().props).not.toHaveProperty("showLogo");
    expect(check().checked).toBe(true);

    fireEvent.click(getByRole("button", { name: "입력값 showLogo 템플릿 전환" }));
    expect(check().type).toBe("text");
    fireEvent.change(check(), { target: { value: "{{ params.logo }}" } });
    expect(ref().props).toMatchObject({ showLogo: "{{ params.logo }}" });
    fireEvent.click(getByRole("button", { name: "입력값 showLogo 템플릿 전환" }));
    expect(check().type).toBe("checkbox");                                      // 체크박스로 돌아가면 템플릿 값은 지운다
    expect(ref().props).not.toHaveProperty("showLogo");
  });
  it("shows a template value of a boolean prop as a text input from the start", () => {
    const store = createEditorStore(report);
    stubLibrary(() => json(detail(body(40, 10), 3)));
    act(() => { store.getState().updateElement("hdr-1", { props: { showLogo: "{{ record.LOGO }}" } } as Partial<Element>); store.getState().select(["hdr-1"]); });
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    expect((getByLabelText("입력값 showLogo") as HTMLInputElement).value).toBe("{{ record.LOGO }}");
  });
  it("edits an image prop as asset://id or URL text", () => {
    const { getByLabelText, ref } = setup();
    const logo = getByLabelText("입력값 logo") as HTMLInputElement;
    expect(logo.placeholder).toBe("asset://id 또는 URL");
    fireEvent.change(logo, { target: { value: "asset://stamp" } });
    expect(ref().props).toMatchObject({ logo: "asset://stamp" });
    fireEvent.change(logo, { target: { value: "" } });
    expect(ref().props).not.toHaveProperty("logo");
  });
  it("says when the report does not carry the referenced version", () => {
    const { getByText, store } = setup();
    act(() => { store.getState().updateElement("hdr-1", { version: 9 } as Partial<Element>); });
    expect(getByText("컴포넌트 내용이 없습니다: hdr@9")).toBeTruthy();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/RefPanel.test.tsx`
Expected: FAIL — `회사 헤더`·`v3` 텍스트가 없고 `W` 필드가 보이며 `입력값 title` 입력을 찾지 못한다.

- [ ] **Step 7: RefPanel 구현**

`apps/studio/src/editor/panels/RefPanel.tsx`:
```tsx
"use client";
import { useEffect, useState, type ReactNode } from "react";
import { componentKey, refsTo, type ComponentProp, type Element } from "@daport/core";
import { useEditor } from "../store";
import { fetchComponent } from "../library/api";
import { sizeChangeNotice } from "../library/sizeNotice";

type RefElement = Extract<Element, { type: "ref" }>;
type PropValue = string | number | boolean;

const btn = "text-xs border rounded px-1 bg-white hover:bg-neutral-100";
const input = "w-full border rounded px-1 py-0.5";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NUMBER_LITERAL = /^-?\d+(\.\d+)?$/;

/** 입력값 한 칸. string·number·image는 템플릿 입력, boolean은 체크박스(토글로 템플릿 입력) (스펙 7.2) */
function PropField({ decl, value, onChange }: { decl: ComponentProp; value: PropValue | undefined; onChange: (v: PropValue | undefined) => void }) {
  const [forceTemplate, setForceTemplate] = useState(false);
  const aria = `입력값 ${decl.name}`;
  const label = decl.label ? `${decl.label} (${decl.name})` : decl.name;
  const text = typeof value === "string" ? value : value === undefined ? "" : String(value);
  // 빈 문자열은 값 삭제(기본값 사용)
  const onText = (v: string) => {
    if (v === "") onChange(undefined);
    else if (decl.type === "number" && NUMBER_LITERAL.test(v.trim())) onChange(Number(v));
    else onChange(v);
  };
  const textInput = (placeholder: string) =>
    <input aria-label={aria} type="text" value={text} placeholder={placeholder} className={input} onChange={(e) => onText(e.target.value)} />;

  let control: ReactNode;
  if (decl.type === "boolean") {
    const templated = forceTemplate || typeof value === "string";
    control = <>
      {templated
        ? textInput(String(value ?? decl.default))
        : <input aria-label={aria} type="checkbox" checked={typeof value === "boolean" ? value : decl.default} onChange={(e) => onChange(e.target.checked)} />}
      <button aria-label={`${aria} 템플릿 전환`} title={templated ? "체크박스로" : "템플릿으로"} className={btn}
        onClick={() => {
          // 체크박스로 돌아갈 때 템플릿 문자열은 체크박스로 나타낼 수 없으므로 지운다
          if (templated && typeof value === "string") onChange(undefined);
          setForceTemplate(!templated);
        }}>{"{ }"}</button>
      {typeof value === "boolean" && <button aria-label={`${aria} 기본값`} className={btn} onClick={() => onChange(undefined)}>기본값</button>}
    </>;
  } else if (decl.type === "image") {
    control = textInput("asset://id 또는 URL");
  } else {
    control = textInput(String(decl.default));
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-500 truncate" title={label}>{label}</span>
      {control}
    </div>
  );
}

/** 컴포넌트 인스턴스 속성: 이름·버전, 라이브러리 최신으로 업데이트, 입력값 (스펙 7.2). X·Y·visible·flow는 PropertyPanel이 그린다 */
export function RefPanel({ el }: { el: RefElement }) {
  const report = useEditor((s) => s.report);
  const updateElement = useEditor((s) => s.updateElement);
  const updateInstances = useEditor((s) => s.updateInstances);
  const key = componentKey(el.ref, el.version);
  const body = report.components[key];
  const [latest, setLatest] = useState<number | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // 라이브러리 최신 버전. 다른 컴포넌트의 인스턴스로 선택이 바뀌면 다시 묻는다
  useEffect(() => {
    let alive = true;
    setLatest(null); setLibraryError(null); setStatus(null);
    fetchComponent(el.ref).then(
      (d) => { if (alive) setLatest(d.summary.latestVersion); },
      (e) => { if (alive) setLibraryError(message(e)); },
    );
    return () => { alive = false; };
  }, [el.ref]);

  /** 누르는 시점의 최신 내용을 받아 이 레포트의 모든 인스턴스를 올린다(스토어 updateInstances, 되돌리기 1단위) */
  const update = async () => {
    setStatus(null);
    try {
      const d = await fetchComponent(el.ref);
      const version = d.summary.latestVersion;
      setLatest(version);
      if (version <= el.version) return;
      const notice = sizeChangeNotice(refsTo(report, el.ref), d.latest);
      if (notice && !window.confirm(notice)) return;
      updateInstances(el.ref, version, d.latest);
    } catch (e) {
      setStatus(`업데이트하지 못했습니다: ${message(e)}`);
    }
  };

  const setValue = (name: string, v: PropValue | undefined) => {
    const next = { ...el.props };
    if (v === undefined) delete next[name]; else next[name] = v;
    updateElement(el.id, { props: next } as Partial<Element>);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">컴포넌트</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{body?.name ?? el.ref}</span>
        <span className="text-neutral-500">{`v${el.version}`}</span>
      </div>
      {latest !== null && latest > el.version && (
        <button className={btn + " self-start"} onClick={() => void update()}>{`v${el.version} → v${latest} 업데이트`}</button>
      )}
      {latest !== null && latest <= el.version && <div className="text-xs text-neutral-400">라이브러리 최신</div>}
      {libraryError && <div className="text-xs text-amber-700">{`라이브러리에서 찾지 못했습니다: ${libraryError}`}</div>}
      {status && <div role="status" className="text-xs text-red-700">{status}</div>}
      <div className="text-xs text-neutral-400">더블클릭하면 컴포넌트 편집 화면이 새 탭으로 열립니다</div>
      {!body
        ? <div className="text-xs text-red-700">{`컴포넌트 내용이 없습니다: ${key}`}</div>
        : <>
          <div className="text-xs font-semibold mt-2">입력값</div>
          {body.props.length === 0 && <div className="text-xs text-neutral-400">선언된 입력값이 없습니다</div>}
          {body.props.map((decl) => (
            <PropField key={`${el.id}:${decl.name}`} decl={decl} value={el.props[decl.name]} onChange={(v) => setValue(decl.name, v)} />
          ))}
        </>}
    </div>
  );
}
```

- [ ] **Step 8: PropertyPanel에서 ref를 RefPanel에 맡기기**

`apps/studio/src/editor/panels/PropertyPanel.tsx`에서:

1) `import { RepeaterPanel } from "./RepeaterPanel";` 아래에 추가한다:
```tsx
import { RefPanel } from "./RefPanel";
```

2) 두 줄
```tsx
      <NumberField label="W" value={el.w} min={0} onChange={setW} />
      <NumberField label="H" value={el.h} min={0} onChange={setH} />
```
을 다음으로 바꾼다:
```tsx
      {/* 인스턴스 크기는 참조한 컴포넌트 내용이 정한다. 크기 조절은 지원하지 않는다 (스펙 4.3) */}
      {el.type !== "ref" && <>
        <NumberField label="W" value={el.w} min={0} onChange={setW} />
        <NumberField label="H" value={el.h} min={0} onChange={setH} />
      </>}
```

3) `{el.type === "repeater" && <RepeaterPanel el={el} />}` 줄 바로 아래에 추가한다:
```tsx
      {el.type === "ref" && <>
        {/* 펼친 고정 요소가 어느 페이지에 나오는지는 ref의 flow가 정한다 (스펙 5.1) */}
        <SelectField label="flow" value={el.flow} options={["once", "every", "last"]} onChange={(flow) => set({ flow })} />
        <RefPanel el={el} />
      </>}
```

4) 스타일 섹션 조건 `{el.type !== "table" && el.type !== "repeater" && <>`을 다음으로 바꾼다(ref 상자에는 칠할 스타일이 없다):
```tsx
      {el.type !== "table" && el.type !== "repeater" && el.type !== "ref" && <>
```

- [ ] **Step 9: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/RefPanel.test.tsx src/editor/__tests__/PropertyPanel.test.tsx`
Expected: PASS (RefPanel 9개, 기존 PropertyPanel 테스트 그대로).

- [ ] **Step 10: 캔버스 인스턴스 선택 실패 테스트 작성**

`apps/studio/src/editor/canvas/__tests__/Canvas.ref.test.tsx`:
```tsx
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { parseReport, parseComponentBody } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { mmToPxScaled } from "../snap";

const body = parseComponentBody({ name: "헤더", w: 40, h: 10, props: [{ name: "title", type: "string", default: "제목" }], elements: [
  { id: "t", type: "text", x: 2, y: 2, w: 30, h: 5, value: "{{ props.title }}" },
  { id: "frame", type: "rect", x: 0, y: 0, w: 40, h: 10, style: { stroke: "#000", strokeWidth: 0.3 } },
]});
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, components: { "hdr@1": body }, elements: [
  { id: "hdr-1", type: "ref", ref: "hdr", version: 1, x: 10, y: 10, w: 40, h: 10, props: { title: "A" } },
  { id: "hdr-2", type: "ref", ref: "hdr", version: 1, x: 10, y: 40, w: 40, h: 10, props: { title: "B" } },
  { id: "a", type: "text", x: 60, y: 70, w: 20, h: 5, value: "A" },
]});

const px = (mm: number) => mmToPxScaled(mm, 1);
const ptr = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({ pointerId: 1, clientX, clientY, ...extra });

function setup() {
  const store = createEditorStore(report);
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  const q = (sel: string) => utils.container.querySelector(sel) as HTMLElement;
  const canvas = utils.getByTestId("canvas");
  const boxes = () => Array.from(utils.container.querySelectorAll<HTMLElement>(".border-blue-500.pointer-events-none"))
    .map((d) => [d.style.left, d.style.top, d.style.width, d.style.height]);
  const handle = (h: string) => utils.container.querySelector(`[data-handle="${h}"]`);
  return { store, q, canvas, boxes, handle, ...utils };
}

beforeAll(() => {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Canvas component instances", () => {
  it("draws each instance with its own props under the instance id", () => {
    const { q } = setup();
    expect(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]').textContent).toBe("A");
    expect(q('[data-element-id="hdr-2"][data-instance="hdr-2/t"]').textContent).toBe("B");
    expect(q('[data-element-id="hdr-1"][data-role="refBox"]')).not.toBeNull();
  });
  it("selects the instance from a child or its empty area, boxes the refBox and shows no resize handles", () => {
    const { store, q, canvas, boxes, handle } = setup();
    fireEvent.pointerDown(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]'), ptr(px(15), px(14)));
    fireEvent.pointerUp(canvas, ptr(px(15), px(14)));
    expect(store.getState().selection).toEqual(["hdr-1"]);
    expect(boxes()).toEqual([["10mm", "10mm", "40mm", "10mm"]]);
    expect(handle("se")).toBeNull();

    fireEvent.pointerDown(q('[data-element-id="hdr-2"][data-role="refBox"]'), ptr(px(45), px(48)));
    fireEvent.pointerUp(canvas, ptr(px(45), px(48)));
    expect(store.getState().selection).toEqual(["hdr-2"]);
    expect(boxes()).toEqual([["10mm", "40mm", "40mm", "10mm"]]);
    expect(handle("se")).toBeNull();

    act(() => store.getState().select(["a"]));
    expect(handle("se")).not.toBeNull();                                           // 일반 요소는 그대로 핸들이 있다
  });
  it("picks the instance even when the topmost node is a hollow frame inside the component", () => {
    const { store, q } = setup();
    const stack = vi.fn<(x: number, y: number) => Element[]>();
    Object.defineProperty(document, "elementsFromPoint", { value: stack, configurable: true });   // jsdom에는 없다
    try {
      stack.mockReturnValue([q('[data-element-id="hdr-1"][data-instance="hdr-1/frame"]'), q('[data-element-id="hdr-1"][data-role="refBox"]'), q(".dp-page")]);
      fireEvent.pointerDown(q('[data-element-id="hdr-1"][data-instance="hdr-1/frame"]'), ptr(px(35), px(18)));   // 틀의 선에서 먼 안쪽
      expect(store.getState().selection).toEqual(["hdr-1"]);
    } finally {
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });
  it("moves the whole instance as one undo step without changing its size", () => {
    const { store, q, canvas, boxes } = setup();
    fireEvent.pointerDown(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]'), ptr(0, 0));
    fireEvent.pointerMove(canvas, ptr(px(5.2), px(2)));
    expect(boxes()).toEqual([["15mm", "12mm", "40mm", "10mm"]]);                     // 고스트
    fireEvent.pointerUp(canvas, ptr(px(5.2), px(2)));
    expect(store.getState().findElement("hdr-1")).toMatchObject({ x: 15, y: 12, w: 40, h: 10 });
    expect(store.getState().findElement("hdr-2")).toMatchObject({ x: 10, y: 40 });
    expect(store.getState().history.past).toHaveLength(1);
    expect(q('[data-element-id="hdr-1"][data-instance="hdr-1/t"]').style.left).toBe("17mm");   // 자식도 함께 옮겨 그린다
  });
  it("opens the component editor in a new tab on double-click of an instance only", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { q } = setup();
    fireEvent.doubleClick(q('[data-element-id="hdr-2"][data-instance="hdr-2/t"]'), { clientX: px(15), clientY: px(44) });
    expect(open).toHaveBeenCalledWith("/components/hdr", "_blank", "noopener");
    fireEvent.doubleClick(q('[data-element-id="a"]'), { clientX: px(65), clientY: px(72) });
    fireEvent.doubleClick(q(".dp-page"), { clientX: px(90), clientY: px(90) });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 11: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.ref.test.tsx`
Expected: FAIL — 첫 테스트(그리기)는 Task 4 결과라 통과한다. 선택 테스트와 틀 테스트는 선택이 `[]`이라 실패한다(인스턴스 안쪽 클릭이 채우기 없는 rect인 refBox의 "선 근처" 검사에 걸러짐). 더블클릭 테스트는 `window.open`이 불리지 않아 실패한다. 이동 테스트는 (0,0)에서 눌러 선 검사를 통과하므로 이미 통과할 수 있다.

- [ ] **Step 12: Canvas 구현**

`apps/studio/src/editor/canvas/Canvas.tsx`에서:

1) 첫 import 줄
```tsx
import { useEffect, useMemo, useState, type DragEvent, type PointerEvent } from "react";
```
을 다음으로 바꾼다:
```tsx
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent, type PointerEvent } from "react";
```

2) `pickElementId` 선언 줄
```tsx
  const pickElementId = (e: PointerEvent<HTMLDivElement>): string | null => {
```
을 다음으로 바꾼다(더블클릭도 같은 함수를 쓴다. PointerEvent는 MouseEvent를 상속하므로 기존 호출은 그대로 된다):
```tsx
  const pickElementId = (e: MouseEvent<HTMLDivElement>): string | null => {
```

3) `pickElementId` 안의 두 줄
```tsx
      const role = host?.getAttribute("data-role");
      if (role === "flowBox" || role === "cell" || role === "border" || role === "template") return id;
```
을 다음으로 바꾼다:
```tsx
      const role = host?.getAttribute("data-role");
      if (role === "flowBox" || role === "cell" || role === "border" || role === "template" || role === "refBox") return id;
      // 펼친 컴포넌트의 항목은 elementId가 인스턴스 id다. 안쪽 어디를 눌러도(빈 곳·틀 포함) 인스턴스를 고른다 (스펙 7.2)
      if (findElement(id)?.type === "ref") return id;
```

4) `onHandleDown` 정의 줄 바로 아래에 추가한다:
```tsx
  /** 인스턴스를 더블클릭하면 컴포넌트 편집 화면을 새 탭으로 연다 (스펙 7.2) */
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const id = pickElementId(e);
    const el = id ? findElement(id) : undefined;
    if (el?.type === "ref") window.open(`/components/${encodeURIComponent(el.ref)}`, "_blank", "noopener");
  };
```

5) 루트 div의 이벤트 속성 줄
```tsx
      data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel}
```
을 다음으로 바꾼다:
```tsx
      data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel} onDoubleClick={onDoubleClick}
```

6) 선택 상자 줄
```tsx
        {Object.entries(shown).map(([id, b]) => <SelectionBox key={id} box={b} single={selection.length === 1} onHandleDown={onHandleDown} />)}
```
을 다음으로 바꾼다(인스턴스는 이동만 되고 크기 조절 핸들이 없다):
```tsx
        {Object.entries(shown).map(([id, b]) => <SelectionBox key={id} box={b} single={selection.length === 1 && findElement(id)?.type !== "ref"} onHandleDown={onHandleDown} />)}
```

- [ ] **Step 13: 통과 확인 (studio 전체)**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.ref.test.tsx && pnpm --filter studio test`
Expected: 새 테스트 5개 PASS, studio 전체 테스트 통과(기존 Canvas의 채우기 없는 틀 선택·표·반복 영역 선택 동작 그대로).

- [ ] **Step 14: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 15: Commit**

```bash
git add apps/studio/src/editor/panels/RefPanel.tsx apps/studio/src/editor/panels/PropertyPanel.tsx apps/studio/src/editor/canvas/pages.ts apps/studio/src/editor/canvas/Canvas.tsx apps/studio/src/editor/__tests__/RefPanel.test.tsx apps/studio/src/editor/canvas/__tests__/Canvas.ref.test.tsx apps/studio/src/editor/canvas/__tests__/pages.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): 인스턴스 속성 패널(RefPanel)과 캔버스 인스턴스 선택·더블클릭

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 컴포넌트 만들기 대화상자

스펙 7.3. 캔버스 선택 영역을 라이브러리 컴포넌트 버전 1로 등록하고, 성공하면 선택 요소를 `ref` 인스턴스 하나로 바꾼다. 조건 검사는 core `sameParent(report.elements, selection, { allowInTemplate: false, allowRefs: false })`, 내용 추출은 core `extractComponent`, 등록은 Task 10의 `editor/library/api.ts`의 `createComponent`, 치환은 Task 9의 스토어 액션 `replaceWithComponent`를 쓴다. 등록이 실패하면 캔버스(스토어 report)는 그대로다.

**Files:**
- Create: `apps/studio/src/editor/library/MakeComponentDialog.tsx` (`suggestComponentId`, `makeComponentCheck`, `MakeComponentDialog`)
- Modify: `apps/studio/src/editor/Toolbar.tsx` ("컴포넌트로 만들기" 버튼과 대화상자)
- Modify: `apps/studio/src/editor/canvas/Canvas.tsx` (우클릭 메뉴 "컴포넌트로 만들기", 오른쪽 버튼은 드래그를 시작하지 않음)
- Test: `apps/studio/src/editor/__tests__/MakeComponentDialog.test.tsx`
- Test: `apps/studio/src/editor/canvas/__tests__/Canvas.menu.test.tsx`

- [ ] **Step 1: 실패 테스트 작성 — 순수 함수와 대화상자**

`apps/studio/src/editor/__tests__/MakeComponentDialog.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../store";
import { MakeComponentDialog, makeComponentCheck, suggestComponentId, COMPONENT_MODE_REASON, EMPTY_SELECTION_REASON } from "../library/MakeComponentDialog";
import { Toolbar } from "../Toolbar";

// b는 오른쪽→왼쪽으로 그린 선이다. 경계 상자는 두 끝점 기준(x 30~40, y 12~20)
const report = parseReport({ id: "r", version: 1, page: { width: 200, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "b", type: "line", x: 40, y: 20, w: 10, h: 8, x2: 30, y2: 12 },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [
    { id: "c", type: "rect", x: 5, y: 5, w: 5, h: 5 },
    { id: "d", type: "rect", x: 10, y: 10, w: 5, h: 5 },
  ] },
  { id: "cards", type: "repeater", x: 100, y: 10, w: 80, h: 60, source: "items", item: { w: 40, h: 10, children: [
    { id: "it", type: "text", x: 0, y: 0, w: 10, h: 5, value: "x" },
  ] } },
  { id: "hdr", type: "ref", ref: "hdr-comp", version: 1, x: 0, y: 80, w: 10, h: 5 },
], components: { "hdr-comp@1": { name: "H", w: 10, h: 5, props: [], elements: [] } } });

const componentMode = { componentId: "x", version: 1, props: [], sampleProps: {} };

function mount(store: EditorStore, ui: React.ReactNode) {
  return render(<EditorContext.Provider value={store}>{ui}</EditorContext.Provider>);
}
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const makeButton = () => screen.getByRole("button", { name: "만들기" }) as HTMLButtonElement;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("suggestComponentId", () => {
  it("slugifies the name to the component id rule", () => {
    expect(suggestComponentId("Company Header 2")).toBe("company-header-2");
    expect(suggestComponentId("  --ABC__def--  ")).toBe("abc-def");
    expect(suggestComponentId("회사 Header")).toBe("header");
    expect(suggestComponentId("Café Sign")).toBe("cafe-sign");
  });
  it("falls back to component when nothing usable remains", () => {
    expect(suggestComponentId("회사 헤더")).toBe("component");
    expect(suggestComponentId("")).toBe("component");
    expect(suggestComponentId("---")).toBe("component");
  });
});

describe("makeComponentCheck", () => {
  it("accepts siblings at the top level, a single group and siblings inside the same group", () => {
    expect(makeComponentCheck(report, ["a", "b"], false)).toEqual({ ok: true });
    expect(makeComponentCheck(report, ["g"], false)).toEqual({ ok: true });
    expect(makeComponentCheck(report, ["c", "d"], false)).toEqual({ ok: true });
  });
  it("rejects an empty selection, mixed parents, repeater templates and refs with a reason", () => {
    expect(makeComponentCheck(report, [], false)).toEqual({ ok: false, reason: EMPTY_SELECTION_REASON });
    for (const ids of [["a", "c"], ["it"], ["hdr"], ["a", "hdr"]]) {
      const res = makeComponentCheck(report, ids, false);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    }
  });
  it("is unavailable in component mode even for a valid selection", () => {
    expect(makeComponentCheck(report, ["a", "b"], true)).toEqual({ ok: false, reason: COMPONENT_MODE_REASON });
  });
});
```

같은 파일에 이어서 대화상자 테스트:
```tsx
describe("MakeComponentDialog", () => {
  function open(selection: string[]) {
    const store = createEditorStore(report);
    act(() => store.getState().select(selection));
    const onClose = vi.fn();
    mount(store, <MakeComponentDialog onClose={onClose} />);
    return { store, onClose };
  }

  it("suggests the id from the name until the id is edited by hand", () => {
    open(["a", "b"]);
    expect(screen.getByRole("dialog", { name: "컴포넌트 만들기" })).toBeTruthy();
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    expect(input("id").value).toBe("company-header");
    fireEvent.change(input("이름"), { target: { value: "회사 헤더" } });
    expect(input("id").value).toBe("component");
    fireEvent.change(input("id"), { target: { value: "my-hdr" } });
    fireEvent.change(input("이름"), { target: { value: "Other" } });
    expect(input("id").value).toBe("my-hdr");
  });

  it("shows validation messages and disables 만들기 until name and id are valid", () => {
    open(["a", "b"]);
    expect(screen.getByText("이름을 입력하세요")).toBeTruthy();
    expect(makeButton().disabled).toBe(true);
    fireEvent.change(input("이름"), { target: { value: "   " } });
    expect(screen.getByText("이름을 입력하세요")).toBeTruthy();
    fireEvent.change(input("이름"), { target: { value: "헤더" } });
    fireEvent.change(input("id"), { target: { value: "Bad Id" } });
    expect(screen.getByText("id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다")).toBeTruthy();
    expect(makeButton().disabled).toBe(true);
    fireEvent.change(input("id"), { target: { value: "-hdr" } });
    expect(makeButton().disabled).toBe(true);
    fireEvent.change(input("id"), { target: { value: "hdr-1" } });
    expect(screen.queryByText(/이름을 입력하세요|id는 영문/)).toBeNull();
    expect(makeButton().disabled).toBe(false);
  });

  it("closes on 취소 without any request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { onClose, store } = open(["a", "b"]);
    const before = store.getState().report;
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().report).toBe(before);
  });

  it("creates version 1 in the library, then replaces the selection with one ref as a single undo step", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ version: 1, hash: "h1" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { store, onClose } = open(["a", "b"]);
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    fireEvent.click(makeButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/components");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.id).toBe("company-header");
    expect(sent.body).toMatchObject({ name: "Company Header", w: 30, h: 10, props: [] });
    expect(sent.body.elements.map((e: { id: string }) => e.id)).toEqual(["a", "b"]);
    expect(sent.body.elements[0]).toMatchObject({ x: 0, y: 0 });                       // 상자 기준 상대좌표
    expect(sent.body.elements[1]).toMatchObject({ x: 10, y: 10, x2: 0, y2: 2 });       // 선은 두 끝점 모두 옮긴다

    const s = store.getState();
    const top = s.report.elements;
    expect(top.some((e) => e.id === "a" || e.id === "b")).toBe(false);
    const ref = top.find((e) => e.type === "ref");
    expect(ref && ref.type === "ref" && ref.ref === "company-header" ? ref : undefined).toMatchObject({ version: 1, x: 10, y: 10, w: 30, h: 10 });
    expect(top.indexOf(ref!)).toBe(0);                                                  // 첫 선택 요소 자리
    expect(s.report.components["company-header@1"]).toEqual(sent.body);
    expect(s.history.past).toHaveLength(1);

    act(() => store.getState().undo());
    expect(store.getState().report.elements.map((e) => e.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(store.getState().report.components["company-header@1"]).toBeUndefined();
  });

  it("shows the server error in the dialog and leaves the canvas unchanged when creation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "component exists: company-header" }, { status: 409 })));
    const { store, onClose } = open(["a", "b"]);
    const before = store.getState().report;
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("component exists: company-header"));
    expect(onClose).not.toHaveBeenCalled();
    expect(store.getState().report).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().selection).toEqual(["a", "b"]);
    await waitFor(() => expect(makeButton().disabled).toBe(false));                    // 고쳐서 다시 시도할 수 있다
  });

  it("re-checks the selection on submit and does not call the server when it became invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { store } = open(["a", "b"]);
    fireEvent.change(input("이름"), { target: { value: "X" } });
    act(() => store.getState().select(["a", "c"]));
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent!.length).toBeGreaterThan(0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/MakeComponentDialog.test.tsx`
Expected: FAIL — `../library/MakeComponentDialog` 모듈을 찾을 수 없음.

- [ ] **Step 3: 대화상자와 순수 함수 구현**

`apps/studio/src/editor/library/MakeComponentDialog.tsx`:
```tsx
"use client";
import { useContext, useState } from "react";
import { COMPONENT_ID_RE, sameParent, extractComponent, type Report } from "@daport/core";
import { EditorContext, useEditor } from "../store";
import { createComponent } from "./api";

export const EMPTY_SELECTION_REASON = "컴포넌트로 만들 요소를 선택하세요";
export const COMPONENT_MODE_REASON = "컴포넌트 편집 화면에서는 컴포넌트를 만들 수 없습니다";
const NAME_REQUIRED = "이름을 입력하세요";
const ID_INVALID = "id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다";
/** 스펙 7.3 조건: 같은 부모 배열, ref 없음, 반복 영역 템플릿·밴드 밖 */
const MAKE_OPTS = { allowInTemplate: false, allowRefs: false } as const;

/** 이름에서 컴포넌트 id를 제안한다. 악센트는 떼고, 영문 소문자·숫자가 아닌 연속 구간은 -, 앞뒤 -는 버린다. 남는 것이 없으면 "component" */
export function suggestComponentId(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug && COMPONENT_ID_RE.test(slug) ? slug : "component";
}

/** 툴바 버튼·우클릭 메뉴의 활성 여부와 비활성 사유(툴팁) */
export function makeComponentCheck(report: Report, selection: string[], componentMode: boolean): { ok: true } | { ok: false; reason: string } {
  if (componentMode) return { ok: false, reason: COMPONENT_MODE_REASON };
  if (selection.length === 0) return { ok: false, reason: EMPTY_SELECTION_REASON };
  const info = sameParent(report.elements, selection, MAKE_OPTS);
  return "error" in info ? { ok: false, reason: info.error } : { ok: true };
}
```

같은 파일에 이어서 대화상자:
```tsx
/**
 * 선택 영역 → 컴포넌트 (스펙 7.3). 라이브러리에 버전 1을 만든 뒤에만 캔버스를 바꾼다.
 * 등록 실패 시 스토어는 건드리지 않고 서버 오류를 대화상자에 보인다. 라이브러리 등록은 되돌리기 대상이 아니다
 */
export function MakeComponentDialog({ onClose }: { onClose: () => void }) {
  const store = useContext(EditorContext)!;
  const [name, setName] = useState("");
  const [id, setId] = useState(suggestComponentId(""));
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 대화상자가 열린 동안에도 선택이 바뀔 수 있어 구독한다(제출 시 다시 검사)
  useEditor((s) => s.selection);

  const nameError = name.trim() === "" ? NAME_REQUIRED : null;
  const idError = COMPONENT_ID_RE.test(id) ? null : ID_INVALID;

  const onName = (v: string) => { setName(v); if (!idEdited) setId(suggestComponentId(v)); };
  const onId = (v: string) => { setId(v); setIdEdited(true); };

  const submit = async () => {
    if (nameError || idError || busy) return;
    const { report, selection, componentMode } = store.getState();
    const check = makeComponentCheck(report, selection, !!componentMode);
    if (!check.ok) { setError(check.reason); return; }
    const info = sameParent(report.elements, selection, MAKE_OPTS);
    if ("error" in info) { setError(info.error); return; }
    const ids = [...selection];
    const { body, box } = extractComponent(info.parent, ids, name.trim());
    setBusy(true); setError(null);
    try {
      const created = await createComponent(id, body);
      store.getState().replaceWithComponent(ids, id, created.version, body, box);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const btn = "text-xs border rounded px-3 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div role="dialog" aria-modal="true" aria-label="컴포넌트 만들기" className="bg-white rounded shadow-lg p-4 w-80 flex flex-col gap-2 text-xs">
        <div className="font-semibold text-sm">컴포넌트 만들기</div>
        <label className="flex flex-col gap-1">이름
          <input aria-label="이름" autoFocus className="border rounded px-1 py-0.5" value={name} onChange={(e) => onName(e.target.value)} />
        </label>
        {nameError && <div className="text-red-700">{nameError}</div>}
        <label className="flex flex-col gap-1">id
          <input aria-label="id" className="border rounded px-1 py-0.5 font-mono" value={id} onChange={(e) => onId(e.target.value)} />
        </label>
        {idError && <div className="text-red-700">{idError}</div>}
        {error && <div role="alert" className="text-red-700 whitespace-pre-wrap">{error}</div>}
        <div className="flex justify-end gap-2 mt-2">
          <button className={btn} onClick={onClose} disabled={busy}>취소</button>
          <button className={btn} onClick={submit} disabled={busy || !!nameError || !!idError}>만들기</button>
        </div>
      </div>
    </div>
  );
}
```

`sameParent`·`extractComponent`·`COMPONENT_ID_RE`는 Task 1·3에서 `@daport/core` 루트로 재export된 것을, `createComponent`는 Task 10의 `editor/library/api.ts`(실패 시 서버 `error` 메시지로 `Error`를 던진다)를 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/MakeComponentDialog.test.tsx`
Expected: PASS (suggestComponentId 2, makeComponentCheck 3, MakeComponentDialog 6).

- [ ] **Step 5: 실패 테스트 추가 — 툴바 버튼**

`apps/studio/src/editor/__tests__/MakeComponentDialog.test.tsx` 끝에 추가:
```tsx
describe("Toolbar 컴포넌트로 만들기", () => {
  const toolbarButton = () => screen.getByRole("button", { name: "컴포넌트로 만들기" }) as HTMLButtonElement;
  function mountToolbar(store: EditorStore) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ version: 1, hash: "h1" }, { status: 201 })));
    mount(store, <Toolbar reportId="r" zoom={1} setZoom={() => {}} />);
  }

  it("is disabled with the reason as tooltip until a valid selection exists", () => {
    const store = createEditorStore(report);
    mountToolbar(store);
    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().title).toBe(EMPTY_SELECTION_REASON);
    act(() => store.getState().select(["a", "hdr"]));
    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().title.length).toBeGreaterThan(0);
    act(() => store.getState().select(["a", "b"]));
    expect(toolbarButton().disabled).toBe(false);
    expect(toolbarButton().title).toBe("");
  });

  it("opens the dialog, creates the component and closes it", async () => {
    const store = createEditorStore(report);
    mountToolbar(store);
    act(() => store.getState().select(["c", "d"]));
    fireEvent.click(toolbarButton());
    fireEvent.change(input("이름"), { target: { value: "Boxes" } });
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const group = store.getState().findElement("g");
    expect(group?.type === "group" ? group.children.map((e) => e.type) : []).toEqual(["ref"]);   // 그룹 안 선택은 그룹 안에서 바뀐다
    expect(store.getState().report.components["boxes@1"]).toMatchObject({ w: 10, h: 10 });
  });

  it("is disabled in component mode", () => {
    const store = createEditorStore(report, { componentMode });
    mountToolbar(store);
    act(() => store.getState().select(["a", "b"]));
    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().title).toBe(COMPONENT_MODE_REASON);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/MakeComponentDialog.test.tsx`
Expected: FAIL — "컴포넌트로 만들기" 버튼을 찾지 못함 (Toolbar 3건).

- [ ] **Step 7: Toolbar에 버튼 추가**

`apps/studio/src/editor/Toolbar.tsx` import 줄 아래에 추가:
```tsx
import { MakeComponentDialog, makeComponentCheck } from "./library/MakeComponentDialog";
```

`const isLabel = report.output.kind === "label";` 바로 아래에 추가:
```tsx
  const selection = useEditor((s) => s.selection);
  const componentMode = useEditor((s) => s.componentMode);
  // 스펙 7.3: 조건이 안 맞으면 비활성, 사유는 툴팁
  const makeCheck = makeComponentCheck(report, selection, !!componentMode);
  const [making, setMaking] = useState(false);
```

JSX에서 실데이터 체크박스 `<label ...>실데이터</label>` 바로 뒤, `<div className="flex-1" />` 앞에 추가:
```tsx
      <button className={btn} disabled={!makeCheck.ok} title={makeCheck.ok ? undefined : makeCheck.reason} onClick={() => setMaking(true)}>컴포넌트로 만들기</button>
      {making && <MakeComponentDialog onClose={() => setMaking(false)} />}
```

- [ ] **Step 8: 실패 테스트 추가 — 캔버스 우클릭 메뉴**

`apps/studio/src/editor/canvas/__tests__/Canvas.menu.test.tsx`:
```tsx
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, fireEvent, cleanup, act, screen, waitFor } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { COMPONENT_MODE_REASON } from "../../library/MakeComponentDialog";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "b", type: "rect", x: 30, y: 30, w: 10, h: 10, style: { fill: "#eeeeee" } },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "c", type: "rect", x: 5, y: 5, w: 5, h: 5, style: { fill: "#eeeeee" } }] },
]});

beforeAll(() => {
  // Canvas.test.tsx와 같은 PointerEvent 대체 (jsdom 26에는 PointerEvent가 없다)
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub;
  Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(opts?: Parameters<typeof createEditorStore>[1]) {
  const store = createEditorStore(report, opts);
  const utils = render(<EditorContext.Provider value={store}><Canvas zoom={1} /></EditorContext.Provider>);
  const el = (id: string) => utils.container.querySelector(`[data-element-id="${id}"]`) as HTMLElement;
  return { store, canvas: utils.getByTestId("canvas"), el };
}
const item = () => screen.getByRole("menuitem", { name: "컴포넌트로 만들기" }) as HTMLButtonElement;
const right = (x: number, y: number) => ({ pointerId: 1, button: 2, clientX: x, clientY: y });

describe("Canvas context menu", () => {
  it("right-click selects the element under the pointer without starting a drag and opens the menu", () => {
    const { store, canvas, el } = setup();
    fireEvent.pointerDown(el("a"), right(100, 100));
    expect(store.getState().selection).toEqual(["a"]);
    fireEvent.pointerMove(canvas, right(300, 300));
    fireEvent.pointerUp(canvas, right(300, 300));
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });   // 오른쪽 버튼은 옮기지 않는다
    expect(store.getState().history.past).toHaveLength(0);
    fireEvent.contextMenu(el("a"), { clientX: 100, clientY: 100 });
    expect(item().disabled).toBe(false);
  });

  it("keeps a multi-selection when right-clicking one of its elements", () => {
    const { store, el } = setup();
    act(() => store.getState().select(["a", "b"]));
    fireEvent.pointerDown(el("b"), right(100, 100));
    fireEvent.contextMenu(el("b"), { clientX: 100, clientY: 100 });
    expect(store.getState().selection).toEqual(["a", "b"]);
    expect(item().disabled).toBe(false);
  });

  it("disables the item with the reason as tooltip for a mixed-parent selection and in component mode", () => {
    const { store, el } = setup();
    act(() => store.getState().select(["a", "c"]));
    fireEvent.contextMenu(el("a"), { clientX: 100, clientY: 100 });
    expect(item().disabled).toBe(true);
    expect(item().title.length).toBeGreaterThan(0);
    cleanup();
    const cm = setup({ componentMode: { componentId: "x", version: 1, props: [], sampleProps: {} } });
    act(() => cm.store.getState().select(["a"]));
    fireEvent.contextMenu(cm.el("a"), { clientX: 100, clientY: 100 });
    expect(item().disabled).toBe(true);
    expect(item().title).toBe(COMPONENT_MODE_REASON);
  });

  it("opens the dialog from the menu and closes the menu on a left click or Escape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ version: 1, hash: "h" }, { status: 201 })));
    const { store, canvas, el } = setup();
    act(() => store.getState().select(["a", "b"]));
    fireEvent.contextMenu(el("a"), { clientX: 100, clientY: 100 });
    fireEvent.pointerDown(item(), { pointerId: 1, button: 0 });                     // 메뉴 안 누름은 캔버스 선택을 바꾸지 않는다
    expect(store.getState().selection).toEqual(["a", "b"]);
    fireEvent.click(item());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "컴포넌트 만들기" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "Pair" } });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(store.getState().report.elements.some((e) => e.type === "ref" && e.ref === "pair")).toBe(true);

    fireEvent.contextMenu(canvas, { clientX: 5, clientY: 5 });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(canvas, { clientX: 5, clientY: 5 });
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 5, clientY: 5 });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
```

- [ ] **Step 9: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.menu.test.tsx`
Expected: FAIL — `menuitem` "컴포넌트로 만들기"를 찾지 못하고, 오른쪽 버튼 드래그가 요소를 옮긴다.

- [ ] **Step 10: Canvas에 우클릭 메뉴 구현**

`apps/studio/src/editor/canvas/Canvas.tsx` (Task 10이 컴포넌트 드롭과 `const componentMode = useEditor((s) => s.componentMode);`를, Task 11이 react import의 `type MouseEvent`·`pickElementId(e: MouseEvent<HTMLDivElement>)`·`onDoubleClick`을 넣어 둔 상태에서 고친다):

1. react import는 Task 11이 바꾼 `import { useEffect, useMemo, useState, type DragEvent, type MouseEvent, type PointerEvent } from "react";` 그대로 두고, 그 아래 import 블록 끝(Task 10이 넣은 `import { COMPONENT_MIME, fetchComponent } from "../library/api";` 아래)에 대화상자 import를 추가한다:
```tsx
import { MakeComponentDialog, makeComponentCheck } from "../library/MakeComponentDialog";
```

2. `const [warning, setWarning] = useState<string | null>(null);` 바로 아래에 추가한다(`componentMode`는 Task 10이 `findParentRepeater` 아래에 이미 선언했으므로 다시 선언하지 않는다):
```tsx
  /** 우클릭 메뉴 위치(페이지 기준 mm). 캔버스 div가 scale로 확대되므로 mm로 두면 배율과 함께 따라간다 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [making, setMaking] = useState(false);
  const makeCheck = makeComponentCheck(report, selection, !!componentMode);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
```

3. `pickElementId`는 Task 11이 이미 `(e: MouseEvent<HTMLDivElement>)`로 바꿨으므로 그대로 둔다(`contextmenu`에서도 부를 수 있다).

4. `onPagePointerDown`의 앞부분을 다음으로 바꾼다(이 태스크 전의 `const id = pickElementId(e);` ~ `if (!id) { select([]); return; }` 두 줄 대체):
```tsx
  const onPagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    setMenu(null);
    const id = pickElementId(e);
    // 오른쪽 버튼은 드래그를 시작하지 않는다. 선택 밖 요소면 그 요소만 선택하고, 선택 안 요소나 빈 곳이면 선택을 유지한다 (우클릭 메뉴용)
    if (e.button === 2) { if (id && !selection.includes(id)) select([id]); return; }
    if (!id) { select([]); return; }
```
(나머지 `if (e.shiftKey) ...`부터 `drag.begin(e, "move", start);`까지는 그대로 둔다.)

5. `onDragOver` 정의 바로 앞에 추가:
```tsx
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const origin = e.currentTarget.querySelector(".dp-page")?.getBoundingClientRect();
    setMenu({ x: pxToMm(e.clientX - (origin?.left ?? 0), zoom), y: pxToMm(e.clientY - (origin?.top ?? 0), zoom) });
  };
```

6. `return (` 이하를 프래그먼트로 감싼다. 바깥 캔버스 div(Task 11이 `onDoubleClick={onDoubleClick}`을 더해 둔 것)에 `onContextMenu={onContextMenu}`를 더하고, 오버레이 div(`absolute inset-0 pointer-events-none`) 안 마지막(`{error && ...}` 뒤)에 메뉴를, 캔버스 div 밖(형제)에 대화상자를 둔다. 대화상자를 확대된 div 밖에 두는 이유: `transform`이 있는 조상 안에서는 `fixed`가 화면 기준이 아니고, 대화상자 안 포인터 이벤트가 캔버스 선택 핸들러로 번지지 않게 하려는 것이다:
```tsx
  return (
    <>
      <div className="relative inline-block shadow-lg" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
        data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel} onDoubleClick={onDoubleClick}
        onDragOver={onDragOver} onDrop={onDrop} onContextMenu={onContextMenu}>
        {/* 기존 <style>, <PaintPage>, 오버레이 div 내용은 그대로 둔다. 오버레이 div의 {error && (...)} 뒤에 아래 메뉴를 추가한다 */}
      </div>
      {making && <MakeComponentDialog onClose={() => setMaking(false)} />}
    </>
  );
```
오버레이에 넣을 메뉴:
```tsx
        {menu && (
          <div role="menu" data-testid="canvas-menu" className="absolute pointer-events-auto bg-white border rounded shadow text-xs py-1 min-w-32"
            style={{ left: `${menu.x}mm`, top: `${menu.y}mm` }}
            onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <button role="menuitem" className="block w-full text-left px-3 py-1 hover:bg-neutral-100 disabled:opacity-50"
              disabled={!makeCheck.ok} title={makeCheck.ok ? undefined : makeCheck.reason}
              onClick={() => { setMenu(null); setMaking(true); }}>컴포넌트로 만들기</button>
          </div>
        )}
```
(위 JSX 블록의 `{/* ... */}` 주석은 설명용이다. 실제 파일에서는 기존 자식 요소를 그 자리에 그대로 두고 주석은 넣지 않는다.)

- [ ] **Step 11: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/MakeComponentDialog.test.tsx src/editor/canvas/__tests__/Canvas.menu.test.tsx`
Expected: PASS (MakeComponentDialog.test.tsx 14건, Canvas.menu.test.tsx 4건).

Run: `pnpm --filter studio test`
Expected: 모두 통과 (기존 Toolbar·Canvas 테스트 포함 — 왼쪽 버튼 동작은 바뀌지 않았다).

- [ ] **Step 12: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 13: Commit**

```bash
git add apps/studio/src/editor/library/MakeComponentDialog.tsx apps/studio/src/editor/Toolbar.tsx apps/studio/src/editor/canvas/Canvas.tsx apps/studio/src/editor/__tests__/MakeComponentDialog.test.tsx apps/studio/src/editor/canvas/__tests__/Canvas.menu.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 선택 영역을 컴포넌트로 만드는 대화상자 (툴바·우클릭 메뉴)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: 컴포넌트 편집 화면

스펙 7.5. `/components/:id`에서 기존 `Editor`를 컴포넌트 모드로 연다. 편집 대상은 `ComponentBody`를 감싼 편집용 레포트이고, 입력값 선언·샘플 값은 스토어의 `componentMode`(Task 9, 히스토리 밖)에 있다. 저장은 `PUT /api/components/:id`로 새 버전을 만든다. 샘플 값은 캔버스 컨텍스트와 미리보기 요청 본문의 `props`로 들어간다(Task 8이 렌더 라우트에 `props` 필드를 추가했다).

이 태스크는 다섯 묶음(A~E)이고 묶음마다 커밋한다.

**Files:**
- Create: `apps/studio/src/lib/component-edit.ts` (`componentToEditReport`, `editReportToComponent`, `defaultSampleProps`, `samplePropsContext`)
- Test: `apps/studio/src/lib/__tests__/component-edit.test.ts`
- Modify: `apps/studio/src/lib/data.ts` (`sampleContext(report, props?)`, `requestBody(report, liveData, props?)`)
- Test: `apps/studio/src/lib/__tests__/data.test.ts` (추가)
- Modify: `apps/studio/src/editor/canvas/layoutCache.ts` (`layoutFor(report, props?)`, `layoutError(report, props?)`)
- Test: `apps/studio/src/editor/canvas/__tests__/layoutCache.test.ts` (추가)
- Modify: `apps/studio/src/editor/canvas/Canvas.tsx`, `apps/studio/src/editor/PageSelector.tsx`, `apps/studio/src/editor/Preview.tsx` (샘플 props 전달)
- Test: `apps/studio/src/editor/__tests__/Preview.test.tsx` (추가), `apps/studio/src/editor/canvas/__tests__/Canvas.props.test.tsx`
- Create: `apps/studio/src/editor/panels/PropsPanel.tsx`
- Test: `apps/studio/src/editor/__tests__/PropsPanel.test.tsx`
- Modify: `apps/studio/src/editor/Toolbar.tsx` (컴포넌트 모드 버전 표시·저장·사용처·일괄 적용, 라벨·PDF 숨김)
- Test: `apps/studio/src/editor/__tests__/Toolbar.component.test.tsx`
- Modify: `apps/studio/src/editor/Editor.tsx` (Task 10의 `componentMode` prop·`Tab` 목록에 입력값 탭 추가, 컴포넌트 모드에서 데이터 탭 대신 입력값 탭), `apps/studio/src/editor/panels/PagePanel.tsx` (컴포넌트 모드는 크기만), `apps/studio/src/editor/store.ts` (컴포넌트 모드에서 `replaceWithComponent` 무시. `insertComponent`는 Task 9가 이미 막는다)
- Test: `apps/studio/src/editor/__tests__/Editor.test.tsx` (추가), `apps/studio/src/editor/__tests__/panels.test.tsx` (추가), `apps/studio/src/editor/__tests__/store.test.ts` (추가)
- Create: `apps/studio/src/app/components/[id]/page.tsx`
- Test: `apps/studio/src/app/components/[id]/__tests__/page.test.tsx`

#### A. 편집용 레포트 변환

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/component-edit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseComponentBody, type ComponentProp } from "@daport/core";
import { componentToEditReport, editReportToComponent, defaultSampleProps, samplePropsContext } from "../component-edit";

const body = parseComponentBody({ name: "회사 헤더", w: 180, h: 24,
  props: [
    { name: "title", type: "string", default: "품질보증서", label: "제목" },
    { name: "showLogo", type: "boolean", default: true },
    { name: "copies", type: "number", default: 2 },
    { name: "logo", type: "image", default: "asset://logo" },
  ],
  elements: [
    { id: "t", type: "text", x: 0, y: 0, w: 100, h: 10, value: "{{ props.title }}" },
    { id: "g", type: "group", x: 100, y: 0, w: 80, h: 24, children: [{ id: "l", type: "line", x: 0, y: 0, w: 80, h: 0, x2: 80, y2: 0 }] },
  ] });

describe("componentToEditReport", () => {
  it("wraps the body in a report whose page is the component box without margins or datasets", () => {
    const r = componentToEditReport("company-header", body);
    expect(r).toMatchObject({ id: "component-company-header", name: "회사 헤더", page: { width: 180, height: 24, margin: [0, 0, 0, 0] },
      datasets: [], params: [], components: {}, output: { kind: "pdf" } });
    expect(r.elements).toEqual(body.elements);
  });
  it("copies the elements so edits of the report do not touch the body", () => {
    const r = componentToEditReport("company-header", body);
    (r.elements[0] as { x: number }).x = 50;
    expect(body.elements[0].x).toBe(0);
  });
});

describe("editReportToComponent", () => {
  it("round-trips a body with its props", () => {
    expect(editReportToComponent(componentToEditReport("company-header", body), body.props)).toEqual(body);
  });
  it("takes name, size and elements from the edited report and props from the argument", () => {
    const r = componentToEditReport("company-header", body);
    const edited = { ...r, name: "새 헤더", page: { ...r.page, width: 150, height: 30 }, elements: r.elements.slice(0, 1) };
    const props: ComponentProp[] = [{ name: "title", type: "string", default: "X" }];
    const out = editReportToComponent(edited, props);
    expect(out).toEqual({ name: "새 헤더", w: 150, h: 30, props, elements: [body.elements[0]] });
    props[0].name = "changed";
    (edited.elements[0] as { x: number }).x = 9;
    expect(out.props[0].name).toBe("title");                 // 복제본을 돌려준다
    expect(out.elements[0].x).toBe(0);
  });
});

describe("defaultSampleProps", () => {
  it("maps each declared name to its default", () => {
    expect(defaultSampleProps(body.props)).toEqual({ title: "품질보증서", showLogo: true, copies: 2, logo: "asset://logo" });
  });
});

describe("samplePropsContext", () => {
  const mode = (sampleProps: Record<string, unknown>, props: ComponentProp[] = body.props) => ({ componentId: "company-header", version: 1, props, sampleProps });
  it("overlays sample values on defaults, drops undeclared names and values of the wrong type", () => {
    expect(samplePropsContext(mode({ title: "샘플", showLogo: "yes", copies: 5, extra: 1 })))
      .toEqual({ title: "샘플", showLogo: true, copies: 5, logo: "asset://logo" });
  });
  it("returns the same object for the same mode object and a new one for a new mode object", () => {
    const m = mode({ title: "A" });
    expect(samplePropsContext(m)).toBe(samplePropsContext(m));
    expect(samplePropsContext({ ...m })).not.toBe(samplePropsContext(m));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/component-edit.test.ts`
Expected: FAIL — `../component-edit` 모듈을 찾을 수 없음.

- [ ] **Step 3: 구현**

`apps/studio/src/lib/component-edit.ts`:
```ts
import { parseReport, type ComponentBody, type ComponentProp, type Report } from "@daport/core";

/** 스토어 componentMode와 같은 모양 (store.ts를 import하면 lib가 React·zustand에 묶이므로 구조 타입으로 받는다) */
export type ComponentModeLike = { componentId: string; version: number; props: ComponentProp[]; sampleProps: Record<string, unknown> };

/** 스펙 7.5: 컴포넌트 상자 크기의 여백 없는 페이지, 데이터셋 없음. 요소는 복제한다 */
export function componentToEditReport(id: string, body: ComponentBody): Report {
  return parseReport({
    id: `component-${id}`, name: body.name, version: 1,
    page: { width: body.w, height: body.h, margin: [0, 0, 0, 0] },
    elements: structuredClone(body.elements),
  });
}

/** 편집용 레포트 → 저장할 내용. 이름·크기·요소는 레포트에서, 입력값 선언은 componentMode에서. 검증은 서버(ComponentBodySchema)가 한다 */
export function editReportToComponent(report: Report, props: ComponentProp[]): ComponentBody {
  return { name: report.name, w: report.page.width, h: report.page.height, props: structuredClone(props), elements: structuredClone(report.elements) };
}

/** 편집 화면을 열 때의 샘플 값: 선언마다 기본값 */
export function defaultSampleProps(props: ComponentProp[]): Record<string, unknown> {
  return Object.fromEntries(props.map((p) => [p.name, p.default]));
}

const fitsType = (p: ComponentProp, v: unknown) =>
  p.type === "number" ? typeof v === "number" && Number.isFinite(v) : p.type === "boolean" ? typeof v === "boolean" : typeof v === "string";

const contextMemo = new WeakMap<ComponentModeLike, Record<string, unknown>>();

/**
 * 캔버스·미리보기 컨텍스트의 props: 기본값 위에 타입이 맞는 샘플 값을 얹고, 선언에 없는 이름은 버린다 (렌더러 5.2와 같은 규칙).
 * 같은 componentMode 객체에는 같은 결과 객체를 돌려준다 — 캔버스 레이아웃 캐시가 참조로 비교한다
 */
export function samplePropsContext(mode: ComponentModeLike): Record<string, unknown> {
  let out = contextMemo.get(mode);
  if (!out) {
    out = {};
    for (const p of mode.props) out[p.name] = Object.hasOwn(mode.sampleProps, p.name) && fitsType(p, mode.sampleProps[p.name]) ? mode.sampleProps[p.name] : p.default;
    contextMemo.set(mode, out);
  }
  return out;
}
```

스토어의 `setComponentProps`·`setSampleProps`(Task 9)는 `componentMode`를 새 객체로 바꾼다(zustand 불변 갱신). 그래서 선언·샘플 값이 바뀌면 `samplePropsContext`가 새 객체를 만들고, 바뀌지 않으면 같은 객체가 유지된다.

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/component-edit.test.ts`
Expected: PASS (7건).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/lib/component-edit.ts apps/studio/src/lib/__tests__/component-edit.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 내용과 편집용 레포트 사이 변환, 샘플 입력값 컨텍스트

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### B. 샘플 입력값을 캔버스·미리보기 컨텍스트에

- [ ] **Step 6: 실패 테스트 작성 — data·layoutCache**

`apps/studio/src/lib/__tests__/data.test.ts` 끝에 추가:
```ts
describe("sample props (컴포넌트 모드)", () => {
  it("puts props into the canvas context and does not let sample data override it", () => {
    const r = parseReport({ ...base, sample: { params: {}, data: { props: [{ title: "data" }] }, capturedAt: "2026-09-17T00:00:00.000Z" } });
    const ctx = sampleContext(r, { title: "샘플" });
    expect(ctx.props).toEqual({ title: "샘플" });
    expect(Object.hasOwn(sampleContext(r), "props")).toBe(false);
  });
  it("adds props to the request body only when given", () => {
    const r = parseReport(base);
    expect(requestBody(r, false, { title: "샘플" })).toEqual({ report: r, params: {}, props: { title: "샘플" } });
    expect("props" in requestBody(r, false)).toBe(false);
  });
});
```

`apps/studio/src/editor/canvas/__tests__/layoutCache.test.ts` 끝에 추가:
```ts
describe("layoutFor with sample props", () => {
  const titled = parseReport({ id: "r3", version: 1, page: { width: 100, height: 20, margin: [0, 0, 0, 0] },
    elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "{{ props.title }}" }] });
  const lines = (pages: ReturnType<typeof layoutFor>) => {
    const it = pages[0].items.find((i) => i.elementId === "t");
    return it?.kind === "text" ? it.lines : [];
  };
  it("lays out with the given props and caches per (report, props) reference", () => {
    const a = { title: "A" }, b = { title: "B" };
    const first = layoutFor(titled, a);
    expect(lines(first)).toEqual(["A"]);
    expect(layoutFor(titled, a)).toBe(first);
    const second = layoutFor(titled, b);
    expect(lines(second)).toEqual(["B"]);
    expect(second).not.toBe(first);
    expect(layoutError(titled, b)).toBeUndefined();
  });
});
```

- [ ] **Step 7: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/data.test.ts src/editor/canvas/__tests__/layoutCache.test.ts`
Expected: FAIL — `ctx.props`가 undefined, 본문에 `props` 없음, 두 번째 레이아웃이 첫 결과를 그대로 돌려줌.

- [ ] **Step 8: data.ts 구현**

`apps/studio/src/lib/data.ts`에서 `sampleContext`의 시그니처와 앞부분을 바꾼다:
```ts
export function sampleContext(report: Report, props?: Record<string, unknown>): DataContext {
  const params = resolveParams(report, { ...sampleParams(report), ...report.sample?.params }, { checkRequired: false });
  const ctx: DataContext = { params };
  // 컴포넌트 편집 화면의 샘플 입력값 (스펙 7.5). 데이터셋·sample.data 이름보다 먼저 넣어 같은 이름이 덮지 못하게 한다 (props는 예약어)
  if (props) setContext(ctx, "props", props);
```
(나머지 본문은 그대로.)

`requestBody`를 다음으로 바꾼다:
```ts
/** 미리보기·PDF 요청 본문 (스펙 7.5). 편집 중에는 sample.data를 보내 서버 데이터셋을 실행하지 않는다. 실데이터 토글이 켜지면 data를 빼고 보낸다.
 *  props는 컴포넌트 편집 화면의 샘플 입력값이며 있을 때만 싣는다 (3b 스펙 7.5, data 키가 아니라 본문 필드) */
export function requestBody(report: Report, liveData: boolean, props?: Record<string, unknown>):
  { report: Report; params: Record<string, unknown>; props?: Record<string, unknown>; data?: Record<string, unknown> } {
  const body = { report, params: { ...sampleParams(report), ...report.sample?.params }, ...(props ? { props } : {}) };
  return liveData || !report.sample ? body : { ...body, data: report.sample.data };
}
```

- [ ] **Step 9: layoutCache 구현**

`apps/studio/src/editor/canvas/layoutCache.ts`의 두 WeakMap 선언과 `layoutFor`·`layoutError`를 다음으로 바꾼다(`blankPage`와 import는 그대로):
```ts
type Entry = { props: Record<string, unknown> | undefined; pages: Page[]; error?: string };
const cache = new WeakMap<Report, Entry>();

/**
 * 캔버스가 그리는 레이아웃. 스토어의 report 객체는 편집마다 새로 만들어지므로 객체를 키로 한 번만 계산해
 * 캔버스와 페이지 선택기가 같은 결과를 쓴다. 스펙 10: 디자이너는 표현식 오류를 요소마다 #ERR로 보인다.
 * props(컴포넌트 편집 화면의 샘플 입력값)는 참조로 비교한다 — 같은 report라도 props 객체가 바뀌면 다시 계산한다.
 *
 * 이 함수는 전체(total) 함수다 — layout()이 무엇을 던지든(예: 200행 샘플에 여러 페이지 표를 반복해 상한을 넘는
 * LayoutLimitError) 여기서 잡아 빈 페이지 1장을 돌려준다. Toolbar의 PageSelector는 EditorErrorBoundary 밖에
 * 있어(Toolbar.tsx), 여기서 던지면 편집기 전체가 언마운트되고 저장 안 한 편집을 모두 잃는다.
 */
export function layoutFor(report: Report, props?: Record<string, unknown>): Page[] {
  const hit = cache.get(report);
  if (hit && hit.props === props) return hit.pages;
  const entry: Entry = { props, pages: [] };
  try {
    entry.pages = layout({ ...resolveAssetUrls(report, ""), onExpressionError: "blank" }, sampleContext(report, props));
  } catch (e) {
    entry.pages = [blankPage(report)];
    entry.error = e instanceof Error ? e.message : String(e);
  }
  cache.set(report, entry);
  return entry.pages;
}

/** layoutFor가 캐시해 둔 오류 메시지. 정상 계산이거나 같은 props로 계산한 적이 없으면 undefined (Canvas가 빨간 배너로 보인다) */
export function layoutError(report: Report, props?: Record<string, unknown>): string | undefined {
  const hit = cache.get(report);
  return hit && hit.props === props ? hit.error : undefined;
}
```

- [ ] **Step 10: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/lib/__tests__/data.test.ts src/editor/canvas/__tests__/layoutCache.test.ts`
Expected: PASS (기존 케이스 포함).

- [ ] **Step 11: 실패 테스트 작성 — 캔버스·미리보기**

`apps/studio/src/editor/canvas/__tests__/Canvas.props.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { Canvas } from "../Canvas";
import { PageSelector } from "../../PageSelector";

const report = parseReport({ id: "component-hdr", version: 1, page: { width: 100, height: 20, margin: [0, 0, 0, 0] },
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 60, h: 8, value: "제목: {{ props.title }}" }] });
const props = [{ name: "title", type: "string" as const, default: "기본" }];

afterEach(cleanup);

describe("Canvas in component mode", () => {
  it("draws with the sample props and redraws when they change", () => {
    const store = createEditorStore(report, { componentMode: { componentId: "hdr", version: 1, props, sampleProps: { title: "샘플" } } });
    const { getByTestId } = render(<EditorContext.Provider value={store}><Canvas zoom={1} /><PageSelector /></EditorContext.Provider>);
    expect(getByTestId("canvas").textContent).toContain("제목: 샘플");
    act(() => store.getState().setSampleProps({}));
    expect(getByTestId("canvas").textContent).toContain("제목: 기본");               // 샘플이 없으면 기본값
    act(() => store.getState().setComponentProps([{ name: "title", type: "string", default: "새 기본" }]));
    expect(getByTestId("canvas").textContent).toContain("제목: 새 기본");
    expect(getByTestId("page-indicator").textContent).toBe("1 / 1");
  });
});
```

`apps/studio/src/editor/__tests__/Preview.test.tsx`의 `describe("Preview", ...)` 안 끝에 추가:
```tsx
  it("sends the sample props in component mode and none otherwise", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("<p>ok</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const cm = createEditorStore(report, { componentMode: { componentId: "hdr", version: 1,
      props: [{ name: "title", type: "string", default: "기본" }, { name: "n", type: "number", default: 1 }], sampleProps: { title: "샘플", junk: 1 } } });
    const { unmount } = render(<EditorContext.Provider value={cm}><Preview reportId="component-hdr" /></EditorContext.Provider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).props).toEqual({ title: "샘플", n: 1 });
    act(() => cm.getState().setSampleProps({ title: "다시" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).props).toEqual({ title: "다시", n: 1 });
    unmount();
    render(<EditorContext.Provider value={createEditorStore(report)}><Preview reportId="r" /></EditorContext.Provider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect("props" in JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toBe(false);
  });
```

- [ ] **Step 12: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.props.test.tsx src/editor/__tests__/Preview.test.tsx`
Expected: FAIL — 캔버스가 `#ERR`를 그리고(props 없음), 미리보기 본문에 `props`가 없음.

- [ ] **Step 13: 캔버스·페이지 선택기·미리보기 구현**

`apps/studio/src/editor/canvas/Canvas.tsx`:
- import 추가: `import { samplePropsContext } from "@/lib/component-edit";`
- Task 10이 `findParentRepeater` 선택자 아래에 넣은 `const componentMode = useEditor((s) => s.componentMode);`를 그대로 쓴다(`const pages = useMemo(...)`보다 위에 있다. 새로 선언하지 않는다). 레이아웃 두 줄(`const pages = ...`, 주석, `const error = ...`)을 다음으로 바꾼다:
```tsx
  // 컴포넌트 편집 화면은 샘플 입력값을 props로 넣어 그린다 (스펙 7.5). 같은 componentMode 객체면 같은 props 객체라 캐시가 유지된다
  const sampleProps = componentMode ? samplePropsContext(componentMode) : undefined;
  const pages = useMemo(() => layoutFor(report, sampleProps), [report, sampleProps]);
  // layoutFor는 전체 함수라 오류가 나도 던지지 않고 빈 페이지를 준다 — 여기서 배너로 알린다 (Finding 1)
  const error = layoutError(report, sampleProps);
```

`apps/studio/src/editor/PageSelector.tsx`:
- import 추가: `import { samplePropsContext } from "@/lib/component-edit";`
- `const pages = useMemo(() => layoutFor(report), [report]);`를 다음으로 바꾼다(캔버스와 같은 props 객체로 캐시를 공유한다):
```tsx
  const componentMode = useEditor((s) => s.componentMode);
  const sampleProps = componentMode ? samplePropsContext(componentMode) : undefined;
  const pages = useMemo(() => layoutFor(report, sampleProps), [report, sampleProps]);
```

`apps/studio/src/editor/Preview.tsx`:
- import 추가: `import { samplePropsContext } from "@/lib/component-edit";`
- `const bitmapPreview = useEditor((s) => s.bitmapPreview);` 아래에 추가:
```tsx
  const componentMode = useEditor((s) => s.componentMode);
  const sampleProps = componentMode ? samplePropsContext(componentMode) : undefined;
```
- 두 `fetch` 호출의 `body: JSON.stringify(requestBody(report, liveData))`를 모두 `body: JSON.stringify(requestBody(report, liveData, sampleProps))`로 바꾼다.
- `useEffect`의 의존성 배열을 `[report, reportId, liveData, isLabel, bitmapPreview, sampleProps]`로 바꾼다.

- [ ] **Step 14: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/canvas/__tests__/Canvas.props.test.tsx src/editor/__tests__/Preview.test.tsx src/editor/canvas/__tests__`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add apps/studio/src/lib/data.ts apps/studio/src/lib/__tests__/data.test.ts apps/studio/src/editor/canvas/layoutCache.ts apps/studio/src/editor/canvas/__tests__/layoutCache.test.ts apps/studio/src/editor/canvas/Canvas.tsx apps/studio/src/editor/PageSelector.tsx apps/studio/src/editor/Preview.tsx apps/studio/src/editor/canvas/__tests__/Canvas.props.test.tsx apps/studio/src/editor/__tests__/Preview.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 편집 화면의 샘플 입력값을 캔버스·미리보기 컨텍스트에 넣기

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### C. 입력값 패널

- [ ] **Step 16: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/PropsPanel.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { parseReport, type ComponentProp } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropsPanel } from "../panels/PropsPanel";

const report = parseReport({ id: "component-hdr", version: 1, page: { width: 100, height: 20, margin: [0, 0, 0, 0] } });

function setup(props: ComponentProp[] = [], sampleProps: Record<string, unknown> = {}) {
  const store = createEditorStore(report, { componentMode: { componentId: "hdr", version: 1, props, sampleProps } });
  render(<EditorContext.Provider value={store}><PropsPanel /></EditorContext.Provider>);
  const row = (i: number) => within(screen.getByTestId(`prop-${i}`));
  const mode = () => store.getState().componentMode!;
  return { store, row, mode };
}

afterEach(cleanup);

describe("PropsPanel", () => {
  it("adds string props with unique names outside the undo history and marks the component dirty", () => {
    const { store, mode } = setup();
    fireEvent.click(screen.getByRole("button", { name: "입력값 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "입력값 추가" }));
    expect(mode().props).toEqual([{ name: "prop1", type: "string", default: "" }, { name: "prop2", type: "string", default: "" }]);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().report).toBe(report);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it("renames a prop, moves its sample value and warns about invalid or duplicate names", () => {
    const { row, mode } = setup([{ name: "a", type: "string", default: "" }, { name: "b", type: "string", default: "" }], { a: "샘플" });
    fireEvent.change(row(0).getByLabelText("이름"), { target: { value: "title" } });
    expect(mode().props[0].name).toBe("title");
    expect(mode().sampleProps).toEqual({ title: "샘플" });
    fireEvent.change(row(0).getByLabelText("이름"), { target: { value: "1bad" } });
    expect(row(0).getByText("이름은 영문자·숫자·_이며 숫자로 시작할 수 없습니다")).toBeTruthy();
    fireEvent.change(row(0).getByLabelText("이름"), { target: { value: "b" } });
    expect(row(0).getByText("이름이 겹칩니다")).toBeTruthy();
    expect(row(1).getByText("이름이 겹칩니다")).toBeTruthy();
  });

  it("changes the type with a typed default, edits default and label, and drops the stale sample", () => {
    const { row, mode } = setup([{ name: "n", type: "string", default: "x", label: "개수" }], { n: "x" });
    fireEvent.change(row(0).getByLabelText("타입"), { target: { value: "number" } });
    expect(mode().props[0]).toEqual({ name: "n", type: "number", default: 0, label: "개수" });
    expect(mode().sampleProps).toEqual({});
    fireEvent.change(row(0).getByLabelText("기본값"), { target: { value: "3" } });
    expect(mode().props[0]).toMatchObject({ default: 3 });
    fireEvent.change(row(0).getByLabelText("타입"), { target: { value: "boolean" } });
    expect(mode().props[0]).toMatchObject({ type: "boolean", default: false });
    fireEvent.click(row(0).getByLabelText("기본값"));
    expect(mode().props[0]).toMatchObject({ default: true });
    fireEvent.change(row(0).getByLabelText("타입"), { target: { value: "image" } });
    expect(mode().props[0]).toMatchObject({ type: "image", default: "" });
    fireEvent.change(row(0).getByLabelText("기본값"), { target: { value: "asset://logo" } });
    expect(mode().props[0]).toMatchObject({ default: "asset://logo" });
    fireEvent.change(row(0).getByLabelText("라벨"), { target: { value: "" } });
    expect(mode().props[0]).toEqual({ name: "n", type: "image", default: "asset://logo" });   // 빈 라벨은 지운다
  });

  it("moves props up and down, disables moves at the ends and deletes with its sample value", () => {
    const three: ComponentProp[] = [{ name: "a", type: "string", default: "" }, { name: "b", type: "number", default: 1 }, { name: "c", type: "boolean", default: true }];
    const { row, mode } = setup(three, { a: "x", b: 2 });
    expect((row(0).getByRole("button", { name: "위로" }) as HTMLButtonElement).disabled).toBe(true);
    expect((row(2).getByRole("button", { name: "아래로" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row(0).getByRole("button", { name: "아래로" }));
    expect(mode().props.map((p) => p.name)).toEqual(["b", "a", "c"]);
    fireEvent.click(row(2).getByRole("button", { name: "위로" }));
    expect(mode().props.map((p) => p.name)).toEqual(["b", "c", "a"]);
    fireEvent.click(row(0).getByRole("button", { name: "삭제" }));
    expect(mode().props.map((p) => p.name)).toEqual(["c", "a"]);
    expect(mode().sampleProps).toEqual({ a: "x" });
  });

  it("edits sample values by type without touching the declarations, and shows defaults when unset", () => {
    const props: ComponentProp[] = [{ name: "title", type: "string", default: "기본" }, { name: "qty", type: "number", default: 1 }, { name: "show", type: "boolean", default: true }];
    const { row, mode } = setup(props, {});
    expect((row(0).getByLabelText("샘플 값") as HTMLInputElement).value).toBe("기본");
    expect((row(2).getByLabelText("샘플 값") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(row(0).getByLabelText("샘플 값"), { target: { value: "샘플" } });
    fireEvent.change(row(1).getByLabelText("샘플 값"), { target: { value: "7" } });
    fireEvent.change(row(1).getByLabelText("샘플 값"), { target: { value: "" } });   // 숫자가 아니면 커밋하지 않는다
    fireEvent.click(row(2).getByLabelText("샘플 값"));
    expect(mode().sampleProps).toEqual({ title: "샘플", qty: 7, show: false });
    expect(mode().props).toEqual(props);                                             // 샘플 값은 선언을 바꾸지 않는다
  });
});
```

- [ ] **Step 17: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/PropsPanel.test.tsx`
Expected: FAIL — `../panels/PropsPanel` 모듈을 찾을 수 없음.

- [ ] **Step 18: PropsPanel 구현**

`apps/studio/src/editor/panels/PropsPanel.tsx`:
```tsx
"use client";
import type { ComponentProp } from "@daport/core";
import { useEditor } from "../store";
import { TextField, NumberField, CheckField, SelectField } from "./Field";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES: ComponentProp["type"][] = ["string", "number", "boolean", "image"];

/** 타입을 바꾸면 기본값을 그 타입의 빈 값으로 맞춘다 (ComponentPropSchema: default는 타입과 맞아야 한다) */
function withType(p: ComponentProp, type: ComponentProp["type"]): ComponentProp {
  const base = { name: p.name, ...(p.label !== undefined ? { label: p.label } : {}) };
  switch (type) {
    case "number": return { ...base, type, default: 0 };
    case "boolean": return { ...base, type, default: false };
    case "string": return { ...base, type, default: "" };
    case "image": return { ...base, type, default: "" };
  }
}

function nameProblem(props: ComponentProp[], i: number): string | null {
  const name = props[i].name;
  if (!IDENT_RE.test(name)) return "이름은 영문자·숫자·_이며 숫자로 시작할 수 없습니다";
  if (props.some((p, j) => j !== i && p.name === name)) return "이름이 겹칩니다";
  return null;
}

/** 기본값·샘플 값 입력 칸. 타입마다 입력 방식이 다르다 */
function ValueInput({ prop, label, value, onChange }: { prop: ComponentProp; label: string; value: unknown; onChange: (v: string | number | boolean) => void }) {
  if (prop.type === "number") return <NumberField label={label} step={1} value={typeof value === "number" ? value : prop.default} onChange={onChange} />;
  if (prop.type === "boolean") return <CheckField label={label} value={typeof value === "boolean" ? value : prop.default} onChange={onChange} />;
  return <TextField label={label} value={typeof value === "string" ? value : prop.default} onChange={onChange} />;
}
```

같은 파일에 이어서:
```tsx
/**
 * 컴포넌트 편집 화면의 입력값 패널 (스펙 7.5). 선언은 setComponentProps(저장 대상, dirty), 샘플 값은 setSampleProps(저장하지 않음, 캔버스·미리보기용).
 * 둘 다 되돌리기 히스토리 밖이다. 이름 규칙 위반·중복은 입력 중에도 커밋하고 경고만 보인다(저장 시 서버가 400으로 거부)
 */
export function PropsPanel() {
  const mode = useEditor((s) => s.componentMode);
  const setComponentProps = useEditor((s) => s.setComponentProps);
  const setSampleProps = useEditor((s) => s.setSampleProps);
  if (!mode) return null;
  const { props, sampleProps } = mode;

  const replaceAt = (i: number, next: ComponentProp) => setComponentProps(props.map((p, j) => (j === i ? next : p)));
  const withoutSample = (name: string) => { const { [name]: _drop, ...rest } = sampleProps; return rest; };

  const add = () => {
    const names = new Set(props.map((p) => p.name));
    let n = 1; while (names.has(`prop${n}`)) n++;
    setComponentProps([...props, { name: `prop${n}`, type: "string", default: "" }]);
  };
  const rename = (i: number, name: string) => {
    const old = props[i].name;
    replaceAt(i, { ...props[i], name });
    if (Object.hasOwn(sampleProps, old)) { const rest = withoutSample(old); setSampleProps({ ...rest, [name]: sampleProps[old] }); }
  };
  const changeType = (i: number, type: ComponentProp["type"]) => {
    if (props[i].type === type) return;
    replaceAt(i, withType(props[i], type));
    if (Object.hasOwn(sampleProps, props[i].name)) setSampleProps(withoutSample(props[i].name));
  };
  const setDefault = (i: number, v: string | number | boolean) => replaceAt(i, { ...props[i], default: v } as ComponentProp);
  const setLabel = (i: number, label: string) => {
    const { label: _old, ...rest } = props[i];
    replaceAt(i, (label === "" ? rest : { ...rest, label }) as ComponentProp);
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...props]; [next[i], next[i + d]] = [next[i + d], next[i]];
    setComponentProps(next);
  };
  const remove = (i: number) => {
    setComponentProps(props.filter((_, j) => j !== i));
    if (Object.hasOwn(sampleProps, props[i].name)) setSampleProps(withoutSample(props[i].name));
  };

  const btn = "text-xs border rounded px-2 py-0.5 bg-white hover:bg-neutral-100 disabled:opacity-40";
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">입력값</div>
      <div className="text-[11px] text-neutral-500">요소 안에서 {"{{ props.이름 }}"}으로 읽습니다</div>
      {props.map((p, i) => {
        const problem = nameProblem(props, i);
        return (
          <fieldset key={i} data-testid={`prop-${i}`} className="border rounded p-2 flex flex-col gap-1">
            <TextField label="이름" value={p.name} onChange={(v) => rename(i, v)} />
            {problem && <div className="text-xs text-red-700">{problem}</div>}
            <SelectField label="타입" value={p.type} options={TYPES} onChange={(t) => changeType(i, t)} />
            <ValueInput prop={p} label="기본값" value={p.default} onChange={(v) => setDefault(i, v)} />
            <TextField label="라벨" value={p.label ?? ""} onChange={(v) => setLabel(i, v)} />
            <ValueInput prop={p} label="샘플 값" value={sampleProps[p.name]} onChange={(v) => setSampleProps({ ...sampleProps, [p.name]: v })} />
            <div className="flex gap-1 mt-1">
              <button className={btn} disabled={i === 0} onClick={() => move(i, -1)}>위로</button>
              <button className={btn} disabled={i === props.length - 1} onClick={() => move(i, 1)}>아래로</button>
              <button className={btn + " ml-auto"} onClick={() => remove(i)}>삭제</button>
            </div>
          </fieldset>
        );
      })}
      <button className={btn + " self-start"} onClick={add}>입력값 추가</button>
    </div>
  );
}
```

- [ ] **Step 19: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/PropsPanel.test.tsx`
Expected: PASS (5건).

- [ ] **Step 20: Commit**

```bash
git add apps/studio/src/editor/panels/PropsPanel.tsx apps/studio/src/editor/__tests__/PropsPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 입력값 선언·샘플 값 패널

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### D. 툴바 컴포넌트 모드

- [ ] **Step 21: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/Toolbar.component.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport, type ComponentProp } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { Toolbar } from "../Toolbar";
import { editReportToComponent } from "@/lib/component-edit";

const report = parseReport({ id: "component-hdr", name: "회사 헤더", version: 1, page: { width: 180, height: 24, margin: [0, 0, 0, 0] },
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 100, h: 10, value: "{{ props.title }}" }] });
const props: ComponentProp[] = [{ name: "title", type: "string", default: "기본" }];

type Reply = { version: number; hash: string; created: boolean } | { error: string; status: number };
function setup(opts: { reply?: Reply; usage?: unknown; apply?: unknown; output?: "label" } = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/components/hdr" && method === "PUT") {
      const r = opts.reply ?? { version: 6, hash: "h6", created: true };
      return "error" in r ? Response.json({ error: r.error }, { status: r.status }) : Response.json(r);
    }
    if (url === "/api/components/hdr/usage") return Response.json(opts.usage ?? [{ reportId: "a", versions: [5] }, { reportId: "b", versions: [4] }]);
    if (url === "/api/components/hdr/apply-latest") return Response.json(opts.apply ?? { updated: ["a"], skipped: [{ reportId: "b", error: "size mismatch" }] });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const initial = opts.output === "label" ? { ...report, output: { kind: "label" as const, label: { language: "zpl" as const, dpi: 203 as const } } } : report;
  const store = createEditorStore(parseReport(initial), { componentMode: { componentId: "hdr", version: 5, props, sampleProps: {} } });
  render(<EditorContext.Provider value={store}><Toolbar reportId="component-hdr" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
  return { store, calls };
}
const text = (id: string) => screen.getByTestId(id).textContent;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Toolbar in component mode", () => {
  it("shows the version to be created and hides PDF and label actions", () => {
    setup({ output: "label" });
    expect(text("component-version")).toBe("v5 (저장하면 v6)");
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    expect(screen.queryByTestId("label-download")).toBeNull();
    expect(screen.queryByLabelText("비트맵")).toBeNull();
    expect(screen.getByTestId("save")).toBeTruthy();
    expect(screen.queryByTestId("component-usage")).toBeNull();
  });

  it("saves a new version from the edited report and props, then shows usage", async () => {
    const { store, calls } = setup();
    act(() => store.getState().setComponentProps([...props, { name: "sub", type: "string", default: "" }]));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(text("component-usage")).toBe("사용하는 레포트 2개"));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/components/hdr");
    expect(put.body).toEqual({ body: editReportToComponent(store.getState().report, store.getState().componentMode!.props) });
    expect(calls.some((c) => c.url.startsWith("/api/reports"))).toBe(false);          // 레포트 저장 경로를 쓰지 않는다
    expect(text("component-status")).toBe("v6 저장됨");
    expect(text("component-version")).toBe("v6 (저장하면 v7)");
    expect(store.getState().componentMode!.version).toBe(6);
    expect(store.getState().dirty).toBe(false);
  });

  it("shows 변경 없음 and keeps the version when the server created nothing", async () => {
    const { store } = setup({ reply: { version: 5, hash: "h5", created: false } });
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(text("component-status")).toBe("변경 없음"));
    expect(text("component-version")).toBe("v5 (저장하면 v6)");
    await waitFor(() => expect(screen.getByTestId("component-usage")).toBeTruthy());
  });

  it("applies the latest version to all reports after confirmation and summarizes the result", async () => {
    const { store, calls } = setup();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    const apply = await screen.findByRole("button", { name: "모든 레포트에 최신 적용" });
    fireEvent.click(apply);
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("2개 레포트"));
    expect(calls.some((c) => c.url.endsWith("/apply-latest"))).toBe(false);          // 취소하면 요청하지 않는다
    fireEvent.click(apply);
    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    const post = calls.find((c) => c.url === "/api/components/hdr/apply-latest")!;
    expect(post.method).toBe("POST");
    expect(alertMock.mock.calls[0][0]).toContain("1개 레포트에 적용했습니다");
    expect(alertMock.mock.calls[0][0]).toContain("건너뜀 b: size mismatch");
  });

  it("disables 모든 레포트에 최신 적용 when no report uses the component", async () => {
    const { store } = setup({ usage: [] });
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(text("component-usage")).toBe("사용하는 레포트 0개"));
    expect((screen.getByRole("button", { name: "모든 레포트에 최신 적용" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports a failed save with the server error and stays dirty", async () => {
    const { store } = setup({ reply: { error: "duplicate element id: t", status: 400 } });
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("duplicate element id: t")));
    expect(store.getState().dirty).toBe(true);
    expect(text("component-version")).toBe("v5 (저장하면 v6)");
    expect(screen.queryByTestId("component-status")).toBeNull();
  });

  it("stays dirty when the props change while the save request is in flight", async () => {
    const { store } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { if (init?.method === "PUT") await gate; return original(url, init); }));
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    act(() => store.getState().setComponentProps([]));
    await act(async () => { release(); });
    await waitFor(() => expect(text("component-status")).toBe("v6 저장됨"));
    expect(store.getState().dirty).toBe(true);
  });
});
```

- [ ] **Step 22: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/Toolbar.component.test.tsx`
Expected: FAIL — `component-version`을 찾지 못함, PDF 버튼이 보임.

- [ ] **Step 23: Toolbar 구현 — 상태와 동작**

`apps/studio/src/editor/Toolbar.tsx`:

1. import 추가:
```tsx
import { editReportToComponent, samplePropsContext } from "@/lib/component-edit";
import { saveComponent, fetchUsage, applyLatest } from "./library/api";
import type { Usage } from "@/lib/component-usage";
```

2. `const isLabel = report.output.kind === "label";` 줄과 Task 12가 그 아래에 넣은 `selection`·`componentMode`·`makeCheck`·`making` 네 줄을 다음으로 바꾼다(`componentMode`를 `isLabel`보다 먼저 읽는다):
```tsx
  const selection = useEditor((s) => s.selection);
  const componentMode = useEditor((s) => s.componentMode);
  // 컴포넌트 편집 화면에서는 라벨·PDF 동작을 두지 않는다 (편집용 레포트의 출력 설정은 저장되지 않는다)
  const isLabel = report.output.kind === "label" && !componentMode;
  const sampleProps = componentMode ? samplePropsContext(componentMode) : undefined;
  // 스펙 7.3: 조건이 안 맞으면 비활성, 사유는 툴팁
  const makeCheck = makeComponentCheck(report, selection, !!componentMode);
  const [making, setMaking] = useState(false);
  /** 컴포넌트 저장 결과("v6 저장됨"·"변경 없음")와 저장 뒤 사용처 (스펙 7.5) */
  const [componentStatus, setComponentStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const [applying, setApplying] = useState(false);
```

3. `pdf`·`label`·`print`의 `requestBody(report, liveData)` 세 곳을 `requestBody(report, liveData, sampleProps)`로 바꾼다(`print`는 `...requestBody(report, liveData, sampleProps)`).

4. `const save = async () => { ... };` 정의 바로 뒤에 추가:
```tsx
  /** 컴포넌트 모드 저장: PUT /api/components/:id. 같은 내용이면 서버가 버전을 올리지 않는다(created: false) */
  const saveComponentVersion = async () => {
    const mode = store.getState().componentMode;
    if (!mode) return;
    const saved = store.getState().report;
    setSaving(true);
    setComponentStatus(null);
    try {
      const res = await saveComponent(mode.componentId, editReportToComponent(saved, mode.props));
      markSaved(saved);
      const now = store.getState().componentMode;
      if (now) {
        // 요청 중에 입력값 선언을 고쳤으면 그 변경은 저장되지 않았다. markSaved는 report만 비교하므로 여기서 dirty로 남긴다
        store.setState({ componentMode: { ...now, version: res.version }, ...(now.props !== mode.props ? { dirty: true } : {}) });
      }
      setComponentStatus(res.created ? `v${res.version} 저장됨` : "변경 없음");
      setUsage(await fetchUsage(mode.componentId).catch(() => null));
    } catch (e) {
      alert(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const applyAll = async () => {
    const mode = store.getState().componentMode;
    if (!mode || !usage) return;
    if (!confirm(`${usage.length}개 레포트의 인스턴스를 v${mode.version}(최신)으로 올립니다. 계속할까요?`)) return;
    setApplying(true);
    try {
      const res = await applyLatest(mode.componentId);
      alert([`${res.updated.length}개 레포트에 적용했습니다`, ...res.skipped.map((s) => `건너뜀 ${s.reportId}: ${s.error}`)].join("\n"));
      setUsage(await fetchUsage(mode.componentId).catch(() => usage));
    } catch (e) {
      alert(`적용 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApplying(false);
    }
  };
```

- [ ] **Step 24: Toolbar 구현 — JSX**

`apps/studio/src/editor/Toolbar.tsx`의 JSX에서:

1. 제목 `<span className="font-semibold text-sm">...</span>` 바로 뒤에 추가:
```tsx
      {componentMode && <span data-testid="component-version" className="text-xs text-neutral-500">{`v${componentMode.version} (저장하면 v${componentMode.version + 1})`}</span>}
```

2. `<button className={btn} disabled={exporting} onClick={pdf}>PDF</button>`와 저장 버튼 두 줄을 다음으로 바꾼다(라벨 블록 `{isLabel && <>...</>}`은 `isLabel`이 컴포넌트 모드에서 false라 그대로 둔다):
```tsx
      {!componentMode && <button className={btn} disabled={exporting} onClick={pdf}>PDF</button>}
      {componentMode && componentStatus && <span data-testid="component-status" className="text-xs text-neutral-600">{componentStatus}</span>}
      {componentMode && usage && <>
        <span data-testid="component-usage" className="text-xs text-neutral-600">사용하는 레포트 {usage.length}개</span>
        <button className={btn} disabled={applying || usage.length === 0} onClick={applyAll}>모든 레포트에 최신 적용</button>
      </>}
      <button className={btn} disabled={saving || !dirty} onClick={componentMode ? saveComponentVersion : save} data-testid="save">저장</button>
```

- [ ] **Step 25: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/Toolbar.component.test.tsx src/editor/__tests__/Toolbar.test.tsx src/editor/__tests__/MakeComponentDialog.test.tsx`
Expected: PASS (컴포넌트 모드 7건, 기존 Toolbar·Task 12 테스트 그대로).

- [ ] **Step 26: Commit**

```bash
git add apps/studio/src/editor/Toolbar.tsx apps/studio/src/editor/__tests__/Toolbar.component.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 모드 툴바 — 버전 표시, 새 버전 저장, 사용처와 모든 레포트에 최신 적용

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### E. 에디터 컴포넌트 모드와 `/components/:id` 화면

- [ ] **Step 27: 실패 테스트 작성 — 스토어·페이지 패널·에디터**

`apps/studio/src/editor/__tests__/store.test.ts`의 core import(Task 9가 바꾼 `import { parseReport, ElementSchema, extractComponent, type Element, type ComponentBody } from "@daport/core";`)에 `parseComponentBody`를 더해 다음으로 바꾸고:
```ts
import { parseReport, ElementSchema, extractComponent, parseComponentBody, type Element, type ComponentBody } from "@daport/core";
```
파일 끝에 추가한다(`insertComponent` 무시는 Task 9 테스트에도 있지만, 두 액션을 한 테스트에서 함께 확인한다):
```ts
describe("component mode guards (중첩 금지, 스펙 4.1·7.5)", () => {
  const body = parseComponentBody({ name: "H", w: 10, h: 5, elements: [{ id: "x", type: "rect", x: 0, y: 0, w: 10, h: 5 }] });
  const mode = { componentId: "self", version: 1, props: [], sampleProps: {} };
  it("ignores insertComponent and replaceWithComponent while editing a component", () => {
    const s = createEditorStore(report, { componentMode: mode });
    s.getState().insertComponent("hdr", 1, body, 10, 10);
    s.getState().replaceWithComponent(["a"], "hdr", 1, body, { x: 10, y: 10, w: 20, h: 5 });
    expect(s.getState().report).toBe(report);
    expect(s.getState().history.past).toHaveLength(0);
  });
  it("still inserts components in a normal report", () => {
    const s = createEditorStore(report);
    s.getState().insertComponent("hdr", 1, body, 10, 10);
    expect(s.getState().report.components["hdr@1"]).toBeDefined();
  });
});
```

`apps/studio/src/editor/__tests__/panels.test.tsx` 끝에 추가:
```tsx
describe("PagePanel in component mode", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("shows only the component size and does not load presets", () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(parseReport({ id: "component-hdr", version: 1, page: { width: 180, height: 24, margin: [0, 0, 0, 0] } }),
      { componentMode: { componentId: "hdr", version: 1, props: [], sampleProps: {} } });
    mount(store, <PagePanel />);
    expect(screen.getByText("컴포넌트 크기")).toBeTruthy();
    expect(screen.queryByLabelText("프리셋")).toBeNull();
    expect(screen.queryByText("반복")).toBeNull();
    fireEvent.change(screen.getByLabelText("높이(mm)"), { target: { value: "30" } });
    expect(store.getState().report.page).toMatchObject({ width: 180, height: 30 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

`apps/studio/src/editor/__tests__/Editor.test.tsx` 끝에 추가:
```tsx
describe("Editor component mode", () => {
  const editReport = parseReport({ id: "component-hdr", name: "회사 헤더", version: 1, page: { width: 180, height: 24, margin: [0, 0, 0, 0] }, elements: [] });
  const componentMode = { componentId: "hdr", version: 2, props: [{ name: "title", type: "string" as const, default: "기본" }], sampleProps: { title: "기본" } };
  const tab = (name: string) => screen.queryByRole("button", { name });

  it("shows 요소·입력값 tabs instead of 데이터·컴포넌트 and the component toolbar", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    render(<Editor initial={editReport} componentMode={componentMode} />);
    expect(tab("요소")).toBeTruthy();
    expect(tab("입력값")).toBeTruthy();
    expect(tab("데이터")).toBeNull();
    expect(tab("컴포넌트")).toBeNull();
    expect(screen.getByTestId("component-version").textContent).toBe("v2 (저장하면 v3)");
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    fireEvent.click(tab("입력값")!);
    expect(screen.getByRole("button", { name: "입력값 추가" })).toBeTruthy();
    expect((screen.getByLabelText("이름") as HTMLInputElement).value).toBe("title");
    fireEvent.click(tab("요소")!);
    expect(screen.getByText("+ 텍스트")).toBeTruthy();
    expect(screen.queryByText(/\+ 컴포넌트|\+ ref/)).toBeNull();                   // 팔레트에 ref 추가 항목이 없다
  });

  it("keeps 데이터·컴포넌트 tabs and no 입력값 tab for a normal report", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    render(<Editor initial={report} />);
    expect(tab("데이터")).toBeTruthy();
    expect(tab("컴포넌트")).toBeTruthy();
    expect(tab("입력값")).toBeNull();
    expect(screen.queryByTestId("component-version")).toBeNull();
  });
});
```

- [ ] **Step 28: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/store.test.ts src/editor/__tests__/panels.test.tsx src/editor/__tests__/Editor.test.tsx`
Expected: FAIL — 컴포넌트 모드에서 `replaceWithComponent`가 레포트를 바꾸고(Task 9는 `insertComponent`만 막는다), PagePanel에 "컴포넌트 크기"가 없고, Editor의 컴포넌트 모드 탭이 Task 10의 요소·데이터라 "입력값" 탭이 없고 "데이터" 탭이 보인다.

- [ ] **Step 29: 스토어·PagePanel 구현**

`apps/studio/src/editor/store.ts`: Task 9의 `insertComponent`는 이미 첫 줄에서 `if (get().componentMode) return;`으로 막는다. 같은 검사를 Task 9의 `replaceWithComponent`에도 넣는다(컴포넌트 안에 ref를 넣지 않는다 — 대화상자·JSON 밖 경로를 스토어에서 막는다). 다음 두 줄
```ts
      replaceWithComponent: (ids, id, version, body, box) => {
        const refId = get().allocateId(id);
```
을 다음으로 바꾼다:
```ts
      replaceWithComponent: (ids, id, version, body, box) => {
        if (get().componentMode) return;   // 스펙 4.1·7.5: 중첩 컴포넌트 금지
        const refId = get().allocateId(id);
```

`apps/studio/src/editor/panels/PagePanel.tsx`:
1. `const [error, setError] = useState<string | null>(null);` 아래에 추가:
```tsx
  const componentMode = useEditor((s) => s.componentMode);
```
2. `useEffect(() => { void refresh(); }, []);`를 다음으로 바꾼다:
```tsx
  // 컴포넌트 편집 화면에는 프리셋 UI가 없으므로 목록을 요청하지 않는다
  const inComponentMode = !!componentMode;   // 입력값을 고칠 때마다 componentMode 객체가 바뀌므로 모드 여부만 의존한다
  useEffect(() => { if (!inComponentMode) void refresh(); }, [inComponentMode]);
```
3. `const btn = "text-xs border rounded ...";` 줄 바로 뒤, `return (` 앞에 추가:
```tsx
  // 스펙 7.5: 페이지 너비·높이가 곧 컴포넌트 w·h다. 여백·프리셋·출력·반복은 컴포넌트 내용에 저장되지 않으므로 보이지 않는다
  if (componentMode) {
    return (
      <div className="p-3 flex flex-col gap-2">
        <div className="text-xs font-semibold">컴포넌트 크기</div>
        <NumberField label="너비(mm)" value={page.width} onChange={(width) => { if (width > 0) updatePage({ width }); }} />
        <NumberField label="높이(mm)" value={page.height} onChange={(height) => { if (height > 0) updatePage({ height }); }} />
      </div>
    );
  }
```

- [ ] **Step 30: Editor 구현**

`apps/studio/src/editor/Editor.tsx` (Task 10이 `componentMode` prop, `type Tab`·`TAB_LABEL`·`tabs` 목록, `LibraryPanel` 분기를 넣어 둔 상태에서 고친다):

1. import 추가(`type EditorState`는 Task 10이 이미 가져온다). Task 10이 넣은 `import { LibraryPanel } from "./library/LibraryPanel";` 아래에:
```tsx
import { PropsPanel } from "./panels/PropsPanel";
```

2. Task 10이 넣은 두 줄
```tsx
type Tab = "elements" | "data" | "components";
const TAB_LABEL: Record<Tab, string> = { elements: "요소", data: "데이터", components: "컴포넌트" };
```
을 다음으로 바꾼다:
```tsx
type Tab = "elements" | "data" | "components" | "props";
const TAB_LABEL: Record<Tab, string> = { elements: "요소", data: "데이터", components: "컴포넌트", props: "입력값" };
```

3. Task 10이 넣은 탭 목록 줄
```tsx
  const tabs: Tab[] = componentMode ? ["elements", "data"] : ["elements", "data", "components"];
```
을 다음으로 바꾼다(컴포넌트 편집 화면은 데이터셋이 없고 중첩 금지라 데이터·컴포넌트 탭 대신 입력값 탭, 스펙 7.5):
```tsx
  const tabs: Tab[] = componentMode ? ["elements", "props"] : ["elements", "data", "components"];
```

4. Task 10이 넣은 패널 분기 세 줄
```tsx
            {tab === "elements" && <ElementPalette />}
            {tab === "data" && <DataPanel reportId={initial.id} />}
            {tab === "components" && <LibraryPanel />}
```
아래에 한 줄을 추가한다:
```tsx
            {tab === "props" && <PropsPanel />}
```

팔레트(`ElementPalette`)의 항목에는 ref가 없고, 컴포넌트 모드에서는 라이브러리 탭이 없으며, 캔버스로 라이브러리 항목을 끌어 놓아도 캔버스가 거부하고(Task 10) 스토어의 `insertComponent`도 무시한다(Task 9). 선택 영역 → 컴포넌트도 대화상자 검사(Task 12)와 `replaceWithComponent`(Step 29)가 막는다. 그래서 컴포넌트 안에 ref를 추가하는 UI 경로가 없다. JSON 편집기로 넣은 ref는 저장 시 서버의 `ComponentBodySchema`가 거부한다(400, 툴바가 오류를 띄운다).

- [ ] **Step 31: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/store.test.ts src/editor/__tests__/panels.test.tsx src/editor/__tests__/Editor.test.tsx`
Expected: PASS.

- [ ] **Step 32: 실패 테스트 작성 — `/components/:id` 페이지**

`apps/studio/src/app/components/[id]/__tests__/page.test.tsx`:
```tsx
// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from "vitest";
import { parseComponentBody } from "@daport/core";

vi.mock("@/editor/Editor", () => ({ Editor: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const v1 = parseComponentBody({ name: "헤더", w: 100, h: 20, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "A" }] });
const v2 = parseComponentBody({ ...v1, h: 30, props: [{ name: "title", type: "string", default: "기본" }, { name: "show", type: "boolean", default: false }] });

beforeAll(() => { delete process.env.DATABASE_URL; });

describe("component edit page", () => {
  it("opens the editor in component mode on the latest version with defaults as sample props", async () => {
    const { getComponentStore } = await import("@/lib/component-store");
    await getComponentStore().create("page-test-hdr", v1);
    await getComponentStore().save("page-test-hdr", v2);
    const { default: ComponentPage } = await import("../page");
    const { Editor } = await import("@/editor/Editor");
    const { componentToEditReport } = await import("@/lib/component-edit");
    const el = await ComponentPage({ params: Promise.resolve({ id: "page-test-hdr" }) });
    expect(el.type).toBe(Editor);
    expect(el.props.initial).toEqual(componentToEditReport("page-test-hdr", v2));
    expect(el.props.componentMode).toEqual({ componentId: "page-test-hdr", version: 2, props: v2.props, sampleProps: { title: "기본", show: false } });
  });

  it("calls notFound for an unknown component", async () => {
    const { default: ComponentPage } = await import("../page");
    await expect(ComponentPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
```

- [ ] **Step 33: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run "src/app/components/[id]/__tests__/page.test.tsx"`
Expected: FAIL — `../page` 모듈을 찾을 수 없음.

- [ ] **Step 34: 페이지 구현**

`apps/studio/src/app/components/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getComponentStore } from "@/lib/component-store";
import { componentToEditReport, defaultSampleProps } from "@/lib/component-edit";
import { Editor } from "@/editor/Editor";

export const dynamic = "force-dynamic";

/** 컴포넌트 편집 화면 (스펙 7.5). 최신 버전 내용을 편집용 레포트로 감싸 기존 에디터를 컴포넌트 모드로 연다 */
export default async function ComponentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getComponentStore().get(id);
  if (!detail) notFound();
  const body = detail.latest;
  return (
    <Editor initial={componentToEditReport(id, body)}
      componentMode={{ componentId: id, version: detail.summary.latestVersion, props: body.props, sampleProps: defaultSampleProps(body.props) }} />
  );
}
```

- [ ] **Step 35: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run "src/app/components/[id]/__tests__/page.test.tsx"`
Expected: PASS (2건).

Run: `pnpm --filter studio test`
Expected: 모두 통과.

- [ ] **Step 36: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음.

- [ ] **Step 37: Commit**

```bash
git add apps/studio/src/editor/Editor.tsx apps/studio/src/editor/panels/PagePanel.tsx apps/studio/src/editor/store.ts apps/studio/src/editor/__tests__/Editor.test.tsx apps/studio/src/editor/__tests__/panels.test.tsx apps/studio/src/editor/__tests__/store.test.ts "apps/studio/src/app/components/[id]/page.tsx" "apps/studio/src/app/components/[id]/__tests__/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat(studio): 컴포넌트 편집 화면 — 에디터 컴포넌트 모드와 /components/:id

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: E2E와 저장 경고 표시

레포트 저장이 성공했을 때 응답 헤더 `X-Daport-Warnings`(스펙 6.3)가 있으면 툴바에 경고를 보여주고, 스펙 9장의 E2E 5개 흐름을 `apps/studio/e2e/components.spec.ts`로 구현한다.

**Files:**
- Modify: `apps/studio/src/editor/Toolbar.tsx` (레포트 저장 성공 뒤 경고 헤더 읽기, `data-testid="save-warnings"` 표시)
- Test: `apps/studio/src/editor/__tests__/Toolbar.test.tsx` (파일 끝에 describe 추가)
- Create: `apps/studio/e2e/components.spec.ts`

전제: Task 8(경고 헤더), Task 10(라이브러리 패널 "컴포넌트" 탭, `COMPONENT_MIME` 드롭), Task 11(RefPanel, `refBox` 선택), Task 12("컴포넌트로 만들기" 대화상자), Task 13(`/components/:id` 편집 화면, PropsPanel), Task 9(Cmd+G·Cmd+Shift+G)가 끝나 있다.

E2E가 기대는 화면 이름·테스트 id (Task 10–13과 맞춰야 한다):
- 왼쪽 패널 탭 버튼 `컴포넌트` (`getByRole("button", { name: "컴포넌트", exact: true })`), 탭 안 목록에 컴포넌트 이름 텍스트
- 캔버스 드롭 MIME `application/x-daport-component`, 값은 컴포넌트 id
- 툴바 버튼 `컴포넌트로 만들기`, 대화상자는 `role="dialog"`, 입력 `이름`·`id`(라벨), 확인 버튼 `만들기`
- 캔버스 인스턴스 항목 `[data-element-id="<refId>"][data-role="refBox"]`
- RefPanel 업데이트 버튼 이름 `v1 → v2 업데이트`, 입력값 칸의 접근 가능한 이름은 `입력값 <name>`(여기서는 `입력값 title`, Task 11 `PropField`의 `aria-label`)
- PropsPanel 버튼 `입력값 추가`, 추가된 행은 `data-testid="prop-<순번>"`이고 그 안의 입력 라벨 `이름`·`타입`(select)·`기본값` (Task 13 `PropsPanel`)
- 컴포넌트 모드 툴바 버전 표시 `v1 (저장하면 v2)` → 저장 후 `v2 (저장하면 v3)`, 저장 버튼은 레포트 모드와 같은 `data-testid="save"`
- 컴포넌트 편집 화면의 JSON 편집기 모델 URI도 `report.json`으로 끝난다(`Editor`를 그대로 쓰므로)
- 텍스트 속성 입력 `내용`, 저장 경고 `data-testid="save-warnings"`

- [ ] **Step 1: 저장 경고 표시 실패 테스트 작성**

`apps/studio/src/editor/__tests__/Toolbar.test.tsx` 파일 끝에 추가 (같은 파일의 `setup()`을 쓴다):
```tsx
describe("Toolbar save warnings", () => {
  const warned = (value: string | null) =>
    new Response("{}", { status: 200, headers: value === null ? {} : { "X-Daport-Warnings": value } });

  it("shows the warnings from the X-Daport-Warnings header after a successful save", async () => {
    const { store, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => warned(JSON.stringify(["component hdr@2 is not in the library", "component std@1 is not in the library"])));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));   // 경고가 있어도 저장은 성공이다
    const box = await screen.findByTestId("save-warnings");
    expect(box.textContent).toContain("component hdr@2 is not in the library");
    expect(box.textContent).toContain("component std@1 is not in the library");
  });

  it("shows nothing without the header, and clears earlier warnings on the next successful save", async () => {
    const { store, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => warned(JSON.stringify(["component hdr@2 is not in the library"])));
    fireEvent.click(screen.getByTestId("save"));
    await screen.findByTestId("save-warnings");
    act(() => store.getState().updatePage({ width: 120 }));   // 다시 저장할 수 있게 편집
    fetchMock.mockImplementationOnce(async () => warned(null));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(screen.queryByTestId("save-warnings")).toBeNull();
  });

  it("ignores a malformed header or a non-string array without breaking the save", async () => {
    const { store, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => warned("not json"));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(screen.queryByTestId("save-warnings")).toBeNull();
    act(() => store.getState().updatePage({ width: 130 }));
    fetchMock.mockImplementationOnce(async () => warned(JSON.stringify([1, { a: 1 }, "component x@1 is not in the library"])));
    fireEvent.click(screen.getByTestId("save"));
    const box = await screen.findByTestId("save-warnings");
    expect(box.textContent).toContain("component x@1 is not in the library");
    expect(box.textContent).not.toContain("[object Object]");
  });

  it("does not show warnings when the save fails", async () => {
    const { store, fetchMock } = setup();
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "component hdr@1 differs from the library", code: "COMPONENT_MISMATCH" }),
      { status: 409, headers: { "X-Daport-Warnings": JSON.stringify(["component a@1 is not in the library"]) } }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("component hdr@1 differs from the library"));
    expect(store.getState().dirty).toBe(true);
    expect(screen.queryByTestId("save-warnings")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/Toolbar.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="save-warnings"]` (첫 번째·세 번째 새 테스트). 기존 테스트는 통과

- [ ] **Step 3: 툴바에 저장 경고 표시 구현**

`apps/studio/src/editor/Toolbar.tsx`:

1. `failureMessage` 함수 바로 아래(컴포넌트 밖)에 추가:
```tsx
/**
 * 레포트 저장 응답의 경고 헤더 (스펙 6.3). 값은 문자열의 JSON 배열이다.
 * 이 이름은 서버의 lib/report-guard.ts WARNINGS_HEADER와 같다. 그 모듈은 DB 저장소를 import하므로 클라이언트에서 가져오지 않는다
 */
const WARNINGS_HEADER = "X-Daport-Warnings";
function saveWarnings(r: Response): string[] {
  const raw = r.headers.get(WARNINGS_HEADER);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];   // 헤더가 깨져도 저장 성공은 그대로 둔다
  }
}
```

2. `const [exporting, setExporting] = useState(false);` 바로 아래에 추가:
```tsx
  // 마지막 레포트 저장이 남긴 경고. 다음 저장을 시작하면 지운다
  const [warnings, setWarnings] = useState<string[]>([]);
```

3. 레포트 저장 함수 `save`(`/api/reports/${reportId}`로 `PUT`을 보내는 함수. Task 13이 추가한 컴포넌트 저장 `saveComponentVersion`은 건드리지 않는다)에서 요청 앞의 `setSaving(true);`를 아래로 바꾼다:
```tsx
    setSaving(true);
    setWarnings([]);
```
   같은 분기의 성공 처리 줄 `if (r.ok) { markSaved(saved); return; }`를 아래로 바꾼다:
```tsx
      if (r.ok) { markSaved(saved); setWarnings(saveWarnings(r)); return; }
```

4. JSX의 저장 버튼(Task 13이 바꾼 `<button className={btn} disabled={saving || !dirty} onClick={componentMode ? saveComponentVersion : save} data-testid="save">저장</button>`) 바로 앞에 추가(경고는 레포트 저장에서만 채워지므로 컴포넌트 모드에서는 보이지 않는다):
```tsx
      {warnings.length > 0 && (
        <span role="status" data-testid="save-warnings" className="text-xs text-amber-700 max-w-md truncate" title={warnings.join("\n")}>
          저장했지만 경고가 있습니다: {warnings.join(", ")}
        </span>
      )}
```

- [ ] **Step 4: 통과 확인**

Run: `cd apps/studio && pnpm exec vitest run src/editor/__tests__/Toolbar.test.tsx`
Expected: PASS (기존 테스트와 새 4개 모두)

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/editor/Toolbar.tsx apps/studio/src/editor/__tests__/Toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): 레포트 저장 후 X-Daport-Warnings 경고를 툴바에 표시

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: E2E 작성 — 공용 도우미**

`apps/studio/e2e/components.spec.ts` (Step 6–9의 코드 조각을 순서대로 이어 한 파일로 만든다).

품질보증서는 `editor.spec.ts`가 다른 워커에서 동시에 옮기고 되돌리므로, 이 파일은 저장된 시드와 같은 픽스처 JSON을 실행마다 새 id로 복제해 쓴다(`/reports/quality-cert` 자체는 건드리지 않는다). 컴포넌트 id·이름도 실행마다 새로 만들어 재사용한 dev 서버에서도 결과가 같다.

```ts
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import qualityCert from "../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json" with { type: "json" };

const COMPONENT_MIME = "application/x-daport-component";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const LOT = { lotNo: "L2609-0142" };   // 품질보증서의 필수 파라미터

type El = { id: string; type: string; x: number; y: number; w: number; h: number; ref?: string; version?: number;
  props?: Record<string, unknown>; children?: El[] };
type Model = { elements: El[]; components: Record<string, unknown> };

// Monaco는 보이는 줄만 DOM에 그리므로 JsonEditor가 window.monaco로 노출한 모델에서 편집 중인 JSON을 읽는다
async function readModel(page: Page): Promise<Model | null> {
  const text = await page.evaluate(() => {
    const monaco = (window as any).monaco;
    const m = monaco?.editor.getModels().find((x: any) => x.uri.path.endsWith("report.json"));
    return m ? (m.getValue() as string) : null;
  });
  try { return text ? (JSON.parse(text) as Model) : null; } catch { return null; }
}
const refsIn = async (page: Page) => ((await readModel(page))?.elements ?? []).filter((e) => e.type === "ref");

/** 품질보증서 픽스처를 새 id로 저장한다 (저장 검사를 거치는 POST) */
async function copyQualityCert(page: Page, id: string) {
  const res = await page.request.post("/api/reports", { data: { ...qualityCert, id, name: `품질보증서 ${id}` } });
  expect(res.status(), `create ${id}`).toBe(201);
}

/** 레포트를 열고 캔버스와 Monaco 모델이 뜰 때까지 기다린다 */
async function openReport(page: Page, id: string) {
  await page.goto(`/reports/${id}`);
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
  await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();
}

/** 저장 버튼을 누르고 PUT 응답을 받아 저장됨(비활성)까지 기다린다 */
async function saveReport(page: Page, id: string) {
  const save = page.getByTestId("save");
  await expect(save).toBeEnabled();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/reports/${id}`),
    save.click(),
  ]);
  expect(res.ok(), `save ${id} HTTP ${res.status()}`).toBe(true);
  await expect(save).toBeDisabled();
  await expect(page.getByTestId("save-warnings")).toHaveCount(0);   // 품은 내용이 라이브러리와 같으면 경고가 없다
}

/** 미리보기 iframe 첫 페이지의 글자와 주어진 글자의 화면 위치 */
async function previewSnapshot(page: Page, text: string) {
  await page.getByRole("button", { name: "미리보기" }).click();
  const frame = page.frameLocator('iframe[title="preview"]');
  const target = frame.getByText(text, { exact: true });
  await expect(target).toBeVisible({ timeout: 15_000 });
  const snap = { text: await frame.locator(".dp-page").first().innerText(), box: await target.boundingBox() };
  await page.getByRole("button", { name: "디자인" }).click();
  return snap;
}

/** PDF 첫 페이지의 풀린 내용 스트림. 같은 레포트라도 생성 시각이 달라 파일 바이트는 매번 다르므로 그리기 명령만 비교한다 */
async function pdfPageContent(page: Page, reportId: string): Promise<string> {
  const res = await page.request.post(`/api/reports/${reportId}/pdf`, { data: { params: LOT } });
  expect(res.ok(), `PDF HTTP ${res.status()}`).toBe(true);
  const doc = await PDFDocument.load(await res.body());
  expect(doc.getPageCount()).toBe(1);
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "")).join("\n");
}

/** 라이브러리 항목을 캔버스에 놓는다. HTML5 DnD는 DataTransfer를 직접 만들어 drop을 보낸다 (phase2.spec.ts와 같은 방식) */
async function dropComponent(page: Page, componentId: string, dx: number, dy: number) {
  const dt = await page.evaluateHandle(([mime, id]) => { const d = new DataTransfer(); d.setData(mime, id); return d; }, [COMPONENT_MIME, componentId] as const);
  const pageEl = page.getByTestId("canvas").locator(".dp-page");
  const box = (await pageEl.boundingBox())!;
  await pageEl.dispatchEvent("dragover", { dataTransfer: dt, clientX: box.x + dx, clientY: box.y + dy });
  await pageEl.dispatchEvent("drop", { dataTransfer: dt, clientX: box.x + dx, clientY: box.y + dy });
}

/** 인스턴스를 선택한다. 인스턴스 안 어느 항목이든 elementId가 인스턴스 id다 (스펙 5.3) */
async function selectInstance(page: Page, refId: string) {
  const inst = page.getByTestId("canvas").locator(`[data-element-id="${refId}"][data-role="refBox"]`);
  await expect(inst).toHaveCount(1);
  // refBox는 투명 사각형이라 그 위에 인스턴스 자식 항목이 겹친다. 가려짐 검사를 건너뛰고 좌표로 누르면 맨 위 자식(같은 elementId)이 눌린다
  await inst.click({ force: true });
}
```

- [ ] **Step 7: E2E 작성 — 흐름 1~3 (선택 영역 → 컴포넌트, 입력값을 더한 v2, 레포트에서 업데이트)**

같은 파일에 이어서:
```ts
// 흐름 1~3은 앞 흐름이 만든 레포트·컴포넌트를 이어 쓴다
test.describe.serial("component from a selection, new version with a prop, update in the report", () => {
  const stamp = Date.now();
  const reportId = `e2e-comp-qc-${stamp}`;
  const componentId = `e2e-hdr-${stamp}`;
  const componentName = `E2E 헤더 ${stamp}`;
  let refId = "";

  test("1. select header elements → 컴포넌트로 만들기 → one instance, same preview", async ({ page }) => {
    await copyQualityCert(page, reportId);
    await openReport(page, reportId);
    const canvas = page.getByTestId("canvas");
    const before = await previewSnapshot(page, "품 질 보 증 서");

    await canvas.locator('[data-element-id="title"]').click();
    await canvas.locator('[data-element-id="subtitle"]').click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "컴포넌트로 만들기", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("이름", { exact: true }).fill(componentName);
    await dialog.getByLabel("id", { exact: true }).fill(componentId);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/components"),
      dialog.getByRole("button", { name: "만들기", exact: true }).click(),
    ]);
    expect(created.status()).toBe(201);
    expect(await created.json()).toMatchObject({ version: 1 });
    await expect(dialog).toHaveCount(0);

    // 선택 요소 둘이 사라지고 경계 상자(15,20 ~ 195,40) 자리에 인스턴스 하나
    await expect.poll(async () => (await refsIn(page)).length).toBe(1);
    const [ref] = await refsIn(page);
    expect(ref).toMatchObject({ ref: componentId, version: 1, x: 15, y: 20, w: 180, h: 20 });
    refId = ref.id;
    const model = (await readModel(page))!;
    expect(model.elements.some((e) => e.id === "title" || e.id === "subtitle")).toBe(false);
    expect(Object.keys(model.components)).toEqual([`${componentId}@1`]);
    await expect(canvas.locator(`[data-element-id="${refId}"][data-role="refBox"]`)).toHaveCount(1);
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: "품 질 보 증 서" })).toBeVisible();

    // 미리보기는 변환 전과 같다: 첫 페이지 글자와 제목 위치
    const after = await previewSnapshot(page, "품 질 보 증 서");
    expect(after.text).toBe(before.text);
    expect(after.box).toEqual(before.box);

    // 라이브러리 v1 내용은 상자 기준 상대좌표
    const lib = await (await page.request.get(`/api/components/${componentId}`)).json();
    expect(lib.summary).toMatchObject({ id: componentId, name: componentName, latestVersion: 1, w: 180, h: 20 });
    expect(lib.latest.elements.map((e: El) => [e.id, e.x, e.y])).toEqual([["title", 0, 0], ["subtitle", 0, 14]]);

    await saveReport(page, reportId);   // 저장 검사: 품은 v1 해시가 라이브러리와 같다
  });

  test("2. /components/:id: add prop title, bind the title text to props.title, save → v2", async ({ page }) => {
    await page.goto(`/components/${componentId}`);
    const canvas = page.getByTestId("canvas");
    await expect(canvas.locator('[data-element-id="title"]')).toBeVisible();
    await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();
    await expect(page.getByText("v1 (저장하면 v2)", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "입력값", exact: true }).click();   // 왼쪽 패널 입력값 탭 (처음에는 요소 탭이 열려 있다)
    await page.getByRole("button", { name: "입력값 추가", exact: true }).click();
    const prop = page.getByTestId("prop-0");
    await prop.getByLabel("이름", { exact: true }).fill("title");
    await prop.getByLabel("타입", { exact: true }).selectOption("string");
    await prop.getByLabel("기본값", { exact: true }).fill("품 질 보 증 서");   // 기존 인스턴스는 기본값으로 같은 글자를 보인다
    await page.getByRole("button", { name: "요소", exact: true }).click();

    await canvas.locator('[data-element-id="title"]').click();
    await page.getByLabel("내용", { exact: true }).fill("{{ props.title }}");
    await expect.poll(async () => (await readModel(page))?.elements.find((e) => e.id === "title")).toMatchObject({ value: "{{ props.title }}" });

    const save = page.getByTestId("save");
    await expect(save).toBeEnabled();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/components/${componentId}`),
      save.click(),
    ]);
    expect(res.ok(), `component save HTTP ${res.status()}`).toBe(true);
    expect(await res.json()).toMatchObject({ version: 2, created: true });
    await expect(page.getByText("v2 (저장하면 v3)", { exact: true })).toBeVisible();

    const v2 = await (await page.request.get(`/api/components/${componentId}/versions/2`)).json();
    expect(v2.body.props).toMatchObject([{ name: "title", type: "string", default: "품 질 보 증 서" }]);
    expect(v2.body.elements.find((e: { id: string }) => e.id === "title").value).toBe("{{ props.title }}");
    const v1 = await (await page.request.get(`/api/components/${componentId}/versions/1`)).json();
    expect(v1.body.props).toEqual([]);   // 옛 버전은 바뀌지 않는다
  });

  test("3. back in the report: v1 → v2 update, fill title → canvas, preview and PDF show it", async ({ page }) => {
    const pdfBefore = await pdfPageContent(page, reportId);   // 저장된 v1 인스턴스
    await openReport(page, reportId);
    const canvas = page.getByTestId("canvas");
    await selectInstance(page, refId);

    await page.getByRole("button", { name: /v1\s*→\s*v2 업데이트/ }).click();   // 크기가 같아 확인 대화상자가 없다
    await expect.poll(async () => (await refsIn(page))[0]).toMatchObject({ id: refId, version: 2, w: 180, h: 20 });
    expect(Object.keys((await readModel(page))!.components)).toEqual([`${componentId}@2`]);   // 옛 버전 정리
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: "품 질 보 증 서" })).toBeVisible();   // 기본값

    const title = "E2E 보증서 제목";
    await page.getByLabel("입력값 title", { exact: true }).fill(title);
    await expect.poll(async () => (await refsIn(page))[0]?.props).toEqual({ title });
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: title })).toBeVisible();
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: "품 질 보 증 서" })).toHaveCount(0);

    const preview = await previewSnapshot(page, title);
    expect(preview.text).toContain(title);
    expect(preview.text).not.toContain("품 질 보 증 서");

    await saveReport(page, reportId);   // 품은 v2 해시가 라이브러리 v2와 같다
    const html = await (await page.request.post(`/api/reports/${reportId}/preview`, { data: { params: LOT } })).text();
    expect(html).toContain(title);   // PDF 라우트가 인쇄하는 것과 같은 HTML
    expect(await pdfPageContent(page, reportId)).not.toBe(pdfBefore);   // 저장된 레포트의 PDF 그리기 명령이 바뀌었다
  });
});
```

- [ ] **Step 8: E2E 작성 — 흐름 4 (라이브러리에서 두 번 끌어다 놓기)**

같은 파일에 이어서. 흐름 1~3에 기대지 않도록 컴포넌트를 API로 직접 만든다(입력값 `title`이 있는 v1):
```ts
/** 홈 화면 폼으로 빈 A4 레포트를 만들고 캔버스와 Monaco 모델이 뜰 때까지 기다린다 */
async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
  await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();
}

test("4. drag the same library component twice into a new report and give each instance a different title", async ({ page }) => {
  const stamp = Date.now();
  const componentId = `e2e-badge-${stamp}`;
  const componentName = `E2E 배지 ${stamp}`;
  const created = await page.request.post("/api/components", { data: { id: componentId, body: {
    name: componentName, w: 80, h: 12, props: [{ name: "title", type: "string", default: "기본 제목" }],
    elements: [
      { id: "frame", type: "rect", x: 0, y: 0, w: 80, h: 12, style: { stroke: "#000", strokeWidth: 0.3 } },
      { id: "label", type: "text", x: 2, y: 2, w: 76, h: 8, value: "{{ props.title }}" },
    ] } } });
  expect(created.status()).toBe(201);

  const reportId = `e2e-comp-drop-${stamp}`;
  await createReport(page, reportId);
  await page.getByRole("button", { name: "컴포넌트", exact: true }).click();
  await expect(page.getByText(componentName, { exact: true })).toBeVisible();

  await dropComponent(page, componentId, 60, 60);
  await expect.poll(async () => (await refsIn(page)).length).toBe(1);
  await dropComponent(page, componentId, 60, 300);
  await expect.poll(async () => (await refsIn(page)).length).toBe(2);

  const [a, b] = await refsIn(page);
  expect(a.id).not.toBe(b.id);
  for (const r of [a, b]) expect(r).toMatchObject({ ref: componentId, version: 1, w: 80, h: 12 });
  expect(b.y).toBeGreaterThan(a.y + 12);   // 겹치지 않게 놓였다
  expect(Object.keys((await readModel(page))!.components)).toEqual([`${componentId}@1`]);   // 내용은 한 번만 품는다

  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-role="refBox"]')).toHaveCount(2);
  await selectInstance(page, a.id);
  await page.getByLabel("입력값 title", { exact: true }).fill("첫째 제목");
  await selectInstance(page, b.id);
  await page.getByLabel("입력값 title", { exact: true }).fill("둘째 제목");

  await expect.poll(async () => (await refsIn(page)).map((r) => r.props)).toEqual([{ title: "첫째 제목" }, { title: "둘째 제목" }]);
  await expect(canvas.locator(`[data-element-id="${a.id}"]`, { hasText: "첫째 제목" })).toBeVisible();
  await expect(canvas.locator(`[data-element-id="${b.id}"]`, { hasText: "둘째 제목" })).toBeVisible();
  await expect(canvas.getByText("기본 제목")).toHaveCount(0);

  await page.getByRole("button", { name: "미리보기" }).click();
  const frame = page.frameLocator('iframe[title="preview"]');
  await expect(frame.getByText("첫째 제목", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByText("둘째 제목", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "디자인" }).click();

  await saveReport(page, reportId);
  const stored = await (await page.request.get(`/api/reports/${reportId}`)).json();
  expect(stored.elements.filter((e: El) => e.type === "ref")).toHaveLength(2);
});
```

- [ ] **Step 9: E2E 작성 — 흐름 5 (그룹화·해제·되돌리기)**

같은 파일에 이어서:
```ts
test("5. select two elements → Cmd+G groups them, Cmd+Shift+G restores them, undo steps back one action each", async ({ page }) => {
  const reportId = `e2e-group-${Date.now()}`;
  const original = [
    { id: "a", type: "text", x: 20, y: 20, w: 40, h: 10, value: "AAA" },
    { id: "b", type: "text", x: 80, y: 40, w: 40, h: 10, value: "BBB" },
  ];
  const created = await page.request.post("/api/reports", { data: { id: reportId, name: reportId, version: 1, page: { width: 210, height: 297 }, elements: original } });
  expect(created.status()).toBe(201);
  await openReport(page, reportId);

  const canvas = page.getByTestId("canvas");
  const shape = async () => ((await readModel(page))?.elements ?? []).map((e) => ({
    id: e.type === "group" ? "(group)" : e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h,
    children: e.children?.map((c) => ({ id: c.id, x: c.x, y: c.y })),
  }));
  const flat = [
    { id: "a", type: "text", x: 20, y: 20, w: 40, h: 10, children: undefined },
    { id: "b", type: "text", x: 80, y: 40, w: 40, h: 10, children: undefined },
  ];
  const grouped = [{ id: "(group)", type: "group", x: 20, y: 20, w: 100, h: 30, children: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 60, y: 20 }] }];
  await expect.poll(shape).toEqual(flat);

  await canvas.locator('[data-element-id="a"]').click();
  await canvas.locator('[data-element-id="b"]').click({ modifiers: ["Shift"] });
  await page.keyboard.press(`${MOD}+g`);
  await expect.poll(shape).toEqual(grouped);
  const groupId = (await readModel(page))!.elements[0].id;
  expect(groupId).toMatch(/^group-\d+$/);
  await expect(canvas.locator('[data-element-id="a"]')).toHaveText(/AAA/);   // 그려진 결과는 그대로
  await expect(canvas.locator('[data-element-id="b"]')).toHaveText(/BBB/);

  await page.keyboard.press(`${MOD}+Shift+g`);   // 선택은 새 그룹이다
  await expect.poll(shape).toEqual(flat);

  await page.keyboard.press(`${MOD}+z`);          // 해제 되돌리기 → 그룹
  await expect.poll(shape).toEqual(grouped);
  expect((await readModel(page))!.elements[0].id).toBe(groupId);
  await page.keyboard.press(`${MOD}+z`);          // 그룹화 되돌리기 → 처음 두 요소
  await expect.poll(shape).toEqual(flat);
});
```

- [ ] **Step 10: E2E 실행**

Run: `lsof -ti :3000 | xargs kill; pnpm --filter studio e2e -- components.spec.ts`
Expected: PASS (5 tests). 실패하면 먼저 위 "E2E가 기대는 화면 이름·테스트 id" 목록과 Task 10–13 구현의 라벨·버튼 이름이 같은지 확인한다

- [ ] **Step 11: 기존 E2E 회귀 확인 (완료 기준 7)**

Run: `lsof -ti :3000 | xargs kill; pnpm --filter studio e2e`
Expected: PASS — `editor.spec.ts`, `phase2.spec.ts`, `phase3.spec.ts`, `components.spec.ts` 모두

- [ ] **Step 12: 전체 단위 테스트와 타입 검사**

Run: `pnpm -r test`
Expected: PASS (실패 0)

Run: `pnpm typecheck`
Expected: 오류 없이 종료

- [ ] **Step 13: 커밋**

```bash
git add apps/studio/e2e/components.spec.ts
git commit -m "$(cat <<'EOF'
test(studio): 컴포넌트 만들기·새 버전·업데이트·드롭·그룹화 E2E

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

