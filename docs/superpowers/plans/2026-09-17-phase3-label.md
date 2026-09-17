# daport 3단계 구현 플랜: 바코드·라벨 출력·페이지 프리셋

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 바코드 요소를 실제로 그리고, 라벨 레포트를 ZPL·TSPL 비트맵 명령으로 내보내며(다운로드 + 허용 목록 프린터 raw TCP 전송), 페이지 크기·출력 설정을 프리셋으로 저장해 재사용한다. 끝나면 문서 4종 + 코일 Tag + 제품 라벨, 6종이 예제로 존재한다.

**Architecture:** core에 `output`·프리셋 스키마와 바코드 형식을 더한다. renderer는 `bwip-js`로 바코드 SVG를 만들어 새 항목 `svg`로 낸다(HTML·PDF·라벨이 같은 SVG). Playwright 풀·폰트 서빙·크래시 판정을 새 패키지 `browser`로 옮겨 `pdf`와 새 패키지 `label`이 함께 쓴다. `label`은 같은 HTML을 목표 DPI로 스크린샷 → 임계값 이진화 → 행 패킹 → ZPL `^GF`/TSPL `BITMAP`. studio는 프리셋 저장소·API, 출력 설정 패널, 라벨 다운로드·프린터 전송·비트맵 미리보기, 바코드 팔레트를 더한다.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, zod 4, React 19, Next.js 16, zustand 5, Playwright, bwip-js 4, pngjs, Node `net`.

**Spec:** `docs/superpowers/specs/2026-09-17-daport-phase3-label-design.md` (상위: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` 5.4장, 2단계: `docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md`)

## Global Constraints

- 의존 방향: `browser`는 Playwright만 의존한다(renderer를 모른다). `pdf → renderer, browser`, `label → renderer, browser`, `renderer → core`. core·renderer는 입출력 없는 순수 코드(bwip-js `toSVG`는 순수 함수라 허용).
- 모든 기능은 범용이다. 코일 Tag·제품 라벨은 fixtures JSON으로만 존재하고 전용 코드는 없다.
- `pdf` 공개 API(`renderPdf`, `renderHtmlScreenshot`, `closePool`)는 바뀌지 않고 기존 pdf 테스트가 그대로 통과한다.
- 바코드: `format` = `code128 | ean13 | qr | code39 | datamatrix`; 값이 비었거나 형식에 안 맞으면 그 요소만 `#ERR`(blank) / 던짐(fail) — 2단계 셀 오류와 같은 `onExpressionError` 규칙. 1D는 상자에 맞춰 늘리고 2D는 상자 안에 정사각형으로 맞춘다.
- 라벨: `output.label = { language: zpl|tspl, dpi: 203|300, threshold 0–255 기본 128, darkness? 0–30, speed? 1–14, copies 기본 1 }`. 픽셀 크기 = `round(mm × dpi / 25.4)`. ZPL은 1=검정, TSPL `BITMAP` 모드 0은 0=검정(반전). 페이지마다 라벨 한 장(ZPL 블록 `^XA…^XZ` 하나, TSPL `SIZE…PRINT` 하나). 페이지 픽셀 수 > 50,000,000 → `LabelTooLargeError`(code `LABEL_TOO_LARGE`, 400).
- 전송: `DAPORT_PRINTERS="이름=host[:port],…"`(포트 기본 9100). 목록이 비면 UI에 전송 버튼 없음. 허용 목록 밖 이름 400, 연결 실패·타임아웃(10초) 502, 재시도 없음.
- 프리셋: `{ id(레포트 id 규칙), name, page, output, builtin }`. 내장 프리셋은 코드 상수, 사용자 정의는 저장소(`presets` 테이블 / 메모리). 내장 id 충돌 409, 내장 삭제 403. 프리셋 적용은 `page`+`output`을 바꾸는 편집 한 단위.
- 라우트 본문 규칙은 2단계와 같다(`readJsonBody` 20MB, `data` 우선, 데이터셋 오류 400 `{ error, datasetErrors }`, `LayoutLimitError` 400).
- 커밋 관례 `feat(<pkg>): …`; 태스크마다 `pnpm typecheck`와 해당 패키지 테스트 통과 후 커밋. 코드 주석·UI 문구 한국어, 식별자 영어.

---

## 공용 규약 (모든 태스크가 따르는 이름과 타입)

### core (`packages/core`)

`src/schema/output.ts` (신규)
```ts
export const LabelOutputSchema = z.object({
  language: z.enum(["zpl", "tspl"]),
  dpi: z.union([z.literal(203), z.literal(300)]),
  threshold: z.number().int().min(0).max(255).default(128),
  darkness: z.number().int().min(0).max(30).optional(),
  speed: z.number().int().min(1).max(14).optional(),
  copies: z.number().int().positive().default(1),
});
export const OutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf") }),
  z.object({ kind: z.literal("label"), label: LabelOutputSchema }),
]);
export type LabelOutput = z.infer<typeof LabelOutputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export const DEFAULT_OUTPUT: Output = { kind: "pdf" };
```
`src/schema/report.ts`: `output: OutputSchema.default({ kind: "pdf" })` (파싱 후 항상 존재). `src/schema/elements.ts`: `BarcodeElementSchema.format = z.enum(["code128", "ean13", "qr", "code39", "datamatrix"])`; `export type BarcodeElement`, `export type BarcodeFormat`.
`src/schema/preset.ts` (신규)
```ts
export const PresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  page: PageSchema,
  output: OutputSchema.default({ kind: "pdf" }),
  builtin: z.boolean().default(false),
});
export type Preset = z.infer<typeof PresetSchema>;
export type PresetInput = z.input<typeof PresetSchema>;
```

### renderer (`packages/renderer`)

`src/barcode/render.ts` (신규)
```ts
export class BarcodeError extends Error { constructor(public format: string, public value: string, cause: unknown) }   // name "BarcodeError"
export type BarcodeOptions = { showText: boolean; fontSize: number };   // fontSize pt (사람이 읽는 텍스트)
export const BARCODE_2D: ReadonlySet<string>;   // qr, datamatrix
/** bwip-js toSVG 결과의 루트 <svg>에서 width/height를 떼고 width="100%" height="100%" preserveAspectRatio(1D: none, 2D: xMidYMid meet)를 넣는다. 빈 값·형식 오류는 BarcodeError */
export function renderBarcode(format: BarcodeFormat, value: string, opts: BarcodeOptions): string;
```
`src/layout/types.ts`: `export type PlacedSvg = PlacedBase & { kind: "svg"; svg: string }`, `PlacedItem` union에 추가.
`src/layout/place.ts`: `case "barcode"` → `interpolate(el.value, ctx)` → `renderBarcode` → `{ ...base, kind: "svg", svg }`; catch는 `ExpressionError | BarcodeError`를 격리.
`src/paint/Paint.tsx`: `case "svg"` → `<div className="dp-el dp-svg" style={box} dangerouslySetInnerHTML={{ __html: item.svg }} />`. `css.ts`: `.dp-svg svg{width:100%;height:100%;display:block}`.
`src/index.ts`: `export * from "./barcode/render"`.

### browser (`packages/browser`, 신규 `@daport/browser`, Playwright만 의존)

```ts
export function getBrowser(): Promise<Browser>;           // pdf/src/pool.ts 그대로
export function closePool(): Promise<void>;
export const fontBaseUrl = "http://fonts.daport.local";
export function serveFonts(ctx: BrowserContext, fontsDir: string): Promise<void>;   // 폰트 디렉터리는 호출자가 준다
export function isBrowserCrash(e: unknown): boolean;      // pdf/src/crash.ts 그대로
export type PageOptions = { fontsDir: string; deviceScaleFactor?: number; setContentTimeoutMs?: number };
export function withPage<T>(html: string, opts: PageOptions, fn: (page: Page) => Promise<T>): Promise<T>;
```
`pdf/src/fonts-dir.ts`(신규): `export const fontsDir = dirname(createRequire(import.meta.url).resolve(/* turbopackIgnore: true */ "@daport/renderer/fonts/Pretendard-Regular.otf"))`. `label`도 같은 파일을 가진다(3줄, 각 패키지가 자기 위치에서 해석해야 하므로 복제).

### label (`packages/label`, 신규 `@daport/label`, renderer·browser 의존)

```ts
// src/bitmap.ts
export type Bitmap = { width: number; height: number; bits: Uint8Array };   // 행마다 ceil(width/8)바이트, MSB가 왼쪽, 1 = 검정, 남는 비트 0
export function rowBytes(width: number): number;
export function packGray(gray: Uint8Array, width: number, height: number, threshold: number): Bitmap;   // gray < threshold → 검정
export function rgbaToGray(rgba: Uint8Array, width: number, height: number): Uint8Array;               // 0.299R+0.587G+0.114B, 알파는 흰 배경에 합성
export function bitmapToPng(bitmap: Bitmap): Buffer;   // pngjs, 검정=0, 흰=255
export function pxOf(mm: number, dpi: number): number; // Math.round(mm * dpi / 25.4)
// src/encode.ts
export type LabelOptions = { widthMm: number; heightMm: number; dpi: number; copies: number; darkness?: number; speed?: number };
export function encodeZpl(bitmaps: Bitmap[], opts: LabelOptions): string;
export function encodeTspl(bitmaps: Bitmap[], opts: LabelOptions): Buffer;
// src/index.ts
export class LabelTooLargeError extends Error { readonly code = "LABEL_TOO_LARGE" }
export const MAX_LABEL_PIXELS = 50_000_000;
export type LabelResult = { language: "zpl" | "tspl"; dpi: number; pages: number; data: Buffer; mime: "text/plain" | "application/octet-stream"; filename: string };
export function rasterizePages(report: Report, data: DataContext, dpi: number, threshold: number): Promise<Bitmap[]>;
export function renderLabel(report: Report, data: DataContext): Promise<LabelResult>;   // report.output.kind !== "label" → Error("report output is not label")
export { closePool } from "@daport/browser";
```

### studio (`apps/studio`)

- `src/lib/presets.ts`: `export const BUILTIN_PRESETS: Preset[]` (A4 세로·가로, A3 세로·가로, Letter, 코일 Tag 100×150 · ZPL 203dpi, 제품 라벨 60×40 · ZPL 203dpi; id는 `a4-portrait` 등).
- `src/lib/preset-store.ts`: `interface PresetStore { list(): Promise<Preset[]>; get(id): Promise<Preset | null>; create(input: PresetInput): Promise<Preset>; delete(id): Promise<void> }`, `MemoryPresetStore`, `DbPresetStore`, `getPresetStore()`. `list()`는 내장 + 사용자 정의. `create`는 내장 id·기존 id 충돌 시 `ConflictError`, `delete`는 내장이면 `ForbiddenError`, 없으면 `NotFoundError`.
- `src/db/schema.ts`: `presets` 테이블 `{ id text pk, name text, body jsonb, createdAt }`.
- 라우트: `GET/POST /api/presets`, `DELETE /api/presets/[id]`, `POST /api/reports/[id]/label` (`?preview=png`), `GET /api/printers`, `POST /api/print`.
- `src/lib/printers.ts`: `export type Printer = { name: string; host: string; port: number }`, `parsePrinters(value: string | undefined): Printer[]`, `sendRaw(printer: Printer, data: Buffer, timeoutMs?: number): Promise<number>`(보낸 바이트 수).
- 스토어(`src/editor/store.ts`) 추가: `setOutput(output: Report["output"]): void`, `applyPreset(preset: Preset): void`(page+output 한 커밋), `bitmapPreview: boolean`, `setBitmapPreview(v: boolean): void`(히스토리 밖).
- 컴포넌트: `src/editor/panels/OutputPanel.tsx`(출력 절, PagePanel이 렌더), `src/editor/panels/PagePanel.tsx`(프리셋 드롭다운·저장·삭제), `src/editor/panels/ElementPalette.tsx`(바코드), `src/editor/panels/PropertyPanel.tsx`(바코드 속성), `src/editor/Toolbar.tsx`(라벨 다운로드·프린터 전송·비트맵 토글), `src/editor/Preview.tsx`(비트맵 PNG), `src/editor/canvas/Canvas.tsx`(라벨 표식).
- E2E: `apps/studio/e2e/phase3.spec.ts`.

---

## 태스크 목록과 실행 웨이브

| 웨이브 | 레인 | 태스크 | 의존 |
|---|---|---|---|
| 1 | core | T1 output·바코드 형식·프리셋 스키마 | - |
| 1 | renderer | T2 바코드 SVG 렌더링(svg 항목, Paint) | T1 (format enum) — 같은 날 순차 실행 |
| 1 | browser | T3 browser 패키지 분리(pdf 회귀) | - |
| 1 | label-enc | T4 label 비트맵·인코더(순수) | - |
| 2 | fixtures | T5 라벨 예제 2종 + renderer 골든 | T1 T2 |
| 2 | presets | T6 프리셋 저장소·API | T1 |
| 2 | panels | T7 출력 패널·프리셋 UI·스토어 액션 · T8 바코드 팔레트·속성 | T1 T2 T6 |
| 3 | label | T9 label 래스터·renderLabel(PDF 대비 픽셀 비교) | T3 T4 T5 |
| 3 | routes | T10 프린터·라벨·전송 라우트 | T9 |
| 4 | integration | T11 툴바·미리보기·캔버스 통합 · T12 시드·E2E | T7 T8 T10 |

T1과 T2는 `BarcodeElementSchema`의 enum을 공유하므로 T1 다음 T2. T3·T4는 서로 무관하다. 웨이브 병합 절차는 2단계 플랜과 같다(레인 병합 후 루트 `pnpm install && pnpm typecheck && pnpm test`).

---
## 웨이브 1

### Task 1: core output·바코드 형식·프리셋 스키마

**Files:**
- Create: `packages/core/src/schema/output.ts`, `packages/core/src/schema/preset.ts`
- Modify: `packages/core/src/schema/elements.ts` (BarcodeElementSchema), `packages/core/src/schema/report.ts` (`output` 필드), `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/output-schema.test.ts`

**Interfaces:**
- Consumes: 1·2단계 `PageSchema`, `Base`.
- Produces: `LabelOutputSchema`, `OutputSchema`, `Output`, `LabelOutput`, `DEFAULT_OUTPUT`, `PresetSchema`, `Preset`, `PresetInput`, `BarcodeElement`, `BarcodeFormat`, `Report.output`(항상 존재).

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/output-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, safeParseReport } from "../schema/report";
import { OutputSchema, DEFAULT_OUTPUT } from "../schema/output";
import { PresetSchema } from "../schema/preset";
import { ElementSchema } from "../schema/elements";

const base = { id: "r", version: 1, page: { width: 60, height: 40 } };

describe("output schema", () => {
  it("defaults to pdf and fills label defaults", () => {
    expect(parseReport(base).output).toEqual({ kind: "pdf" });
    expect(DEFAULT_OUTPUT).toEqual({ kind: "pdf" });
    const r = parseReport({ ...base, output: { kind: "label", label: { language: "zpl", dpi: 203 } } });
    expect(r.output).toEqual({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } });
  });
  it("rejects label without the label block, bad dpi, threshold and speed ranges", () => {
    expect(safeParseReport({ ...base, output: { kind: "label" } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 600 } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 300, threshold: 256 } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 300, speed: 0 } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 300, darkness: 30, speed: 14, copies: 2 } }).success).toBe(true);
  });
});

describe("barcode format", () => {
  it("accepts the five formats and rejects others", () => {
    for (const format of ["code128", "ean13", "qr", "code39", "datamatrix"]) {
      expect(ElementSchema.safeParse({ id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format, value: "x" }).success).toBe(true);
    }
    expect(ElementSchema.safeParse({ id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "pdf417", value: "x" }).success).toBe(false);
  });
});

describe("preset schema", () => {
  it("parses with output default and builtin false, enforces the id rule", () => {
    const p = PresetSchema.parse({ id: "coil-tag", name: "코일 Tag", page: { width: 100, height: 150 } });
    expect(p).toEqual({ id: "coil-tag", name: "코일 Tag", page: { width: 100, height: 150, margin: [10, 10, 10, 10], unit: "mm" }, output: { kind: "pdf" }, builtin: false });
    expect(PresetSchema.safeParse({ id: "Bad Id", name: "x", page: { width: 1, height: 1 } }).success).toBe(false);
    expect(PresetSchema.safeParse({ id: "x", name: "", page: { width: 1, height: 1 } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- output-schema`
Expected: FAIL — 모듈 없음, `output` 키가 버려짐.

- [ ] **Step 3: 구현**

`packages/core/src/schema/output.ts`:
```ts
import { z } from "zod";

/** 라벨 프린터 출력 설정 (스펙 4.1). darkness·speed·copies는 프린터 명령으로만 나가고 레이아웃에 영향이 없다 */
export const LabelOutputSchema = z.object({
  language: z.enum(["zpl", "tspl"]),
  dpi: z.union([z.literal(203), z.literal(300)]),
  threshold: z.number().int().min(0).max(255).default(128),   // 회색조가 이 값 미만이면 검정
  darkness: z.number().int().min(0).max(30).optional(),        // ~SD / DENSITY
  speed: z.number().int().min(1).max(14).optional(),           // ^PR / SPEED
  copies: z.number().int().positive().default(1),              // 라벨 한 장당 인쇄 매수 (^PQ / PRINT 1,n)
});
export const OutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pdf") }),
  z.object({ kind: z.literal("label"), label: LabelOutputSchema }),
]);
export type LabelOutput = z.infer<typeof LabelOutputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export const DEFAULT_OUTPUT: Output = { kind: "pdf" };
```

`packages/core/src/schema/preset.ts`:
```ts
import { z } from "zod";
import { PageSchema } from "./report";
import { OutputSchema } from "./output";

/** 페이지 크기 + 출력 설정 묶음 (스펙 4.3). 내장 프리셋은 코드 상수, 사용자 정의는 스튜디오 저장소 */
export const PresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다"),
  name: z.string().min(1),
  page: PageSchema,
  output: OutputSchema.default({ kind: "pdf" }),
  builtin: z.boolean().default(false),
});
export type Preset = z.infer<typeof PresetSchema>;
export type PresetInput = z.input<typeof PresetSchema>;
```

`packages/core/src/schema/elements.ts`: `BarcodeElementSchema`의 `format`을 `z.enum(["code128", "ean13", "qr", "code39", "datamatrix"])`로 바꾸고 파일 끝에 추가:
```ts
export type BarcodeElement = z.infer<typeof BarcodeElementSchema>;
export type BarcodeFormat = BarcodeElement["format"];
```

`packages/core/src/schema/report.ts`: import에 `import { OutputSchema } from "./output";`를 더하고 `ReportSchema`의 `sample: SampleSchema.optional(),` 다음에 `output: OutputSchema.default({ kind: "pdf" }),`를 넣는다. (`preset.ts`가 `report.ts`의 `PageSchema`를 import하고 `report.ts`는 `output.ts`만 import하므로 순환은 없다.)

`packages/core/src/index.ts`에 `export * from "./schema/output";`(`./schema/report` 앞)와 `export * from "./schema/preset";`(뒤)를 추가.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm typecheck`
Expected: PASS. renderer 골든 스냅샷은 `layout` 결과라 `output`이 들어가지 않아 변하지 않는다. studio의 `Report` 객체 리터럴을 만드는 테스트(`Toolbar.test.tsx` 등은 `parseReport`를 쓴다)는 통과해야 한다 — `report-store.test.ts`처럼 리터럴에 `output`이 없어 typecheck가 깨지면 그 테스트에 `output: { kind: "pdf" }`를 더한다.

- [ ] **Step 5: Commit**

```bash
git add packages/core apps/studio
git commit -m "feat(core): 출력 설정(output)·바코드 형식 확장·페이지 프리셋 스키마"
```

---

### Task 2: renderer 바코드 SVG 렌더링

**Files:**
- Create: `packages/renderer/src/barcode/render.ts`
- Modify: `packages/renderer/package.json` (`bwip-js` 의존), `packages/renderer/src/layout/types.ts`, `packages/renderer/src/layout/place.ts`, `packages/renderer/src/paint/Paint.tsx`, `packages/renderer/src/paint/css.ts`, `packages/renderer/src/index.ts`, `packages/renderer/src/__tests__/layout.test.ts`(placeholder 테스트 1개)
- Test: `packages/renderer/src/__tests__/barcode.test.ts`, `packages/renderer/src/__tests__/paint.test.tsx`(1개 추가)

**Interfaces:**
- Consumes: T1 `BarcodeFormat`; 1단계 `interpolate`, `ExpressionError`.
- Produces: `renderBarcode`, `BarcodeError`, `BARCODE_2D`, `PlacedSvg`, Paint `svg` 분기.

- [ ] **Step 1: 의존성**

`packages/renderer/package.json` `dependencies`에 `"bwip-js": "^4.11.0"` 추가 후 루트에서 `pnpm install`. bwip-js는 `exports`가 node/browser 조건을 갖고 있어 Next 클라이언트 번들(캔버스)과 Node(PDF·라벨) 양쪽에서 `import bwipjs from "bwip-js"`가 동작한다. `toSVG`는 캔버스·DOM 없이 SVG 문자열을 돌려준다.

- [ ] **Step 2: 실패 테스트 작성**

`packages/renderer/src/__tests__/barcode.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { renderBarcode, BarcodeError, BARCODE_2D } from "../barcode/render";
import { flatten } from "../layout/flatten";
import { placeStatic } from "../layout/place";
import { layout } from "../layout/layout";

const opts = { showText: true, fontSize: 8 };

describe("renderBarcode", () => {
  it.each(["code128", "ean13", "qr", "code39", "datamatrix"] as const)("renders %s as an svg that fills its box", (format) => {
    const value = format === "ean13" ? "4006381333931" : "LOT-2026-0917";
    const svg = renderBarcode(format, value, opts);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="100%"');
    expect(svg).toContain('height="100%"');
    expect(svg).toContain(BARCODE_2D.has(format) ? 'preserveAspectRatio="xMidYMid meet"' : 'preserveAspectRatio="none"');
    expect(svg).not.toContain("<script");
    expect(svg).toMatchSnapshot();
  });
  it("omits the human-readable text when showText is false", () => {
    const withText = renderBarcode("code128", "ABC", opts);
    const without = renderBarcode("code128", "ABC", { showText: false, fontSize: 8 });
    expect(withText.length).toBeGreaterThan(without.length);
  });
  it("throws BarcodeError for an empty value, a wrong EAN-13 check digit and characters code39 cannot encode", () => {
    expect(() => renderBarcode("code128", "", opts)).toThrow(BarcodeError);
    expect(() => renderBarcode("ean13", "4006381333930", opts)).toThrow(BarcodeError);
    expect(() => renderBarcode("code39", "abc", opts)).toThrow(BarcodeError);
    try { renderBarcode("ean13", "12", opts); } catch (e) { expect(e).toMatchObject({ name: "BarcodeError", format: "ean13", value: "12" }); }
  });
});

describe("barcode in layout", () => {
  const page = { width: 100, height: 60 };
  it("places a barcode as an svg item with the interpolated value", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [{ id: "b", type: "barcode", x: 5, y: 5, w: 40, h: 15, format: "code128", value: "{{ lot.NO }}" }] });
    const [item] = placeStatic(flatten(r.elements)[0], { params: {}, lot: { NO: "L-1" } }, { onExpressionError: "blank" });
    expect(item).toMatchObject({ kind: "svg", elementId: "b", x: 5, y: 5, w: 40, h: 15 });
    expect((item as { svg: string }).svg).toContain("<svg");
  });
  it("isolates an invalid value as #ERR in blank mode and throws in fail mode", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 5, y: 5, w: 40, h: 15, format: "ean13", value: "{{ lot.NO }}" },
      { id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, value: "ok" },
    ]});
    const items = layout(r, { params: {}, lot: { NO: "12" } })[0].items;
    expect(items[0]).toMatchObject({ kind: "text", elementId: "b", lines: ["#ERR"], error: expect.stringContaining("ean13") });
    expect(items[1]).toMatchObject({ elementId: "t" });
    expect(() => layout({ ...r, onExpressionError: "fail" }, { params: {}, lot: { NO: "12" } })).toThrow(BarcodeError);
  });
});
```

`packages/renderer/src/__tests__/paint.test.tsx`에 추가:
```tsx
  it("inlines a barcode svg inside its box", () => {
    const r = parseReport({ id: "bc", version: 1, page: { width: 60, height: 40 }, elements: [{ id: "b", type: "barcode", x: 5, y: 5, w: 40, h: 15, format: "qr", value: "hello" }] });
    const html = renderToStaticMarkup(<PaintPages pages={layout(r, { params: {} })} />);
    expect(html).toMatch(/<div[^>]*data-element-id="b"[^>]*class="dp-el dp-svg"[^>]*><svg/);
    expect(html).toContain("left:5mm;top:5mm;width:40mm;height:15mm");
  });
```

`packages/renderer/src/__tests__/layout.test.ts`의 "keeps barcode/ref as placeholders and draws a table as a flowBox"를 바꾼다:
```ts
  it("draws a barcode as svg, a table as a flowBox and keeps ref as a placeholder", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
      { id: "c", type: "ref", x: 0, y: 0, w: 10, h: 5, ref: "hdr" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items.map((i) => i.kind)).toEqual(["svg", "rect", "placeholder"]);
    expect(items[1]).toMatchObject({ role: "flowBox", elementId: "t" });
  });
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/renderer test -- barcode paint layout`
Expected: FAIL — 모듈 없음, barcode가 placeholder.

- [ ] **Step 4: 구현**

`packages/renderer/src/barcode/render.ts`:
```ts
import bwipjs from "bwip-js";
import type { BarcodeFormat } from "@daport/core";

/** 값이 비었거나 형식에 맞지 않는다. 레이아웃은 ExpressionError처럼 요소 단위로 격리한다 */
export class BarcodeError extends Error {
  constructor(public format: string, public value: string, cause: unknown) {
    super(`Barcode error (${format}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "BarcodeError";
  }
}

export type BarcodeOptions = { showText: boolean; fontSize: number };

/** bwip-js 심볼 이름 */
const BCID: Record<BarcodeFormat, string> = { code128: "code128", ean13: "ean13", qr: "qrcode", code39: "code39", datamatrix: "datamatrix" };
export const BARCODE_2D: ReadonlySet<string> = new Set(["qr", "datamatrix"]);
const ROOT_SIZE_RE = /^<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/;

/**
 * 바코드 SVG. 크기 속성을 떼고 상자에 맞춰 늘린다: 1D는 가로로 늘리고(preserveAspectRatio none), 2D는 정사각형으로 상자 안에 맞춘다.
 * bwip-js는 텍스트를 글리프 경로로 그리므로 값이 마크업으로 새지 않는다
 */
export function renderBarcode(format: BarcodeFormat, value: string, opts: BarcodeOptions): string {
  if (value === "") throw new BarcodeError(format, value, "empty value");
  const is2d = BARCODE_2D.has(format);
  let svg: string;
  try {
    svg = bwipjs.toSVG({
      bcid: BCID[format], text: value, scale: 2,
      height: is2d ? undefined : 10,                        // 1D 모듈 높이(mm 단위 bwip 기본). 상자에 맞춰 늘리므로 비율만 의미 있다
      includetext: !is2d && opts.showText, textxalign: "center", textsize: opts.fontSize,
    });
  } catch (e) {
    throw new BarcodeError(format, value, e);
  }
  const ratio = is2d ? 'preserveAspectRatio="xMidYMid meet"' : 'preserveAspectRatio="none"';
  const out = svg.replace(ROOT_SIZE_RE, (_m, attrs: string) => `<svg${attrs} width="100%" height="100%" ${ratio}`);
  if (out === svg) throw new BarcodeError(format, value, "unexpected svg root");   // bwip-js 출력의 루트 속성 순서가 바뀌면 정규식을 맞춘다
  return out;
}
```

`packages/renderer/src/layout/types.ts`: `PlacedPlaceholder` 아래에 `export type PlacedSvg = PlacedBase & { kind: "svg"; svg: string };`를 넣고 `PlacedItem` union에 `| PlacedSvg`를 더한다.

`packages/renderer/src/layout/place.ts`: import에 `import { renderBarcode, BarcodeError } from "../barcode/render";`를 더하고 `case "barcode"`를 바꾼다:
```ts
      case "barcode": return [{ ...base, kind: "svg", svg: renderBarcode(el.format, interpolate(el.value, ctx), { showText: el.showText, fontSize: el.style.fontSize }) }];
```
catch 조건을 `if (!(e instanceof ExpressionError || e instanceof BarcodeError) || opts.onExpressionError === "fail") throw e;`로 바꾼다.

`packages/renderer/src/paint/Paint.tsx`의 `switch`에 추가:
```tsx
    case "svg":
      // bwip-js가 만든 SVG만 들어온다(값은 글리프 경로로 그려져 마크업이 아니다)
      return <div {...common} className={cls + " dp-svg"} style={{ ...box(item), ...dimStyle }} dangerouslySetInnerHTML={{ __html: item.svg }} />;
```
`packages/renderer/src/paint/css.ts`의 `pageCss`에 `` `.dp-svg svg{width:100%;height:100%;display:block}` ``를 `.dp-ph` 줄 앞에 추가. `packages/renderer/src/index.ts`에 `export * from "./barcode/render";`.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/renderer test && pnpm typecheck`
Expected: PASS (스냅샷 5개 생성). 골든 `quality-cert`에는 barcode가 없어 변하지 않는다. studio의 `Canvas.tsx`가 `PlacedItem`의 `kind`로 분기하는 곳(`itemBox`, `pickElementId`의 `rect` 검사)은 `svg`를 일반 상자로 다루므로 수정이 없다 — `pnpm --filter studio typecheck`로 확인.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer pnpm-lock.yaml
git commit -m "feat(renderer): bwip-js 바코드 SVG 렌더링 — svg 항목, 오류 격리"
```

---

### Task 3: browser 패키지 분리 (pdf 회귀)

**Files:**
- Create: `packages/browser/package.json`, `packages/browser/tsconfig.json`, `packages/browser/src/index.ts`, `packages/browser/src/pool.ts`, `packages/browser/src/fonts.ts`, `packages/browser/src/crash.ts`, `packages/browser/src/page.ts`, `packages/browser/src/__tests__/pool.test.ts`, `packages/browser/src/__tests__/crash.test.ts`
- Create: `packages/pdf/src/fonts-dir.ts`
- Modify: `packages/pdf/package.json`, `packages/pdf/src/index.ts`, `packages/pdf/src/__tests__/retry.test.ts`
- Delete: `packages/pdf/src/pool.ts`, `packages/pdf/src/fonts.ts`, `packages/pdf/src/crash.ts`, `packages/pdf/src/__tests__/pool.test.ts`

**Interfaces:**
- Consumes: 1단계 pdf의 pool/fonts/crash.
- Produces: `@daport/browser`의 `getBrowser`, `closePool`, `fontBaseUrl`, `serveFonts(ctx, fontsDir)`, `isBrowserCrash`, `withPage(html, opts, fn)`; pdf 공개 API 불변.

- [ ] **Step 1: 패키지 골격**

`packages/browser/package.json`:
```json
{
  "name": "@daport/browser",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "build": "tsc -p tsconfig.json --noEmit", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" },
  "dependencies": { "playwright": "^1.55.0" }
}
```
`packages/browser/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.
`packages/pdf/package.json` `dependencies`에 `"@daport/browser": "workspace:*"` 추가. 루트 `pnpm install`.

- [ ] **Step 2: 파일 이동과 테스트**

`git mv packages/pdf/src/pool.ts packages/browser/src/pool.ts`, `git mv packages/pdf/src/crash.ts packages/browser/src/crash.ts`, `git mv packages/pdf/src/__tests__/pool.test.ts packages/browser/src/__tests__/pool.test.ts` (내용 그대로). `packages/pdf/src/__tests__/retry.test.ts`의 `isBrowserCrash` describe 블록을 잘라 `packages/browser/src/__tests__/crash.test.ts`로 옮긴다(import는 `../crash`).

`packages/browser/src/fonts.ts` (pdf의 fonts.ts에서 디렉터리 해석만 뺀다):
```ts
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BrowserContext } from "playwright";

/** setContent 문서(about:blank)는 file:// 폰트를 CORS로 거부하므로 가상 오리진에서 라우트로 서빙한다 */
export const fontBaseUrl = "http://fonts.daport.local";
const fontCache = new Map<string, Promise<Buffer>>();

function readFont(fontsDir: string, name: string): Promise<Buffer> {
  const key = join(fontsDir, name);
  let p = fontCache.get(key);
  if (!p) {
    p = readFile(key);
    p.catch(() => fontCache.delete(key));     // 실패한 읽기는 캐시하지 않는다
    fontCache.set(key, p);
  }
  return p;
}

/** fontsDir는 호출자(pdf·label)가 renderer 패키지에서 해석해 넘긴다. browser는 renderer를 모른다 */
export async function serveFonts(ctx: BrowserContext, fontsDir: string): Promise<void> {
  await ctx.route(`${fontBaseUrl}/**`, async (route) => {
    const name = basename(new URL(route.request().url()).pathname);
    try {
      const body = await readFont(fontsDir, name);
      await route.fulfill({ status: 200, body, headers: { "content-type": "font/otf", "access-control-allow-origin": "*" } });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}
```

`packages/browser/src/page.ts`:
```ts
import type { Page } from "playwright";
import { getBrowser } from "./pool";
import { serveFonts } from "./fonts";

export type PageOptions = { fontsDir: string; deviceScaleFactor?: number; setContentTimeoutMs?: number };

/** 새 컨텍스트에 HTML을 올리고 폰트 로드까지 기다린 뒤 fn을 실행한다. 라우트 maxDuration 안에 재시도까지 들어가도록 로드 시간을 묶는다 */
export async function withPage<T>(html: string, opts: PageOptions, fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext(opts.deviceScaleFactor ? { deviceScaleFactor: opts.deviceScaleFactor } : {});
  try {
    await serveFonts(ctx, opts.fontsDir);
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: opts.setContentTimeoutMs ?? 20_000 });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await ctx.close();
  }
}
```

`packages/browser/src/index.ts`:
```ts
export { getBrowser, closePool } from "./pool";
export { fontBaseUrl, serveFonts } from "./fonts";
export { isBrowserCrash } from "./crash";
export { withPage, type PageOptions } from "./page";
```

`packages/pdf/src/fonts-dir.ts`:
```ts
import { createRequire } from "node:module";
import { dirname } from "node:path";
// turbopackIgnore: Next 서버 번들이 .otf를 모듈로 끌어들이지 않고 런타임에 Node가 경로만 해석하게 한다
export const fontsDir = dirname(createRequire(import.meta.url).resolve(/* turbopackIgnore: true */ "@daport/renderer/fonts/Pretendard-Regular.otf"));
```

`packages/pdf/src/index.ts` 전체:
```ts
import { renderToHtml, type Report, type DataContext } from "@daport/renderer";
import { withPage, fontBaseUrl, isBrowserCrash } from "@daport/browser";
import { fontsDir } from "./fonts-dir";
export { closePool } from "@daport/browser";

export async function renderPdf(report: Report, data: DataContext, attempt = 0): Promise<Buffer> {
  const html = renderToHtml(report, data, { fontBaseUrl });
  try {
    return await withPage(html, { fontsDir }, (page) => page.pdf({
      width: `${report.page.width}mm`, height: `${report.page.height}mm`,
      printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
  } catch (e) {
    if (attempt === 0 && isBrowserCrash(e)) return renderPdf(report, data, 1);     // Chromium 크래시·끊김만 1회 재시도
    throw e;
  }
}

/** 테스트·미리보기 비교용: pageIndex번째(0부터) 페이지를 96dpi PNG로 */
export async function renderHtmlScreenshot(report: Report, data: DataContext, opts: { pageIndex?: number } = {}): Promise<Buffer> {
  const html = renderToHtml(report, data, { fontBaseUrl });
  return withPage(html, { fontsDir }, async (page) => {
    await page.setViewportSize({ width: Math.round(report.page.width / 25.4 * 96), height: Math.round(report.page.height / 25.4 * 96) });
    return page.locator(".dp-page").nth(opts.pageIndex ?? 0).screenshot({ type: "png" });
  });
}
```

`packages/pdf/src/__tests__/retry.test.ts` 전체를 바꾼다 — `withPage`는 browser 패키지 안에서 자기 `getBrowser`를 부르므로 `getBrowser` 모킹이 닿지 않는다. 대신 `withPage`를 모킹해 재시도 정책만 검증한다:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseReport } from "@daport/core";

const withPage = vi.fn();
vi.mock("@daport/browser", async (importOriginal) => ({ ...(await importOriginal<typeof import("@daport/browser")>()), withPage, closePool: vi.fn() }));
const { renderPdf } = await import("../index");

const report = parseReport({ id: "r", version: 1, page: { width: 60, height: 40 } });
beforeEach(() => withPage.mockReset());

describe("renderPdf retry", () => {
  it("retries once after a browser crash and returns the second result", async () => {
    withPage.mockRejectedValueOnce(new Error("page.pdf: Target page, context or browser has been closed")).mockResolvedValueOnce(Buffer.from("%PDF-"));
    expect((await renderPdf(report, { params: {} })).toString()).toBe("%PDF-");
    expect(withPage).toHaveBeenCalledTimes(2);
  });
  it("does not retry a second crash or a non-crash error", async () => {
    withPage.mockRejectedValue(new Error("Target crashed"));
    await expect(renderPdf(report, { params: {} })).rejects.toThrow("Target crashed");
    expect(withPage).toHaveBeenCalledTimes(2);
    withPage.mockReset().mockRejectedValue(new Error("page.setContent: Timeout 20000ms exceeded."));
    await expect(renderPdf(report, { params: {} })).rejects.toThrow("Timeout");
    expect(withPage).toHaveBeenCalledTimes(1);
  });
});
```
기존 retry.test.ts에 있던 `renderPdf` 재시도 케이스와 같은 의도다(크래시 1회 재시도, 다른 오류는 재시도 없음).

- [ ] **Step 3: 통과 확인**

Run: `pnpm --filter @daport/browser test && pnpm --filter @daport/pdf test && pnpm typecheck`
Expected: browser 테스트(pool·crash) PASS, pdf 26개 PASS(픽셀 비교 포함 — 회귀 검증), typecheck PASS. studio는 `@daport/pdf`만 import하므로 변화 없음.

- [ ] **Step 4: Commit**

```bash
git add packages/browser packages/pdf pnpm-lock.yaml
git commit -m "refactor(browser,pdf): Playwright 풀·폰트 서빙·크래시 판정을 browser 패키지로 분리"
```

---

### Task 4: label 비트맵·인코더 (순수)

**Files:**
- Create: `packages/label/package.json`, `packages/label/tsconfig.json`, `packages/label/src/bitmap.ts`, `packages/label/src/encode.ts`, `packages/label/src/index.ts`(이 태스크에서는 bitmap·encode 재export만)
- Test: `packages/label/src/__tests__/bitmap.test.ts`, `packages/label/src/__tests__/encode.test.ts`

**Interfaces:**
- Produces: `Bitmap`, `rowBytes`, `packGray`, `rgbaToGray`, `bitmapToPng`, `pxOf`, `LabelOptions`, `encodeZpl`, `encodeTspl`.

- [ ] **Step 1: 패키지 골격**

`packages/label/package.json`:
```json
{
  "name": "@daport/label",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "build": "tsc -p tsconfig.json --noEmit", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" },
  "dependencies": {
    "@daport/renderer": "workspace:*",
    "@daport/browser": "workspace:*",
    "pngjs": "^7.0.0"
  },
  "devDependencies": {
    "@daport/core": "workspace:*",
    "@daport/pdf": "workspace:*",
    "@types/pngjs": "^6.0.5",
    "pdf-to-img": "^4.4.0",
    "pixelmatch": "^7.1.0"
  }
}
```
`packages/label/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`. 루트 `pnpm install`.

- [ ] **Step 2: 실패 테스트 작성**

`packages/label/src/__tests__/bitmap.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { rowBytes, packGray, rgbaToGray, bitmapToPng, pxOf } from "../bitmap";

describe("bitmap", () => {
  it("pxOf rounds mm at the given dpi", () => {
    expect(pxOf(100, 203)).toBe(799);
    expect(pxOf(60, 203)).toBe(480);
    expect(pxOf(40, 300)).toBe(472);
  });
  it("rowBytes pads to whole bytes", () => {
    expect([rowBytes(1), rowBytes(8), rowBytes(9), rowBytes(16)]).toEqual([1, 1, 2, 2]);
  });
  it("packGray sets 1 for pixels darker than the threshold, MSB first, padding with 0", () => {
    // 9×2: 첫 행은 검정 8개 + 흰 1개, 둘째 행은 흰 8개 + 검정 1개
    const gray = new Uint8Array([...Array(8).fill(0), 255, ...Array(8).fill(255), 0]);
    const bm = packGray(gray, 9, 2, 128);
    expect(bm).toEqual({ width: 9, height: 2, bits: new Uint8Array([0xff, 0x00, 0x00, 0x80]) });
    expect(packGray(new Uint8Array([127, 128]), 2, 1, 128).bits).toEqual(new Uint8Array([0x80]));
  });
  it("rgbaToGray uses luma and composites alpha over white", () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
    expect(Array.from(rgbaToGray(rgba, 4, 1))).toEqual([0, 255, 76, 255]);
  });
  it("bitmapToPng round-trips black and white", () => {
    const png = PNG.sync.read(bitmapToPng({ width: 9, height: 2, bits: new Uint8Array([0xff, 0x00, 0x00, 0x80]) }));
    expect([png.width, png.height]).toEqual([9, 2]);
    expect([png.data[0], png.data[(8) * 4], png.data[(9 + 8) * 4]]).toEqual([0, 255, 0]);
  });
});
```

`packages/label/src/__tests__/encode.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encodeZpl, encodeTspl } from "../encode";
import type { Bitmap } from "../bitmap";

const bm: Bitmap = { width: 9, height: 2, bits: new Uint8Array([0xff, 0x00, 0x00, 0x80]) };
const opts = { widthMm: 1.13, heightMm: 0.25, dpi: 203, copies: 1 };

describe("encodeZpl", () => {
  it("wraps each bitmap in one ^XA block with ^GFA hex, 1 = black", () => {
    expect(encodeZpl([bm], opts)).toBe("^XA\n^PW9\n^LL2\n^FO0,0^GFA,4,4,2,FF000080^FS\n^PQ1\n^XZ\n");
  });
  it("adds darkness, speed and copies, one block per label", () => {
    const out = encodeZpl([bm, bm], { ...opts, copies: 3, darkness: 15, speed: 4 });
    expect(out.match(/\^XA/g)).toHaveLength(2);
    expect(out).toContain("~SD15\n^PR4\n");
    expect(out).toContain("^PQ3\n");
  });
});

describe("encodeTspl", () => {
  it("emits SIZE/GAP/CLS/BITMAP/PRINT with inverted bytes (0 = black) and CRLF", () => {
    const out = encodeTspl([bm], opts);
    const text = out.toString("latin1");
    expect(text.startsWith("SIZE 1.13 mm,0.25 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBITMAP 0,0,2,2,0,")).toBe(true);
    const start = text.indexOf("BITMAP 0,0,2,2,0,") + "BITMAP 0,0,2,2,0,".length;
    expect(Array.from(out.subarray(start, start + 4))).toEqual([0x00, 0xff, 0xff, 0x7f]);
    expect(text.endsWith("\r\nPRINT 1,1\r\n")).toBe(true);
  });
  it("adds DENSITY and SPEED and one label block per bitmap", () => {
    const text = encodeTspl([bm, bm], { ...opts, copies: 2, darkness: 8, speed: 3 }).toString("latin1");
    expect(text.match(/SIZE /g)).toHaveLength(2);
    expect(text).toContain("DENSITY 8\r\nSPEED 3\r\n");
    expect(text).toContain("PRINT 1,2\r\n");
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/label test`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 구현**

`packages/label/src/bitmap.ts`:
```ts
import { PNG } from "pngjs";

/** 1비트 비트맵. 행마다 ceil(width/8)바이트, MSB가 왼쪽 픽셀, 1 = 검정, 남는 비트는 0 */
export type Bitmap = { width: number; height: number; bits: Uint8Array };

export const pxOf = (mm: number, dpi: number): number => Math.round((mm * dpi) / 25.4);
export const rowBytes = (width: number): number => Math.ceil(width / 8);

/** 회색조(0..255, 행 우선) → 임계값 미만이면 검정 */
export function packGray(gray: Uint8Array, width: number, height: number, threshold: number): Bitmap {
  const rb = rowBytes(width);
  const bits = new Uint8Array(rb * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) bits[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bits };
}

/** RGBA → 회색조. 투명은 흰 배경 위에 합성한다 */
export function rgbaToGray(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    out[i] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

/** 검정 0, 흰 255의 회색 PNG (미리보기·테스트용) */
export function bitmapToPng(bitmap: Bitmap): Buffer {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  const rb = rowBytes(bitmap.width);
  for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
    const black = (bitmap.bits[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1;
    const v = black ? 0 : 255, i = (y * bitmap.width + x) * 4;
    png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
```

`packages/label/src/encode.ts`:
```ts
import { rowBytes, type Bitmap } from "./bitmap";

export type LabelOptions = { widthMm: number; heightMm: number; dpi: number; copies: number; darkness?: number; speed?: number };

/** ZPL: 라벨(비트맵)마다 ^XA…^XZ 한 블록. ^GFA는 1 = 검정, 16진 대문자 (스펙 6.2) */
export function encodeZpl(bitmaps: Bitmap[], opts: LabelOptions): string {
  return bitmaps.map((bm) => {
    const rb = rowBytes(bm.width), total = rb * bm.height;
    const hex = Buffer.from(bm.bits).toString("hex").toUpperCase();
    return [
      "^XA", `^PW${bm.width}`, `^LL${bm.height}`,
      ...(opts.darkness !== undefined ? [`~SD${opts.darkness}`] : []),
      ...(opts.speed !== undefined ? [`^PR${opts.speed}`] : []),
      `^FO0,0^GFA,${total},${total},${rb},${hex}^FS`,
      `^PQ${opts.copies}`, "^XZ", "",
    ].join("\n");
  }).join("");
}

/** TSPL: SIZE…PRINT 한 블록. BITMAP 모드 0은 0 = 검정이라 비트를 반전한다. 바이너리가 섞이므로 Buffer */
export function encodeTspl(bitmaps: Bitmap[], opts: LabelOptions): Buffer {
  const parts: Buffer[] = [];
  for (const bm of bitmaps) {
    const rb = rowBytes(bm.width);
    const head = [
      `SIZE ${opts.widthMm} mm,${opts.heightMm} mm`, "GAP 3 mm,0 mm",
      ...(opts.darkness !== undefined ? [`DENSITY ${opts.darkness}`] : []),
      ...(opts.speed !== undefined ? [`SPEED ${opts.speed}`] : []),
      "CLS", `BITMAP 0,0,${rb},${bm.height},0,`,
    ].join("\r\n");
    const inverted = Buffer.from(bm.bits.map((b) => ~b & 0xff));
    parts.push(Buffer.from(head, "latin1"), inverted, Buffer.from(`\r\nPRINT 1,${opts.copies}\r\n`, "latin1"));
  }
  return Buffer.concat(parts);
}
```

`packages/label/src/index.ts` (이 태스크 시점):
```ts
export * from "./bitmap";
export * from "./encode";
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/label test && pnpm --filter @daport/label typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/label pnpm-lock.yaml
git commit -m "feat(label): 1비트 비트맵 패킹과 ZPL·TSPL 인코더"
```

---
## 웨이브 2

### Task 5: 라벨 예제 2종 fixtures와 renderer 골든

**Files:**
- Create: `packages/renderer/src/__tests__/fixtures/coil-tag.report.json`, `packages/renderer/src/__tests__/fixtures/product-label.report.json`
- Test: `packages/renderer/src/__tests__/golden-phase3.test.ts`

**Interfaces:**
- Consumes: T1 `output`, T2 svg 항목, 2단계 `fixtureContext`(`fixtures/context.ts`), `repeat`.
- Produces: 예제 JSON 2종(라벨 패키지 테스트·studio 시드·E2E가 쓴다).

- [ ] **Step 1: fixture 작성**

`packages/renderer/src/__tests__/fixtures/coil-tag.report.json` (코일 Tag 100×150, 코일마다 한 장):
```json
{
  "id": "coil-tag", "name": "코일 Tag", "version": 1,
  "page": { "width": 100, "height": 150, "margin": [3, 3, 3, 3] },
  "output": { "kind": "label", "label": { "language": "zpl", "dpi": 203, "threshold": 128 } },
  "datasets": [{ "name": "coils", "type": "static", "rows": [] }],
  "repeat": { "source": "coils", "as": "record" },
  "sample": { "params": {}, "capturedAt": "2026-09-17T00:00:00.000Z", "data": { "coils": [
    { "COIL_NO": "C2609170001", "PRODUCT": "SPCC", "THICK": 1.0, "WIDTH": 1219, "WEIGHT": 12480, "CUSTOMER": "대한정밀(주)", "GRADE": "1급", "DT": "2026-09-17" },
    { "COIL_NO": "C2609170002", "PRODUCT": "SPCC", "THICK": 1.2, "WIDTH": 1219, "WEIGHT": 13020, "CUSTOMER": "세명산업", "GRADE": "1급", "DT": "2026-09-17" },
    { "COIL_NO": "C2609170003", "PRODUCT": "SPHC", "THICK": 2.3, "WIDTH": 1000, "WEIGHT": 9850, "CUSTOMER": "한빛금속", "GRADE": "2급", "DT": "2026-09-17" }
  ]}},
  "elements": [
    { "id": "frame", "type": "rect", "x": 3, "y": 3, "w": 94, "h": 144, "style": { "stroke": "#000", "strokeWidth": 0.5 } },
    { "id": "title", "type": "text", "x": 5, "y": 5, "w": 90, "h": 10, "value": "COIL TAG", "style": { "fontSize": 18, "bold": true, "align": "center", "valign": "middle" } },
    { "id": "coil-no", "type": "text", "x": 5, "y": 16, "w": 90, "h": 12, "value": "{{ record.COIL_NO }}", "style": { "fontSize": 24, "bold": true, "align": "center", "valign": "middle" } },
    { "id": "bc", "type": "barcode", "x": 8, "y": 30, "w": 84, "h": 22, "format": "code128", "value": "{{ record.COIL_NO }}", "showText": false },
    { "id": "spec", "type": "group", "x": 5, "y": 56, "w": 90, "h": 60, "children": [
      { "id": "l1", "type": "text", "x": 0, "y": 0, "w": 28, "h": 10, "value": "품종", "style": { "fontSize": 10, "bold": true, "fill": "#eee", "padding": 2, "valign": "middle" } },
      { "id": "v1", "type": "text", "x": 28, "y": 0, "w": 62, "h": 10, "value": "{{ record.PRODUCT }}", "style": { "fontSize": 14, "bold": true, "padding": 2, "valign": "middle" } },
      { "id": "l2", "type": "text", "x": 0, "y": 10, "w": 28, "h": 10, "value": "두께×폭", "style": { "fontSize": 10, "bold": true, "fill": "#eee", "padding": 2, "valign": "middle" } },
      { "id": "v2", "type": "text", "x": 28, "y": 10, "w": 62, "h": 10, "value": "{{ formatNumber(record.THICK, '0.00') }} × {{ record.WIDTH }}", "style": { "fontSize": 14, "bold": true, "padding": 2, "valign": "middle" } },
      { "id": "l3", "type": "text", "x": 0, "y": 20, "w": 28, "h": 10, "value": "중량(kg)", "style": { "fontSize": 10, "bold": true, "fill": "#eee", "padding": 2, "valign": "middle" } },
      { "id": "v3", "type": "text", "x": 28, "y": 20, "w": 62, "h": 10, "value": "{{ formatNumber(record.WEIGHT) }}", "style": { "fontSize": 14, "bold": true, "padding": 2, "valign": "middle" } },
      { "id": "l4", "type": "text", "x": 0, "y": 30, "w": 28, "h": 10, "value": "고객사", "style": { "fontSize": 10, "bold": true, "fill": "#eee", "padding": 2, "valign": "middle" } },
      { "id": "v4", "type": "text", "x": 28, "y": 30, "w": 62, "h": 10, "value": "{{ record.CUSTOMER }}", "style": { "fontSize": 12, "padding": 2, "valign": "middle" } },
      { "id": "l5", "type": "text", "x": 0, "y": 40, "w": 28, "h": 10, "value": "등급", "style": { "fontSize": 10, "bold": true, "fill": "#eee", "padding": 2, "valign": "middle" } },
      { "id": "v5", "type": "text", "x": 28, "y": 40, "w": 62, "h": 10, "value": "{{ record.GRADE }}", "style": { "fontSize": 14, "bold": true, "padding": 2, "valign": "middle" } },
      { "id": "spec-box", "type": "rect", "x": 0, "y": 0, "w": 90, "h": 50, "style": { "stroke": "#000", "strokeWidth": 0.3 } }
    ]},
    { "id": "qr", "type": "barcode", "x": 65, "y": 112, "w": 30, "h": 30, "format": "qr", "value": "{{ record.COIL_NO }}|{{ record.PRODUCT }}|{{ record.WEIGHT }}", "showText": false },
    { "id": "dt", "type": "text", "x": 5, "y": 118, "w": 55, "h": 8, "value": "{{ formatDate(record.DT, 'yyyy-MM-dd') }}", "style": { "fontSize": 10 } },
    { "id": "copy", "type": "text", "x": 5, "y": 128, "w": 55, "h": 8, "value": "{{ copy }} / {{ copies }}", "style": { "fontSize": 9, "color": "#444" } }
  ]
}
```

`packages/renderer/src/__tests__/fixtures/product-label.report.json` (제품 라벨 60×40, 품목마다 한 장):
```json
{
  "id": "product-label", "name": "제품 라벨", "version": 1,
  "page": { "width": 60, "height": 40, "margin": [2, 2, 2, 2] },
  "output": { "kind": "label", "label": { "language": "zpl", "dpi": 203, "threshold": 128 } },
  "datasets": [{ "name": "items", "type": "static", "rows": [] }],
  "repeat": { "source": "items", "as": "record" },
  "sample": { "params": {}, "capturedAt": "2026-09-17T00:00:00.000Z", "data": { "items": [
    { "ITEM_NO": "SPCC-10-1219", "NAME": "냉연강판 SPCC 1.0t", "QTY": 120, "LOT_NO": "L2609-0142" },
    { "ITEM_NO": "SPCC-12-1219", "NAME": "냉연강판 SPCC 1.2t", "QTY": 80, "LOT_NO": "L2609-0143" }
  ]}},
  "elements": [
    { "id": "name", "type": "text", "x": 2, "y": 2, "w": 56, "h": 7, "value": "{{ record.NAME }}", "style": { "fontSize": 11, "bold": true, "valign": "middle" } },
    { "id": "bc", "type": "barcode", "x": 2, "y": 10, "w": 56, "h": 16, "format": "code128", "value": "{{ record.ITEM_NO }}", "showText": true, "style": { "fontSize": 8 } },
    { "id": "qty", "type": "text", "x": 2, "y": 28, "w": 27, "h": 8, "value": "수량 {{ formatNumber(record.QTY) }}", "style": { "fontSize": 10, "valign": "middle" } },
    { "id": "lot", "type": "text", "x": 30, "y": 28, "w": 28, "h": 8, "value": "LOT {{ record.LOT_NO }}", "style": { "fontSize": 9, "align": "right", "valign": "middle" } }
  ]
}
```

- [ ] **Step 2: 골든 테스트 작성**

`packages/renderer/src/__tests__/golden-phase3.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { fixtureContext } from "./fixtures/context";
import coilTag from "./fixtures/coil-tag.report.json";
import productLabel from "./fixtures/product-label.report.json";

describe("golden: label examples", () => {
  it.each([["coil-tag", coilTag, 3, 2], ["product-label", productLabel, 2, 1]])("%s lays out one label per record with barcodes and matches its snapshot", (_name, fixture, labels, barcodes) => {
    const report = parseReport(fixture);
    expect(report.output.kind).toBe("label");
    const pages = layout(report, fixtureContext(report));
    expect(pages).toHaveLength(labels);
    expect(pages.flatMap((p) => p.items).filter((i) => i.error)).toEqual([]);
    for (const p of pages) expect(p.items.filter((i) => i.kind === "svg")).toHaveLength(barcodes);
    expect(pages.map((p) => [p.copyIndex, p.pageInCopy])).toEqual(Array.from({ length: labels }, (_, i) => [i, 0]));
    expect(pages).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: 실행하여 스냅샷 생성**

Run: `pnpm --filter @daport/renderer test -- golden-phase3`
Expected: PASS(스냅샷 생성). 스냅샷에서 `"kind": "svg"` 항목의 `svg` 문자열에 `<svg`가 있고 `#ERR`가 없는지 grep으로 확인한다. 수치가 맞지 않으면 fixture의 좌표가 아니라 검증 수치를 실제에 맞춘다(단, 라벨 수 = 레코드 수, 페이지마다 바코드 수는 의미 있는 검증이므로 유지).

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/__tests__
git commit -m "test(renderer): 라벨 예제 2종(코일 Tag·제품 라벨) 골든"
```

---

### Task 6: studio 프리셋 저장소·API

**Files:**
- Create: `apps/studio/src/lib/presets.ts`, `apps/studio/src/lib/preset-store.ts`, `apps/studio/src/app/api/presets/route.ts`, `apps/studio/src/app/api/presets/[id]/route.ts`
- Modify: `apps/studio/src/db/schema.ts`
- Test: `apps/studio/src/lib/__tests__/preset-store.test.ts`, `apps/studio/src/app/api/presets/__tests__/presets-route.test.ts`

**Interfaces:**
- Consumes: T1 `PresetSchema`, `Preset`, `PresetInput`; 기존 `db()`, `NotFoundError`, `readJsonBody`.
- Produces: `BUILTIN_PRESETS`, `PresetStore`, `MemoryPresetStore`, `DbPresetStore`, `getPresetStore()`, `ConflictError`, `ForbiddenError`, 라우트 3개.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/preset-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPresetStore, ConflictError, ForbiddenError } from "../preset-store";
import { BUILTIN_PRESETS } from "../presets";
import { NotFoundError } from "../report-store";

describe("BUILTIN_PRESETS", () => {
  it("has the document sizes and the two label presets with label output", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(ids).toEqual(["a4-portrait", "a4-landscape", "a3-portrait", "a3-landscape", "letter", "coil-tag-100x150", "product-label-60x40"]);
    expect(BUILTIN_PRESETS.every((p) => p.builtin)).toBe(true);
    const coil = BUILTIN_PRESETS.find((p) => p.id === "coil-tag-100x150")!;
    expect(coil.page).toMatchObject({ width: 100, height: 150 });
    expect(coil.output).toEqual({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } });
    expect(BUILTIN_PRESETS.find((p) => p.id === "a4-landscape")!.page).toMatchObject({ width: 297, height: 210 });
  });
});

describe("MemoryPresetStore", () => {
  let store: MemoryPresetStore;
  beforeEach(() => { store = new MemoryPresetStore(); });

  it("lists builtin presets first, then user presets", async () => {
    await store.create({ id: "my-tag", name: "내 Tag", page: { width: 80, height: 50 } });
    const list = await store.list();
    expect(list.slice(0, BUILTIN_PRESETS.length).map((p) => p.id)).toEqual(BUILTIN_PRESETS.map((p) => p.id));
    expect(list.at(-1)).toMatchObject({ id: "my-tag", builtin: false, output: { kind: "pdf" } });
    expect(await store.get("my-tag")).toMatchObject({ name: "내 Tag" });
    expect(await store.get("a4-portrait")).toMatchObject({ builtin: true });
  });
  it("rejects a builtin or duplicate id with ConflictError and forces builtin false", async () => {
    await expect(store.create({ id: "a4-portrait", name: "x", page: { width: 1, height: 1 } })).rejects.toThrow(ConflictError);
    await store.create({ id: "dup", name: "x", page: { width: 1, height: 1 }, builtin: true });
    expect((await store.get("dup"))!.builtin).toBe(false);
    await expect(store.create({ id: "dup", name: "y", page: { width: 1, height: 1 } })).rejects.toThrow(ConflictError);
  });
  it("deletes user presets, refuses builtin ones and reports missing ids", async () => {
    await store.create({ id: "gone", name: "x", page: { width: 1, height: 1 } });
    await store.delete("gone");
    expect(await store.get("gone")).toBeNull();
    await expect(store.delete("a4-portrait")).rejects.toThrow(ForbiddenError);
    await expect(store.delete("nope")).rejects.toThrow(NotFoundError);
  });
});
```

`apps/studio/src/app/api/presets/__tests__/presets-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { GET, POST } from "../route";
import { DELETE } from "../[id]/route";

const base = "http://localhost/api/presets";
const headers = { "content-type": "application/json" };
const post = (body: unknown) => POST(new Request(base, { method: "POST", headers, body: JSON.stringify(body) }));
const del = (id: string) => DELETE(new Request(`${base}/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeAll(() => { delete process.env.DATABASE_URL; });

describe("presets API (memory store)", () => {
  it("GET lists builtin presets", async () => {
    const list = await (await GET()).json();
    expect(list.map((p: { id: string }) => p.id)).toContain("coil-tag-100x150");
  });
  it("POST creates 201, 409 on conflict, 400 on invalid input", async () => {
    const res = await post({ id: "e2e-tag", name: "E2E", page: { width: 80, height: 50 }, output: { kind: "label", label: { language: "tspl", dpi: 300 } } });
    expect(res.status).toBe(201);
    expect((await res.json()).output.label.threshold).toBe(128);
    expect((await post({ id: "e2e-tag", name: "again", page: { width: 1, height: 1 } })).status).toBe(409);
    expect((await post({ id: "a4-portrait", name: "x", page: { width: 1, height: 1 } })).status).toBe(409);
    expect((await post({ id: "Bad", name: "x", page: { width: 1, height: 1 } })).status).toBe(400);
    expect((await post(5)).status).toBe(400);
    const list = await (await GET()).json();
    expect(list.at(-1).id).toBe("e2e-tag");
  });
  it("DELETE returns 204, 403 for builtin, 404 for unknown", async () => {
    expect((await del("e2e-tag")).status).toBe(204);
    expect((await del("a4-portrait")).status).toBe(403);
    expect((await del("e2e-tag")).status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- preset`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`apps/studio/src/lib/presets.ts`:
```ts
import { PresetSchema, type Preset } from "@daport/core";

const page = (width: number, height: number, margin: [number, number, number, number] = [10, 10, 10, 10]) => ({ width, height, margin });
const zpl203 = { kind: "label" as const, label: { language: "zpl" as const, dpi: 203 as const } };

/** 내장 프리셋 (스펙 4.3). 사용자 정의는 저장소에 둔다 */
export const BUILTIN_PRESETS: Preset[] = [
  { id: "a4-portrait", name: "A4 세로", page: page(210, 297) },
  { id: "a4-landscape", name: "A4 가로", page: page(297, 210) },
  { id: "a3-portrait", name: "A3 세로", page: page(297, 420) },
  { id: "a3-landscape", name: "A3 가로", page: page(420, 297) },
  { id: "letter", name: "Letter", page: page(215.9, 279.4) },
  { id: "coil-tag-100x150", name: "코일 Tag 100×150 · ZPL 203dpi", page: page(100, 150, [3, 3, 3, 3]), output: zpl203 },
  { id: "product-label-60x40", name: "제품 라벨 60×40 · ZPL 203dpi", page: page(60, 40, [2, 2, 2, 2]), output: zpl203 },
].map((p) => PresetSchema.parse({ ...p, builtin: true }));

export const isBuiltinPresetId = (id: string) => BUILTIN_PRESETS.some((p) => p.id === id);
```

`apps/studio/src/db/schema.ts`에 추가:
```ts
export const presets = pgTable("presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`apps/studio/src/lib/preset-store.ts`:
```ts
import { eq } from "drizzle-orm";
import { PresetSchema, type Preset, type PresetInput } from "@daport/core";
import { db } from "@/db/client";
import { presets } from "@/db/schema";
import { BUILTIN_PRESETS, isBuiltinPresetId } from "./presets";
import { NotFoundError } from "./report-store";

export class ConflictError extends Error { constructor(id: string) { super(`preset exists: ${id}`); this.name = "ConflictError"; } }
export class ForbiddenError extends Error { constructor(id: string) { super(`builtin preset cannot be deleted: ${id}`); this.name = "ForbiddenError"; } }

export interface PresetStore {
  list(): Promise<Preset[]>;            // 내장 + 사용자 정의
  get(id: string): Promise<Preset | null>;
  create(input: PresetInput): Promise<Preset>;   // builtin은 항상 false로 저장
  delete(id: string): Promise<void>;
}

const parseUser = (input: PresetInput): Preset => {
  const p = PresetSchema.parse({ ...input, builtin: false });
  if (isBuiltinPresetId(p.id)) throw new ConflictError(p.id);
  return p;
};

export class MemoryPresetStore implements PresetStore {
  private map = new Map<string, Preset>();
  async list() { return [...BUILTIN_PRESETS, ...this.map.values()]; }
  async get(id: string) { return BUILTIN_PRESETS.find((p) => p.id === id) ?? this.map.get(id) ?? null; }
  async create(input: PresetInput) {
    const p = parseUser(input);
    if (this.map.has(p.id)) throw new ConflictError(p.id);
    this.map.set(p.id, p); return p;
  }
  async delete(id: string) {
    if (isBuiltinPresetId(id)) throw new ForbiddenError(id);
    if (!this.map.delete(id)) throw new NotFoundError(id);
  }
}

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) if ((cur as { code?: unknown }).code === "23505") return true;
  return false;
}

export class DbPresetStore implements PresetStore {
  async list() {
    const rows = await db().select().from(presets).orderBy(presets.createdAt);
    return [...BUILTIN_PRESETS, ...rows.map((r) => PresetSchema.parse(r.body))];
  }
  async get(id: string) {
    const b = BUILTIN_PRESETS.find((p) => p.id === id); if (b) return b;
    const [row] = await db().select().from(presets).where(eq(presets.id, id));
    return row ? PresetSchema.parse(row.body) : null;
  }
  async create(input: PresetInput) {
    const p = parseUser(input);
    try { await db().insert(presets).values({ id: p.id, name: p.name, body: p }); }
    catch (e) { if (isUniqueViolation(e)) throw new ConflictError(p.id); throw e; }
    return p;
  }
  async delete(id: string) {
    if (isBuiltinPresetId(id)) throw new ForbiddenError(id);
    const res = await db().delete(presets).where(eq(presets.id, id)).returning({ id: presets.id });
    if (res.length === 0) throw new NotFoundError(id);
  }
}

// 레포트 저장소와 같은 이유로 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportPresetStore?: PresetStore };
export function getPresetStore(): PresetStore {
  if (!holder.__daportPresetStore) holder.__daportPresetStore = process.env.DATABASE_URL ? new DbPresetStore() : new MemoryPresetStore();
  return holder.__daportPresetStore;
}
```

`apps/studio/src/app/api/presets/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { PresetInput } from "@daport/core";
import { getPresetStore, ConflictError } from "@/lib/preset-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

export async function GET() { return NextResponse.json(await getPresetStore().list()); }

export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    return NextResponse.json(await getPresetStore().create(parsed.body as PresetInput), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ConflictError ? 409 : 400 });
  }
}
```

`apps/studio/src/app/api/presets/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getPresetStore, ForbiddenError } from "@/lib/preset-store";
import { NotFoundError } from "@/lib/report-store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getPresetStore().delete((await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const status = e instanceof ForbiddenError ? 403 : e instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. DB 스키마 반영은 `pnpm --filter studio db:push`(DATABASE_URL이 있을 때만; 이 태스크에서는 실행하지 않는다).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): 페이지 프리셋 저장소(내장+사용자 정의)와 API"
```

---

### Task 7: studio 출력 설정 패널, 프리셋 UI, 스토어 액션

**Files:**
- Create: `apps/studio/src/editor/panels/OutputPanel.tsx`
- Modify: `apps/studio/src/editor/store.ts`, `apps/studio/src/editor/panels/PagePanel.tsx`
- Test: `apps/studio/src/editor/__tests__/OutputPanel.test.tsx`, `apps/studio/src/editor/__tests__/store.test.ts`(추가), `apps/studio/src/editor/__tests__/panels.test.tsx`(PagePanel describe 교체)

**Interfaces:**
- Consumes: T1 `Output`, `Preset`; T6 `BUILTIN_PRESETS`, `GET/POST/DELETE /api/presets`.
- Produces: 스토어 `setOutput`, `applyPreset`, `bitmapPreview`, `setBitmapPreview`; `OutputPanel`; PagePanel 프리셋 드롭다운(값 = 프리셋 id 또는 `custom`), "프리셋으로 저장", "프리셋 삭제".

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/store.test.ts` 끝에 추가:
```ts
describe("editor store (phase 3)", () => {
  const rep = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } });
  it("setOutput is undoable and applyPreset changes page and output in one step", () => {
    const store = createEditorStore(rep);
    store.getState().setOutput({ kind: "label", label: { language: "tspl", dpi: 300, threshold: 100, copies: 2 } });
    expect(store.getState().report.output).toMatchObject({ kind: "label", label: { language: "tspl", dpi: 300 } });
    store.getState().applyPreset({ id: "p", name: "P", builtin: false, page: { width: 60, height: 40, margin: [2, 2, 2, 2], unit: "mm" }, output: { kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } } });
    expect(store.getState().report.page).toMatchObject({ width: 60, height: 40, margin: [2, 2, 2, 2] });
    expect(store.getState().report.output).toMatchObject({ kind: "label", label: { language: "zpl" } });
    store.getState().undo();
    expect(store.getState().report.page.width).toBe(100);
    expect(store.getState().report.output).toMatchObject({ kind: "label", label: { language: "tspl" } });
    store.getState().undo();
    expect(store.getState().report.output).toEqual({ kind: "pdf" });
  });
  it("keeps bitmapPreview outside history", () => {
    const store = createEditorStore(rep);
    store.getState().setBitmapPreview(true);
    expect(store.getState().bitmapPreview).toBe(true);
    expect(store.getState().dirty).toBe(false);
  });
});
```

`apps/studio/src/editor/__tests__/OutputPanel.test.tsx`:
```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { OutputPanel } from "../panels/OutputPanel";

afterEach(cleanup);
const report = parseReport({ id: "r", version: 1, page: { width: 60, height: 40 } });
function setup() {
  const store = createEditorStore(report);
  const utils = render(<EditorContext.Provider value={store}><OutputPanel /></EditorContext.Provider>);
  return { store, out: () => store.getState().report.output, ...utils };
}

describe("OutputPanel", () => {
  it("switches to label with defaults, edits language/dpi/threshold/copies, and back to pdf", () => {
    const { getByLabelText, queryByLabelText, out } = setup();
    expect(queryByLabelText("언어")).toBeNull();
    fireEvent.change(getByLabelText("출력 종류"), { target: { value: "label" } });
    expect(out()).toEqual({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } });
    fireEvent.change(getByLabelText("언어"), { target: { value: "tspl" } });
    fireEvent.change(getByLabelText("DPI"), { target: { value: "300" } });
    fireEvent.change(getByLabelText("임계값"), { target: { value: "100" } });
    fireEvent.change(getByLabelText("매수"), { target: { value: "3" } });
    expect(out()).toEqual({ kind: "label", label: { language: "tspl", dpi: 300, threshold: 100, copies: 3 } });
    fireEvent.change(getByLabelText("출력 종류"), { target: { value: "pdf" } });
    expect(out()).toEqual({ kind: "pdf" });
  });
  it("sets and clears optional darkness/speed and ignores out-of-range values", () => {
    const { getByLabelText, out } = setup();
    fireEvent.change(getByLabelText("출력 종류"), { target: { value: "label" } });
    fireEvent.change(getByLabelText("농도"), { target: { value: "15" } });
    fireEvent.change(getByLabelText("속도"), { target: { value: "4" } });
    expect((out() as { label: { darkness?: number; speed?: number } }).label).toMatchObject({ darkness: 15, speed: 4 });
    fireEvent.change(getByLabelText("농도"), { target: { value: "" } });
    fireEvent.change(getByLabelText("속도"), { target: { value: "99" } });
    const label = (out() as { label: { darkness?: number; speed?: number } }).label;
    expect(label.darkness).toBeUndefined();
    expect(label.speed).toBe(4);
  });
});
```

`apps/studio/src/editor/__tests__/panels.test.tsx`의 `describe("PagePanel", …)`를 다음으로 교체한다(프리셋 값이 이름에서 id로 바뀐다; `page panel repeat switch` describe는 그대로):
```tsx
describe("PagePanel presets", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows custom for an unknown size, applies a builtin preset (page + output) and returns to custom", async () => {
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    const select = () => screen.getByLabelText("프리셋") as HTMLSelectElement;
    expect(select().value).toBe("custom");
    fireEvent.change(select(), { target: { value: "coil-tag-100x150" } });
    expect(store.getState().report.page).toMatchObject({ width: 100, height: 150 });
    expect(store.getState().report.output.kind).toBe("label");
    expect(select().value).toBe("coil-tag-100x150");
    fireEvent.change(screen.getByLabelText("너비(mm)"), { target: { value: "99" } });
    expect(select().value).toBe("custom");
  });
  it("lists user presets from the API, saves the current settings as a preset and deletes it", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let list = [{ id: "my-tag", name: "내 Tag", page: { width: 80, height: 50, margin: [1, 1, 1, 1], unit: "mm" }, output: { kind: "pdf" }, builtin: false }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") { list = [...list, { ...JSON.parse(String(init.body)), builtin: false, output: { kind: "pdf" } }]; return new Response(JSON.stringify(list.at(-1)), { status: 201 }); }
      if (init?.method === "DELETE") { list = list.filter((p) => !url.endsWith(p.id)); return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify(list), { status: 200 });
    }));
    const store = createEditorStore(report);
    mount(store, <PagePanel />);
    await waitFor(() => expect(screen.getByRole("option", { name: "내 Tag" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("프리셋"), { target: { value: "my-tag" } });
    expect(store.getState().report.page).toMatchObject({ width: 80, height: 50, margin: [1, 1, 1, 1] });
    fireEvent.click(screen.getByRole("button", { name: "프리셋 삭제" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "내 Tag" })).toBeNull());
    fireEvent.change(screen.getByLabelText("새 프리셋 id"), { target: { value: "saved-one" } });
    fireEvent.change(screen.getByLabelText("새 프리셋 이름"), { target: { value: "저장한 것" } });
    fireEvent.click(screen.getByRole("button", { name: "프리셋으로 저장" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "저장한 것" })).toBeTruthy());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ id: "saved-one", name: "저장한 것", page: { width: 80, height: 50 } });
  });
});
```
(파일 상단 import에 `beforeEach, vi`와 `waitFor`를 더한다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- store OutputPanel panels`
Expected: FAIL.

- [ ] **Step 3: 스토어 액션**

`apps/studio/src/editor/store.ts`: `EditorState`에 추가
```ts
  bitmapPreview: boolean;                     // 라벨 미리보기에서 이진화 PNG를 보인다. 히스토리 밖
  setBitmapPreview(v: boolean): void;
  setOutput(output: Report["output"]): void;
  applyPreset(preset: Preset): void;          // page + output을 한 커밋으로
```
import에 `type Preset`을 더하고, 초기 상태에 `bitmapPreview: false`, 구현:
```ts
      setBitmapPreview: (bitmapPreview) => set({ bitmapPreview }),
      setOutput: (output) => apply((r) => { r.output = output; }),
      applyPreset: (preset) => apply((r) => { r.page = { ...preset.page }; r.output = structuredClone(preset.output); }),
```

- [ ] **Step 4: OutputPanel.tsx**

`apps/studio/src/editor/panels/OutputPanel.tsx`:
```tsx
"use client";
import type { LabelOutput } from "@daport/core";
import { useEditor } from "../store";
import { Field, NumberField, SelectField } from "./Field";

const DEFAULT_LABEL: LabelOutput = { language: "zpl", dpi: 203, threshold: 128, copies: 1 };

/** 빈 값이면 undefined, 범위 밖이면 커밋하지 않는 선택 정수 입력 (농도·속도) */
function OptionalIntField({ label, value, min, max, onChange }: { label: string; value: number | undefined; min: number; max: number; onChange: (v: number | undefined) => void }) {
  return <Field label={label}><input aria-label={label} type="number" min={min} max={max} value={value ?? ""} className="w-full border rounded px-1 py-0.5"
    onChange={(e) => { if (e.target.value === "") { onChange(undefined); return; } const n = e.target.valueAsNumber; if (Number.isInteger(n) && n >= min && n <= max) onChange(n); }} /></Field>;
}

/** 출력 설정 (스펙 7.2). 라벨이면 언어·DPI·임계값·농도·속도·매수 */
export function OutputPanel() {
  const output = useEditor((s) => s.report.output);
  const setOutput = useEditor((s) => s.setOutput);
  const label = output.kind === "label" ? output.label : undefined;
  const setLabel = (patch: Partial<LabelOutput>) => setOutput({ kind: "label", label: { ...(label ?? DEFAULT_LABEL), ...patch } });
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold mt-2">출력</div>
      <SelectField label="출력 종류" value={output.kind} options={["pdf", "label"]} onChange={(kind) => setOutput(kind === "pdf" ? { kind: "pdf" } : { kind: "label", label: label ?? DEFAULT_LABEL })} />
      {label && <>
        <SelectField label="언어" value={label.language} options={["zpl", "tspl"]} onChange={(language) => setLabel({ language })} />
        <SelectField label="DPI" value={String(label.dpi)} options={["203", "300"]} onChange={(v) => setLabel({ dpi: Number(v) as 203 | 300 })} />
        <NumberField label="임계값" value={label.threshold} step={1} min={0} onChange={(v) => { if (Number.isInteger(v) && v <= 255) setLabel({ threshold: v }); }} />
        <OptionalIntField label="농도" value={label.darkness} min={0} max={30} onChange={(darkness) => setLabel({ darkness })} />
        <OptionalIntField label="속도" value={label.speed} min={1} max={14} onChange={(speed) => setLabel({ speed })} />
        <NumberField label="매수" value={label.copies} step={1} min={1} onChange={(v) => { if (Number.isInteger(v)) setLabel({ copies: v }); }} />
      </>}
    </div>
  );
}
```
`setLabel({ darkness: undefined })`는 `commit`의 JSON 복제로 키가 지워진다(2단계 RepeaterPanel과 같은 규칙).

- [ ] **Step 5: PagePanel.tsx 교체**

`apps/studio/src/editor/panels/PagePanel.tsx` 전체:
```tsx
"use client";
import { useEffect, useState } from "react";
import type { Preset } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, SelectField, TextField, CheckField, Field } from "./Field";
import { defaultSource } from "./ElementPalette";
import { OutputPanel } from "./OutputPanel";
import { BUILTIN_PRESETS } from "@/lib/presets";

const samePage = (a: Preset["page"], b: Preset["page"]) => a.width === b.width && a.height === b.height && a.margin.every((m, i) => m === b.margin[i]);

/** 페이지 크기·프리셋·반복·출력 설정 (스펙 4.3, 7.1, 7.2). 프리셋 목록 = 내장(동기) + 사용자 정의(API) */
export function PagePanel() {
  const report = useEditor((s) => s.report);
  const page = report.page;
  const updatePage = useEditor((s) => s.updatePage);
  const applyPreset = useEditor((s) => s.applyPreset);
  const repeat = useEditor((s) => s.report.repeat);
  const setRepeat = useEditor((s) => s.setRepeat);
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch("/api/presets");
      if (!r.ok) return;
      const list = (await r.json()) as Preset[];
      setUserPresets(list.filter((p) => !p.builtin));
    } catch { /* 목록을 못 받아도 내장 프리셋은 쓸 수 있다 */ }
  };
  useEffect(() => { void refresh(); }, []);

  const presets = [...BUILTIN_PRESETS, ...userPresets];
  // 크기·여백·출력이 모두 같은 프리셋만 "선택됨"으로 본다
  const current = presets.find((p) => samePage(p.page, page) && JSON.stringify(p.output) === JSON.stringify(report.output))?.id ?? "custom";
  const options = ["custom", ...presets.map((p) => p.id)];
  const labelOf = (id: string) => (id === "custom" ? "사용자 정의" : presets.find((p) => p.id === id)!.name);

  const save = async () => {
    setError(null);
    const r = await fetch("/api/presets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: newId, name: newName, page, output: report.output }) });
    if (!r.ok) { setError(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `저장 실패 (HTTP ${r.status})`); return; }
    setNewId(""); setNewName("");
    await refresh();
  };
  const remove = async () => {
    const r = await fetch(`/api/presets/${encodeURIComponent(current)}`, { method: "DELETE" });
    if (!r.ok) { setError(`삭제 실패 (HTTP ${r.status})`); return; }
    await refresh();
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">페이지</div>
      <Field label="프리셋">
        <select aria-label="프리셋" value={current} className="w-full border rounded px-1 py-0.5"
          onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) applyPreset(p); }}>
          {options.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
        </select>
      </Field>
      {userPresets.some((p) => p.id === current) && <button className={btn + " self-start"} onClick={remove}>프리셋 삭제</button>}
      <NumberField label="너비(mm)" value={page.width} onChange={(width) => { if (width > 0) updatePage({ width }); }} />
      <NumberField label="높이(mm)" value={page.height} onChange={(height) => { if (height > 0) updatePage({ height }); }} />
      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-600">현재 설정을 프리셋으로 저장</summary>
        <div className="flex flex-col gap-1 mt-1">
          <TextField label="새 프리셋 id" value={newId} onChange={setNewId} />
          <TextField label="새 프리셋 이름" value={newName} onChange={setNewName} />
          <button className={btn + " self-start"} disabled={!newId || !newName} onClick={save}>프리셋으로 저장</button>
          {error && <div className="text-red-700">{error}</div>}
        </div>
      </details>

      <OutputPanel />

      <div className="text-xs font-semibold mt-2">반복</div>
      <CheckField label="레코드마다 한 부씩" value={!!repeat} onChange={(on) => setRepeat(on ? { source: defaultSource(report), as: "record" } : undefined)} />
      {/* RepeatSchema.source는 min(1) — TablePanel·RepeaterPanel의 소스 필드와 같은 규칙으로 빈 값은 커밋하지 않는다 */}
      {repeat && <TextField label="반복 소스" value={repeat.source} onChange={(v) => { if (v.trim() !== "") setRepeat({ ...repeat, source: v }); }} />}
    </div>
  );
}
```
`SelectField`는 `options`가 값 배열이라 표시 이름이 다른 드롭다운에는 `Field`+`select`를 직접 쓴다. `Field.tsx`가 `Field`를 export하는지 확인하고(1단계에서 export함) `SelectField` import가 안 쓰이면 지운다.

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. `Editor.test.tsx`는 PagePanel의 `fetch`를 만난다 — 그 테스트가 `vi.stubGlobal("fetch", …)`를 하지 않는 케이스에서는 실제 `fetch`가 상대 URL로 실패해 `catch`로 삼켜진다(jsdom에서 `TypeError`). 콘솔에 unhandled rejection이 남으면 `refresh` 안의 try/catch로 이미 막힌다; 남는 경고가 있으면 그 테스트에 빈 배열 fetch 스텁을 더한다.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src
git commit -m "feat(studio): 출력 설정 패널, 프리셋 드롭다운·저장·삭제, 스토어 출력·프리셋 액션"
```

---

### Task 8: studio 바코드 팔레트·속성

**Files:**
- Modify: `apps/studio/src/editor/panels/ElementPalette.tsx`, `apps/studio/src/editor/panels/PropertyPanel.tsx`
- Test: `apps/studio/src/editor/__tests__/panels.test.tsx`(추가), `apps/studio/src/editor/__tests__/PropertyPanel.test.tsx`(추가)

**Interfaces:**
- Consumes: T1 `BarcodeFormat`; T2(캔버스가 svg를 그린다 — 이 태스크는 편집 UI만).
- Produces: 팔레트 "바코드"(code128, 40×15mm, `value: "123456"`, `showText: true`), 속성 패널 형식·값·텍스트 표시·글자크기.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/panels.test.tsx`의 `describe("palette (phase 2)", …)` 뒤에 추가:
```tsx
describe("palette (phase 3)", () => {
  it("adds a code128 barcode with a sample value", () => {
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><ElementPalette /></EditorContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "+ 바코드" }));
    expect(store.getState().findElement("barcode-1")).toMatchObject({ type: "barcode", format: "code128", value: "123456", showText: true, w: 40, h: 15 });
  });
});
```

`apps/studio/src/editor/__tests__/PropertyPanel.test.tsx` 끝에 추가:
```tsx
describe("PropertyPanel barcode", () => {
  it("edits format, value, showText and font size", () => {
    const store = createEditorStore(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "code128", value: "123" },
    ]}));
    store.getState().select(["b"]);
    const { getByLabelText } = render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(getByLabelText("형식"), { target: { value: "qr" } });
    fireEvent.change(getByLabelText("값"), { target: { value: "{{ record.NO }}" } });
    fireEvent.click(getByLabelText("텍스트 표시"));
    fireEvent.change(getByLabelText("글자크기"), { target: { value: "6" } });
    expect(store.getState().findElement("b")).toMatchObject({ format: "qr", value: "{{ record.NO }}", showText: false, style: { fontSize: 6 } });
  });
});
```
(파일의 기존 import에 `parseReport`, `render`, `fireEvent`, `createEditorStore`, `EditorContext`, `PropertyPanel`이 있는지 확인하고 없으면 더한다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- panels PropertyPanel`
Expected: FAIL — 버튼·라벨 없음.

- [ ] **Step 3: 구현**

`ElementPalette.tsx`의 `ITEMS`에 "페이지번호" 다음으로 추가:
```ts
  { label: "바코드", base: "barcode", make: (id) => ({ id, type: "barcode", x: 10, y: 10, w: 40, h: 15, format: "code128", value: "123456", showText: true, flow: "once", style: { ...defaultStyle(), fontSize: 8 } }) },
```

`PropertyPanel.tsx`: `{el.type === "image" && …}` 다음에
```tsx
      {el.type === "barcode" && <>
        <SelectField label="형식" value={el.format} options={["code128", "ean13", "qr", "code39", "datamatrix"]} onChange={(format) => set({ format })} />
        <TextField label="값" value={el.value} onChange={(value) => set({ value })} />
        <CheckField label="텍스트 표시" value={el.showText} onChange={(showText) => set({ showText })} />
      </>}
```
그리고 스타일 절의 글자크기 조건 `(el.type === "text" || el.type === "pageNumber")`에 `|| el.type === "barcode"`를 더한다(굵게·정렬 등은 그대로 텍스트·페이지번호에만).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/editor
git commit -m "feat(studio): 바코드 팔레트와 속성 패널"
```

---
## 웨이브 3

### Task 9: label 래스터와 renderLabel (PDF 대비 픽셀 비교)

**Files:**
- Create: `packages/label/src/fonts-dir.ts`, `packages/label/src/raster.ts`
- Modify: `packages/label/src/bitmap.ts` (`fitGray` 추가), `packages/label/src/index.ts`
- Test: `packages/label/src/__tests__/bitmap.test.ts`(1개 추가), `packages/label/src/__tests__/label.test.ts`

**Interfaces:**
- Consumes: T3 `withPage`, `fontBaseUrl`, `isBrowserCrash`, `closePool`; T4 `packGray`, `rgbaToGray`, `pxOf`, `encodeZpl`, `encodeTspl`, `bitmapToPng`; T5 fixtures + `fixtureContext`; renderer `renderToHtml`; pdf `renderPdf`(테스트 전용).
- Produces: `fitGray(gray, sw, sh, w, h)`, `LabelTooLargeError`, `MAX_LABEL_PIXELS`, `LabelResult`, `rasterizePages`, `renderLabel`, re-export `closePool`.

- [ ] **Step 1: 실패 테스트 작성**

`packages/label/src/__tests__/bitmap.test.ts`에 추가:
```ts
  it("fitGray crops or pads (white) a gray buffer to the target size", () => {
    const src = new Uint8Array([0, 0, 0, 0, 0, 0]);   // 3×2 전부 검정
    expect(Array.from(fitGray(src, 3, 2, 2, 3))).toEqual([0, 0, 0, 0, 255, 255]);   // 폭은 자르고 높이는 흰색으로 채움
    expect(Array.from(fitGray(src, 3, 2, 3, 2))).toEqual(Array.from(src));
  });
```
(import에 `fitGray` 추가.)

`packages/label/src/__tests__/label.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { PNG } from "pngjs";
import { pdf as pdfToImg } from "pdf-to-img";
import { parseReport } from "@daport/core";
import { renderPdf } from "@daport/pdf";
import { fixtureContext } from "../../../renderer/src/__tests__/fixtures/context";
import coilTag from "../../../renderer/src/__tests__/fixtures/coil-tag.report.json";
import productLabel from "../../../renderer/src/__tests__/fixtures/product-label.report.json";
import { rasterizePages, renderLabel, closePool, LabelTooLargeError, rgbaToGray, packGray, bitmapToPng, pxOf, type Bitmap } from "../index";

afterAll(closePool);

const bit = (bm: Bitmap, x: number, y: number) => (bm.bits[y * Math.ceil(bm.width / 8) + (x >> 3)] >> (7 - (x & 7))) & 1;

/**
 * 두 비트맵의 다른 픽셀 비율. 상대 비트맵의 상하좌우 1px 안에 같은 값이 있으면 래스터 정렬 오차로 보고 세지 않는다
 * (2단계 PDF 비교와 같은 생각: 글리프·선의 서브픽셀 위치는 래스터라이저마다 1px 다르다)
 */
function tolerantDiff(a: Bitmap, b: Bitmap): number {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = bit(a, x, y);
    if (v === bit(b, x, y)) continue;
    const near = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && bit(b, xx, yy) === v; });
    if (!near) n++;
  }
  return n / (w * h);
}

/** PDF를 라벨 DPI로 래스터해 같은 임계값으로 이진화한다 (HTML 경로와 PDF 경로가 같은 배치인지 본다) */
async function pdfBitmaps(report: ReturnType<typeof parseReport>, data: Record<string, unknown>, dpi: number, threshold: number): Promise<Bitmap[]> {
  const doc = await pdfToImg(await renderPdf(report, data), { scale: dpi / 72 });
  const out: Bitmap[] = [];
  for await (const page of doc) {
    const png = PNG.sync.read(Buffer.from(page));
    out.push(packGray(rgbaToGray(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height), png.width, png.height, threshold));
  }
  return out;
}

const MAX_DIFF = 0.02;   // 측정 후 보고서에 실제 값을 적는다. 이 값을 넘으면 원인을 조사하고 예산을 올리지 않는다

describe("rasterizePages", () => {
  it("produces one bitmap per label at round(mm × dpi / 25.4) pixels", async () => {
    const report = parseReport(coilTag);
    const bms = await rasterizePages(report, fixtureContext(report), 203, 128);
    expect(bms).toHaveLength(3);
    expect(bms.every((b) => b.width === pxOf(100, 203) && b.height === pxOf(150, 203))).toBe(true);
    expect(bms[0].bits.some((b) => b !== 0)).toBe(true);
  }, 60_000);
  it.each([["coil-tag", coilTag], ["product-label", productLabel]])("%s: label bitmap matches the PDF rasterized at the same dpi", async (_n, fixture) => {
    const report = parseReport(fixture);
    const data = fixtureContext(report);
    const label = await rasterizePages(report, data, 203, 128);
    const pdf = await pdfBitmaps(report, data, 203, 128);
    expect(pdf).toHaveLength(label.length);
    label.forEach((bm, i) => {
      expect(Math.abs(bm.width - pdf[i].width)).toBeLessThanOrEqual(1);
      expect(Math.abs(bm.height - pdf[i].height)).toBeLessThanOrEqual(1);
      expect(tolerantDiff(bm, pdf[i]), `${_n} label ${i}`).toBeLessThan(MAX_DIFF);
    });
  }, 120_000);
  it("rejects a label bigger than MAX_LABEL_PIXELS before touching the browser", async () => {
    const huge = parseReport({ ...coilTag, page: { width: 2000, height: 2000 }, output: { kind: "label", label: { language: "zpl", dpi: 300 } } });
    await expect(rasterizePages(huge, fixtureContext(huge), 300, 128)).rejects.toThrow(LabelTooLargeError);
  });
});

describe("renderLabel", () => {
  it("encodes ZPL with one block per label and a .zpl filename", async () => {
    const report = parseReport(coilTag);
    const res = await renderLabel(report, fixtureContext(report));
    expect(res).toMatchObject({ language: "zpl", dpi: 203, pages: 3, mime: "text/plain", filename: "coil-tag.zpl" });
    const text = res.data.toString("latin1");
    expect(text.match(/\^XA/g)).toHaveLength(3);
    expect(text).toContain(`^PW${pxOf(100, 203)}`);
    expect(text).toContain("^GFA,");
  }, 60_000);
  it("encodes TSPL as a binary .prn starting with SIZE", async () => {
    const report = parseReport({ ...productLabel, output: { kind: "label", label: { language: "tspl", dpi: 203, copies: 2 } } });
    const res = await renderLabel(report, fixtureContext(report));
    expect(res).toMatchObject({ language: "tspl", pages: 2, mime: "application/octet-stream", filename: "product-label.prn" });
    expect(res.data.subarray(0, 18).toString("latin1")).toBe("SIZE 60 mm,40 mm\r\n");
    expect(res.data.toString("latin1")).toContain("PRINT 1,2\r\n");
  }, 60_000);
  it("throws for a pdf report", async () => {
    const report = parseReport({ ...productLabel, output: { kind: "pdf" } });
    await expect(renderLabel(report, fixtureContext(report))).rejects.toThrow(/not label/);
  });
  it("bitmapToPng of a label is a valid PNG of the label size", async () => {
    const report = parseReport(productLabel);
    const [bm] = await rasterizePages(report, fixtureContext(report), 203, 128);
    const png = PNG.sync.read(bitmapToPng(bm));
    expect([png.width, png.height]).toEqual([pxOf(60, 203), pxOf(40, 203)]);
  }, 60_000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/label test -- label bitmap`
Expected: FAIL — export 없음.

- [ ] **Step 3: 구현**

`packages/label/src/bitmap.ts`에 추가:
```ts
/** 스크린샷 픽셀 수는 CSS 픽셀 × 배율의 반올림이라 목표 크기와 1px 다를 수 있다. 목표 크기로 자르거나 흰색으로 채운다 */
export function fitGray(gray: Uint8Array, sw: number, sh: number, w: number, h: number): Uint8Array {
  if (sw === w && sh === h) return gray;
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < Math.min(sh, h); y++) out.set(gray.subarray(y * sw, y * sw + Math.min(sw, w)), y * w);
  return out;
}
```

`packages/label/src/fonts-dir.ts`: `packages/pdf/src/fonts-dir.ts`와 같은 내용.

`packages/label/src/raster.ts`:
```ts
import { PNG } from "pngjs";
import { renderToHtml, type Report, type DataContext } from "@daport/renderer";
import { withPage, fontBaseUrl, isBrowserCrash } from "@daport/browser";
import { fontsDir } from "./fonts-dir";
import { packGray, rgbaToGray, fitGray, pxOf, type Bitmap } from "./bitmap";

export const MAX_LABEL_PIXELS = 50_000_000;

/** 라벨 비트맵이 너무 크다 (메모리 보호). 라우트는 400 { code: "LABEL_TOO_LARGE" } */
export class LabelTooLargeError extends Error {
  readonly code = "LABEL_TOO_LARGE";
  constructor(pixels: number) { super(`label bitmap of ${pixels} pixels exceeds ${MAX_LABEL_PIXELS}`); this.name = "LabelTooLargeError"; }
}

/**
 * 같은 HTML을 목표 DPI로 스크린샷해 페이지마다 1비트 비트맵을 만든다 (스펙 6.2).
 * deviceScaleFactor = dpi/96으로 CSS 픽셀을 프린터 픽셀에 맞추고, 결과를 목표 크기로 맞춘다
 */
export async function rasterizePages(report: Report, data: DataContext, dpi: number, threshold: number, attempt = 0): Promise<Bitmap[]> {
  const w = pxOf(report.page.width, dpi), h = pxOf(report.page.height, dpi);
  if (w * h > MAX_LABEL_PIXELS) throw new LabelTooLargeError(w * h);
  const html = renderToHtml(report, data, { fontBaseUrl });
  try {
    return await withPage(html, { fontsDir, deviceScaleFactor: dpi / 96 }, async (page) => {
      await page.setViewportSize({ width: Math.ceil((report.page.width / 25.4) * 96), height: Math.ceil((report.page.height / 25.4) * 96) });
      const count = await page.locator(".dp-page").count();
      const out: Bitmap[] = [];
      for (let i = 0; i < count; i++) {
        const png = PNG.sync.read(await page.locator(".dp-page").nth(i).screenshot({ type: "png", scale: "device" }));
        const gray = rgbaToGray(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height);
        out.push(packGray(fitGray(gray, png.width, png.height, w, h), w, h, threshold));
      }
      return out;
    });
  } catch (e) {
    if (attempt === 0 && isBrowserCrash(e)) return rasterizePages(report, data, dpi, threshold, 1);   // pdf와 같은 1회 재시도
    throw e;
  }
}
```

`packages/label/src/index.ts` 전체:
```ts
import type { Report, DataContext } from "@daport/renderer";
import { rasterizePages } from "./raster";
import { encodeZpl, encodeTspl } from "./encode";
export * from "./bitmap";
export * from "./encode";
export * from "./raster";
export { closePool } from "@daport/browser";

export type LabelResult = { language: "zpl" | "tspl"; dpi: number; pages: number; data: Buffer; mime: "text/plain" | "application/octet-stream"; filename: string };

/** 라벨 레포트 → 프린터 명령 (스펙 6.3). output.kind가 label이 아니면 던진다 */
export async function renderLabel(report: Report, data: DataContext): Promise<LabelResult> {
  if (report.output.kind !== "label") throw new Error("report output is not label");
  const { language, dpi, threshold, darkness, speed, copies } = report.output.label;
  const bitmaps = await rasterizePages(report, data, dpi, threshold);
  const opts = { widthMm: report.page.width, heightMm: report.page.height, dpi, copies, darkness, speed };
  return language === "zpl"
    ? { language, dpi, pages: bitmaps.length, data: Buffer.from(encodeZpl(bitmaps, opts), "latin1"), mime: "text/plain", filename: `${report.id}.zpl` }
    : { language, dpi, pages: bitmaps.length, data: encodeTspl(bitmaps, opts), mime: "application/octet-stream", filename: `${report.id}.prn` };
}
```
`@daport/renderer`가 `Report`·`DataContext` 타입을 재export하는지 확인(1단계에서 함).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/label test && pnpm --filter @daport/label typecheck`
Expected: PASS. 픽셀 비교의 측정값(라벨마다)을 보고서에 적는다. 2%를 넘으면 `bitmapToPng`로 두 비트맵을 저장해 눈으로 비교하고 원인(폰트 로드 실패, 뷰포트 크기, 스케일)을 찾는다 — 예산을 올리지 않는다.

- [ ] **Step 5: Commit**

```bash
git add packages/label
git commit -m "feat(label): 목표 DPI 스크린샷 → 이진화 → ZPL/TSPL, PDF 대비 픽셀 비교"
```

---

### Task 10: studio 프린터·라벨·전송 라우트

**Files:**
- Create: `apps/studio/src/lib/printers.ts`, `apps/studio/src/app/api/printers/route.ts`, `apps/studio/src/app/api/reports/[id]/label/route.ts`, `apps/studio/src/app/api/print/route.ts`
- Modify: `apps/studio/package.json` (`@daport/label` 의존), `apps/studio/.env.example`
- Test: `apps/studio/src/lib/__tests__/printers.test.ts`, `apps/studio/src/app/api/reports/__tests__/label-route.test.ts`, `apps/studio/src/app/api/print/__tests__/print-route.test.ts`, `apps/studio/src/app/api/printers/__tests__/printers-route.test.ts`

**Interfaces:**
- Consumes: T9 `renderLabel`, `rasterizePages`, `bitmapToPng`, `LabelTooLargeError`; 2단계 `readJsonBody`, `objectField`, `runDatasets`, `getStore`, `ready`, `resolveAssetUrls`; renderer `LayoutLimitError`.
- Produces: `parsePrinters`, `sendRaw`, `GET /api/printers` → `[{ name }]`, `POST /api/reports/:id/label` (`?preview=png`), `POST /api/print` `{ printer, reportId?, report?, params?, data? }` → `{ printer, bytes, pages }`.

- [ ] **Step 1: 의존성·환경 예시**

`apps/studio/package.json` `dependencies`에 `"@daport/label": "workspace:*"` 추가, 루트 `pnpm install`. `.env.example`에 `DAPORT_PRINTERS=라인1=192.168.10.21:9100,포장=192.168.10.22` 추가.

- [ ] **Step 2: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/printers.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import net from "node:net";
import { parsePrinters, sendRaw } from "../printers";

describe("parsePrinters", () => {
  it("parses name=host[:port] entries, defaulting the port to 9100", () => {
    expect(parsePrinters("라인1=192.168.10.21:9100, 포장=printer.local ,,bad,=x,y=")).toEqual([
      { name: "라인1", host: "192.168.10.21", port: 9100 }, { name: "포장", host: "printer.local", port: 9100 }]);
    expect(parsePrinters(undefined)).toEqual([]);
    expect(parsePrinters("a=h:notaport")).toEqual([]);
  });
});

describe("sendRaw", () => {
  it("sends the bytes to a TCP server and resolves with the byte count", async () => {
    const received: Buffer[] = [];
    const server = net.createServer((sock) => { sock.on("data", (d) => received.push(d)); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    const bytes = await sendRaw({ name: "t", host: "127.0.0.1", port }, Buffer.from("^XA^XZ\n"), 2000);
    expect(bytes).toBe(7);
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(received).toString()).toBe("^XA^XZ\n");
    await new Promise<void>((r) => server.close(() => r()));
  });
  it("rejects when the printer refuses the connection", async () => {
    const server = net.createServer(); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));   // 닫힌 포트
    await expect(sendRaw({ name: "t", host: "127.0.0.1", port }, Buffer.from("x"), 2000)).rejects.toThrow();
  });
});
```

`apps/studio/src/app/api/printers/__tests__/printers-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "../route";
afterEach(() => vi.unstubAllEnvs());
describe("GET /api/printers", () => {
  it("returns names only, never hosts, and [] without the env", async () => {
    vi.stubEnv("DAPORT_PRINTERS", "라인1=10.0.0.1:9100,포장=10.0.0.2");
    expect(await (await GET()).json()).toEqual([{ name: "라인1" }, { name: "포장" }]);
    vi.stubEnv("DAPORT_PRINTERS", "");
    expect(await (await GET()).json()).toEqual([]);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/label-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const renderLabel = vi.fn();
const rasterizePages = vi.fn();
vi.mock("@daport/label", async (orig) => ({ ...(await orig<typeof import("@daport/label")>()), renderLabel, rasterizePages }));
const { POST } = await import("../[id]/label/route");

const label = { id: "lb", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } };
const call = (body: unknown, query = "") => POST(new Request(`http://localhost/api/reports/lb/label${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "lb" }) });
beforeEach(() => { renderLabel.mockReset(); rasterizePages.mockReset(); });

describe("POST /api/reports/[id]/label", () => {
  it("returns the encoded label with mime and filename", async () => {
    renderLabel.mockResolvedValue({ language: "zpl", dpi: 203, pages: 1, data: Buffer.from("^XA^XZ\n"), mime: "text/plain", filename: "lb.zpl" });
    const res = await call({ report: label, params: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toContain('filename="lb.zpl"');
    expect(await res.text()).toBe("^XA^XZ\n");
  });
  it("returns a PNG of the first label for ?preview=png", async () => {
    rasterizePages.mockResolvedValue([{ width: 8, height: 1, bits: new Uint8Array([0xf0]) }]);
    const res = await call({ report: label, params: {} }, "?preview=png");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });
  it("returns 400 for a pdf report, dataset errors, LABEL_TOO_LARGE and LAYOUT_LIMIT", async () => {
    expect((await call({ report: { ...label, output: { kind: "pdf" } }, params: {} })).status).toBe(400);
    const bad = await call({ report: { ...label, datasets: [{ name: "h", type: "http", url: "https://nope.example.com/x" }] }, params: {} });
    expect(bad.status).toBe(400);
    expect((await bad.json()).datasetErrors).toHaveLength(1);
    const { LabelTooLargeError } = await import("@daport/label");
    renderLabel.mockRejectedValue(new LabelTooLargeError(99));
    const big = await call({ report: label, params: {} });
    expect(big.status).toBe(400);
    expect((await big.json()).code).toBe("LABEL_TOO_LARGE");
    const { LayoutLimitError } = await import("@daport/renderer");
    renderLabel.mockRejectedValue(new LayoutLimitError(2001));
    expect((await (await call({ report: label, params: {} })).json()).code).toBe("LAYOUT_LIMIT");
  });
  it("returns 500 for a browser failure", async () => {
    renderLabel.mockRejectedValue(new Error("Target crashed"));
    expect((await call({ report: label, params: {} })).status).toBe(500);
  });
});
```

`apps/studio/src/app/api/print/__tests__/print-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import net from "node:net";

const renderLabel = vi.fn();
vi.mock("@daport/label", async (orig) => ({ ...(await orig<typeof import("@daport/label")>()), renderLabel }));
const { POST } = await import("../route");

const label = { id: "lb", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } };
const call = (body: unknown) => POST(new Request("http://localhost/api/print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
let server: net.Server; let received: Buffer[]; let port: number;
beforeEach(async () => {
  received = [];
  server = net.createServer((s) => s.on("data", (d) => received.push(d)));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as net.AddressInfo).port;
  vi.stubEnv("DAPORT_PRINTERS", `가짜=127.0.0.1:${port}`);
  renderLabel.mockReset().mockResolvedValue({ language: "zpl", dpi: 203, pages: 2, data: Buffer.from("^XA^XZ\n^XA^XZ\n"), mime: "text/plain", filename: "lb.zpl" });
});
afterEach(async () => { vi.unstubAllEnvs(); await new Promise<void>((r) => server.close(() => r())); });

describe("POST /api/print", () => {
  it("renders the label and sends it to the named printer", async () => {
    const res = await call({ printer: "가짜", report: label, params: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ printer: "가짜", bytes: 14, pages: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(received).toString()).toBe("^XA^XZ\n^XA^XZ\n");
  });
  it("returns 400 for an unknown printer, a missing report, or a pdf report", async () => {
    expect((await call({ printer: "없음", report: label })).status).toBe(400);
    expect((await call({ printer: "가짜" })).status).toBe(400);
    expect((await call({ printer: "가짜", report: { ...label, output: { kind: "pdf" } } })).status).toBe(400);
    expect(renderLabel).not.toHaveBeenCalled();
  });
  it("returns 502 when the printer cannot be reached and never retries", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    server = net.createServer();   // afterEach가 닫을 수 있게 빈 서버로 바꿔 둔다 (listen 안 함)
    const res = await call({ printer: "가짜", report: label });
    expect(res.status).toBe(502);
    expect((await res.json()).printer).toBe("가짜");
    expect(renderLabel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter studio test -- printers label-route print-route`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 구현**

`apps/studio/src/lib/printers.ts`:
```ts
import net from "node:net";

export type Printer = { name: string; host: string; port: number };

/** DAPORT_PRINTERS="이름=host[:port],…" — 잘못된 항목은 버린다. 호스트는 응답에 넣지 않는다(라우트가 이름만 돌려준다) */
export function parsePrinters(value: string | undefined): Printer[] {
  const out: Printer[] = [];
  for (const entry of (value ?? "").split(",")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).trim(), addr = entry.slice(eq + 1).trim();
    if (!name || !addr) continue;
    const colon = addr.lastIndexOf(":");
    const host = colon >= 0 ? addr.slice(0, colon) : addr;
    const port = colon >= 0 ? Number(addr.slice(colon + 1)) : 9100;
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    out.push({ name, host, port });
  }
  return out;
}

/** raw TCP 전송. 연결·쓰기가 timeoutMs 안에 끝나지 않으면 거부한다. 재시도하지 않는다(중복 인쇄 방지) */
export function sendRaw(printer: Printer, data: Buffer, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: printer.host, port: printer.port });
    const fail = (e: Error) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new Error(`printer ${printer.name} timed out after ${timeoutMs}ms`)));
    sock.on("error", fail);
    sock.on("connect", () => {
      sock.end(data, () => { sock.destroy(); resolve(data.length); });
    });
  });
}
```

`apps/studio/src/app/api/printers/route.ts`:
```ts
import { NextResponse } from "next/server";
import { parsePrinters } from "@/lib/printers";
/** 허용 목록의 이름만. 호스트·포트는 노출하지 않는다 */
export function GET() { return NextResponse.json(parsePrinters(process.env.DAPORT_PRINTERS).map((p) => ({ name: p.name }))); }
```

`apps/studio/src/app/api/reports/[id]/label/route.ts`:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, ExpressionError, type Report, type DataContext } from "@daport/core";
import { LayoutLimitError, BarcodeError } from "@daport/renderer";
import { renderLabel, rasterizePages, bitmapToPng, LabelTooLargeError } from "@daport/label";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";

export const maxDuration = 60;
const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** 라벨 명령 다운로드 또는 ?preview=png 첫 라벨 비트맵. 본문·데이터·오류 규칙은 pdf 라우트와 같다 (스펙 7.3, 8) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  let report: Report | null;
  try { await ready(); report = body.report ? parseReport(body.report) : await getStore().get(id); }
  catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (report.output.kind !== "label") return NextResponse.json({ error: "레포트의 출력 종류가 라벨이 아닙니다" }, { status: 400 });

  let data: DataContext;
  try {
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    data = context;
  } catch (e) { return fail(e, 400); }

  try {
    const origin = new URL(req.url).origin;
    const resolved = resolveAssetUrls(report, origin);
    if (new URL(req.url).searchParams.get("preview") === "png") {
      const [first] = await rasterizePages(resolved, data, report.output.label.dpi, report.output.label.threshold);
      return new NextResponse(new Uint8Array(bitmapToPng(first)), { headers: { "content-type": "image/png" } });
    }
    const res = await renderLabel(resolved, data);
    return new NextResponse(new Uint8Array(res.data), { headers: { "content-type": res.mime, "content-disposition": `attachment; filename="${res.filename}"`, "x-daport-pages": String(res.pages) } });
  } catch (e) {
    if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, e instanceof ExpressionError || e instanceof BarcodeError ? 400 : 500);
  }
}
```

`apps/studio/src/app/api/print/route.ts`:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { LayoutLimitError } from "@daport/renderer";
import { renderLabel, LabelTooLargeError } from "@daport/label";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";
import { parsePrinters, sendRaw } from "@/lib/printers";

export const maxDuration = 60;
const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** 라벨을 렌더해 허용 목록의 프린터로 raw TCP 전송 (스펙 7.3). 재시도 없음 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const printer = parsePrinters(process.env.DAPORT_PRINTERS).find((p) => p.name === body.printer);
  if (!printer) return NextResponse.json({ error: "허용 목록에 없는 프린터입니다" }, { status: 400 });
  let report: Report | null;
  try {
    await ready();
    report = body.report ? parseReport(body.report) : typeof body.reportId === "string" ? await getStore().get(body.reportId) : null;
  } catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "report 또는 reportId가 필요합니다" }, { status: 400 });
  if (report.output.kind !== "label") return NextResponse.json({ error: "레포트의 출력 종류가 라벨이 아닙니다" }, { status: 400 });
  try {
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    const res = await renderLabel(resolveAssetUrls(report, new URL(req.url).origin), context);
    try {
      const bytes = await sendRaw(printer, res.data);
      return NextResponse.json({ printer: printer.name, bytes, pages: res.pages });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), printer: printer.name }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, 500);
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. `renderer`가 `BarcodeError`를 export하는지(T2) 확인.

- [ ] **Step 6: Commit**

```bash
git add apps/studio pnpm-lock.yaml
git commit -m "feat(studio): 라벨 다운로드·비트맵 미리보기 라우트, 프린터 허용 목록, raw TCP 전송 라우트"
```

---

## 웨이브 4

### Task 11: studio 툴바·미리보기·캔버스 통합

**Files:**
- Modify: `apps/studio/src/editor/Toolbar.tsx`, `apps/studio/src/editor/Preview.tsx`, `apps/studio/src/editor/canvas/Canvas.tsx`
- Test: `apps/studio/src/editor/__tests__/Toolbar.test.tsx`(추가), `apps/studio/src/editor/__tests__/Preview.test.tsx`(추가), `apps/studio/src/editor/canvas/__tests__/Canvas.phase2.test.tsx`(1개 추가)

**Interfaces:**
- Consumes: T7 `bitmapPreview`/`setBitmapPreview`, `report.output`; T10 라우트; 2단계 `requestBody`.
- Produces: 툴바 "라벨 다운로드"(`data-testid="label-download"`), 프린터 select(`aria-label="프린터"`)+"프린터로 보내기", "비트맵" 체크(`aria-label="비트맵"`); 미리보기 PNG(`data-testid="bitmap-preview"`); 캔버스 표식(`data-testid="label-badge"`).

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/Toolbar.test.tsx` 끝에 추가 (파일의 `setup()`은 `fetchMock`을 `vi.stubGlobal`로 넣는다 — 프린터 목록 요청은 `GET /api/printers`이므로 URL로 분기한다):
```tsx
describe("Toolbar label actions", () => {
  const labelReport = parseReport({ id: "r", name: "R", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } });

  it("hides label actions for a pdf report and shows download + bitmap toggle for a label report; printers only when listed", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/printers") ? [] : {}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pdfStore = createEditorStore(report);
    const { unmount } = render(<EditorContext.Provider value={pdfStore}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    expect(screen.queryByTestId("label-download")).toBeNull();
    unmount();
    const store = createEditorStore(labelReport);
    render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    expect(screen.getByTestId("label-download")).toBeTruthy();
    expect(screen.getByLabelText("비트맵")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/printers", expect.anything()));
    expect(screen.queryByLabelText("프린터")).toBeNull();
    fireEvent.click(screen.getByLabelText("비트맵"));
    expect(store.getState().bitmapPreview).toBe(true);
  });

  it("downloads the label from the label route with the sample body and sends to a listed printer", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/printers")) return new Response(JSON.stringify([{ name: "라인1" }]), { status: 200 });
      if (url.endsWith("/label")) return new Response("^XA^XZ", { status: 200, headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="r.zpl"' } });
      if (url.endsWith("/api/print")) return new Response(JSON.stringify({ printer: JSON.parse(String(init?.body)).printer, bytes: 6, pages: 1 }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const store = createEditorStore(labelReport);
    render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    fireEvent.click(screen.getByTestId("label-download"));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const labelCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/label"))!;
    expect(labelCall[0]).toBe("/api/reports/r/label");
    expect(JSON.parse(String(labelCall[1]?.body)).report.id).toBe("r");
    await waitFor(() => expect(screen.getByLabelText("프린터")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("프린터"), { target: { value: "라인1" } });
    fireEvent.click(screen.getByRole("button", { name: "프린터로 보내기" }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("라인1")));
    const printCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/print"))!;
    expect(JSON.parse(String(printCall[1]?.body))).toMatchObject({ printer: "라인1", report: { id: "r" } });
  });
});
```

`apps/studio/src/editor/__tests__/Preview.test.tsx` 끝에 추가:
```tsx
  it("shows the bitmap PNG instead of the iframe when bitmap preview is on for a label report", async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes("preview=png")
      ? new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } })
      : new Response("<p>html</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:png", revokeObjectURL: () => {} }));
    const store = createEditorStore(parseReport({ ...report, output: { kind: "label", label: { language: "zpl", dpi: 203 } } }));
    store.getState().setBitmapPreview(true);
    const { container, findByTestId } = render(<EditorContext.Provider value={store}><Preview reportId="r" /></EditorContext.Provider>);
    const img = await findByTestId("bitmap-preview");
    expect(img.getAttribute("src")).toBe("blob:png");
    expect(container.querySelector("iframe")).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/reports/r/label?preview=png");
  });
```

`apps/studio/src/editor/canvas/__tests__/Canvas.phase2.test.tsx` 끝에 추가:
```tsx
describe("Canvas label badge", () => {
  it("shows the label language and dpi for a label report only", () => {
    const store = createEditorStore(parseReport({ id: "l", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "tspl", dpi: 300 } } }));
    const { q } = mount(store);
    expect(q('[data-testid="label-badge"]')?.textContent).toBe("라벨 · TSPL · 300dpi");
    cleanup();
    expect(mount(createEditorStore(report)).q('[data-testid="label-badge"]')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- Toolbar Preview Canvas.phase2`
Expected: FAIL.

- [ ] **Step 3: Toolbar.tsx 수정**

`apps/studio/src/editor/Toolbar.tsx`에 상태·효과·핸들러를 더한다:
```tsx
  const bitmapPreview = useEditor((s) => s.bitmapPreview);
  const setBitmapPreview = useEditor((s) => s.setBitmapPreview);
  const isLabel = report.output.kind === "label";
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // 허용 목록이 비어 있으면 전송 UI를 두지 않는다 (스펙 7.3)
    fetch("/api/printers", { method: "GET" }).then((r) => (r.ok ? r.json() : [])).then((list: { name: string }[]) => { setPrinters(list.map((p) => p.name)); setPrinter(list[0]?.name ?? ""); }).catch(() => setPrinters([]));
  }, []);

  /** 응답을 파일로 내려받는다 (PDF·라벨 공용). 파일 이름은 content-disposition, 없으면 fallback */
  const download = async (r: Response, fallback: string) => {
    const cd = r.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallback;
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const label = async () => {
    setExporting(true);
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(reportId)}/label`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody(report, liveData)) });
      if (!r.ok) { alert(await failureMessage(r, "라벨")); return; }
      await download(r, `${report.id}.zpl`);
    } catch (e) { alert(`라벨 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setExporting(false); }
  };
  const print = async () => {
    setPrinting(true);
    try {
      const r = await fetch("/api/print", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ printer, ...requestBody(report, liveData) }) });
      if (!r.ok) { alert(await failureMessage(r, "인쇄")); return; }
      const res = (await r.json()) as { printer: string; bytes: number; pages: number };
      alert(`${res.printer}로 ${res.pages}장(${res.bytes} bytes) 보냈습니다`);
    } catch (e) { alert(`인쇄 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setPrinting(false); }
  };
```
`pdf` 핸들러의 다운로드 부분을 `await download(r, `${report.name || report.id}.pdf`)`로 바꾼다(동작 동일). JSX의 `<div className="flex-1" />` 다음, PDF 버튼 앞에:
```tsx
      {isLabel && <>
        <label className="text-xs flex items-center gap-1"><input type="checkbox" aria-label="비트맵" checked={bitmapPreview} onChange={(e) => setBitmapPreview(e.target.checked)} />비트맵</label>
        {printers.length > 0 && <>
          <select aria-label="프린터" className="text-xs border rounded px-1 py-1" value={printer} onChange={(e) => setPrinter(e.target.value)}>{printers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <button className={btn} disabled={printing || !printer} onClick={print}>프린터로 보내기</button>
        </>}
        <button className={btn} disabled={exporting} onClick={label} data-testid="label-download">라벨 다운로드</button>
      </>}
```
import에 `useEffect`를 더한다. 기존 Toolbar 테스트의 `setup()`이 쓰는 `fetchMock`은 모든 URL에 `{}`를 돌려주므로 `/api/printers` 응답이 배열이 아니다 — `list.map`이 던지지 않게 `Array.isArray(list) ? list : []`로 감싼다.

- [ ] **Step 4: Preview.tsx·Canvas.tsx 수정**

`apps/studio/src/editor/Preview.tsx`: `bitmapPreview`를 읽고, `report.output.kind === "label" && bitmapPreview`이면 `/api/reports/:id/label?preview=png`에 같은 본문으로 POST해 blob URL을 `<img data-testid="bitmap-preview" alt="라벨 비트맵" className="bg-white shadow" />`로 보인다(이전 URL은 `revokeObjectURL`). 그 밖은 기존 iframe 흐름. effect 의존성에 `bitmapPreview` 추가; 오류는 기존 오류 div로.

`apps/studio/src/editor/canvas/Canvas.tsx`: 반환 JSX 오버레이 안, 템플릿 점선 앞에
```tsx
        {report.output.kind === "label" && (
          <div data-testid="label-badge" className="absolute right-2 top-2 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-white">{`라벨 · ${report.output.label.language.toUpperCase()} · ${report.output.label.dpi}dpi`}</div>
        )}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS(기존 Toolbar·Preview·Canvas 테스트 포함).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/editor
git commit -m "feat(studio): 라벨 다운로드·프린터 전송·비트맵 미리보기 툴바, 캔버스 라벨 표식"
```

---

### Task 12: 예제 시드와 3단계 E2E

**Files:**
- Modify: `apps/studio/src/lib/report-store.ts` (`SEED_FIXTURES`에 라벨 예제 2종)
- Create: `apps/studio/e2e/phase3.spec.ts`

**Interfaces:**
- Consumes: T5 fixtures; T7·T8·T10·T11 UI와 라우트.
- Produces: 스펙 9장 E2E, 완료 기준 3·5.

- [ ] **Step 1: 시드**

`apps/studio/src/lib/report-store.ts`에 `coil-tag.report.json`·`product-label.report.json` import를 더하고 `SEED_FIXTURES`에 넣는다(순서: 기존 5종 뒤). `report-store.test.ts`의 "seeds all five example fixtures" 테스트가 개수를 고정했다면 7로 고친다.

- [ ] **Step 2: E2E 작성**

`apps/studio/e2e/phase3.spec.ts`:
```ts
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID").fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}
const mmToPx = (mm: number) => Math.round((mm / 25.4) * 96);

test("seeded product label: barcode renders, ZPL and TSPL downloads, bitmap preview", async ({ page }) => {
  await page.goto("/reports/product-label");
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-element-id="bc"] svg').first()).toBeVisible();
  await expect(page.getByTestId("label-badge")).toHaveText("라벨 · ZPL · 203dpi");

  const [zpl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("label-download").click()]);
  expect(zpl.suggestedFilename()).toBe("product-label.zpl");
  const zplText = readFileSync(await zpl.path(), "latin1");
  expect(zplText.startsWith("^XA")).toBe(true);
  expect(zplText).toContain("^GFA,");
  expect(zplText.match(/\^XA/g)?.length).toBe(2);                              // 샘플 2건 → 라벨 2장

  await page.getByLabel("언어").selectOption("tspl");
  const [prn] = await Promise.all([page.waitForEvent("download"), page.getByTestId("label-download").click()]);
  expect(prn.suggestedFilename()).toBe("product-label.prn");
  expect(readFileSync(await prn.path(), "latin1").startsWith("SIZE 60 mm,40 mm")).toBe(true);

  // 비트맵 미리보기: 이진화 PNG가 미리보기 자리에 뜬다
  await page.getByLabel("비트맵").check();
  await page.getByRole("button", { name: "미리보기" }).click();
  await expect(page.getByTestId("bitmap-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("프린터")).toHaveCount(0);                     // DAPORT_PRINTERS 없음 → 전송 UI 없음
});

test("presets: apply a builtin label preset, save a custom preset, reuse it in a new report", async ({ page }) => {
  const id = `e2e-preset-${Date.now()}`;
  await createReport(page, id);
  await page.getByLabel("프리셋").selectOption("coil-tag-100x150");
  const width = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
  expect(Math.round(parseFloat(width))).toBe(mmToPx(100));
  await expect(page.getByTestId("label-badge")).toHaveText("라벨 · ZPL · 203dpi");

  await page.getByLabel("너비(mm)").fill("80");
  await page.getByText("현재 설정을 프리셋으로 저장").click();
  const presetId = `p-${Date.now()}`;
  await page.getByLabel("새 프리셋 id").fill(presetId);
  await page.getByLabel("새 프리셋 이름").fill("E2E 80×150");
  await page.getByRole("button", { name: "프리셋으로 저장" }).click();
  await expect(page.getByRole("option", { name: "E2E 80×150" })).toBeAttached();

  const id2 = `e2e-preset2-${Date.now()}`;
  await createReport(page, id2);
  await page.getByLabel("프리셋").selectOption(presetId);
  await expect(page.getByTestId("label-badge")).toHaveText("라벨 · ZPL · 203dpi");
  const w2 = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
  expect(Math.round(parseFloat(w2))).toBe(mmToPx(80));
  await page.getByRole("button", { name: "프리셋 삭제" }).click();
  await expect(page.getByRole("option", { name: "E2E 80×150" })).toHaveCount(0);
});

test("palette barcode: added element shows an svg and property changes re-render it", async ({ page }) => {
  const id = `e2e-bc-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "+ 바코드", exact: true }).click();
  const bc = page.getByTestId("canvas").locator('[data-element-id="barcode-1"]');
  await expect(bc.locator("svg")).toBeVisible();
  await page.getByLabel("형식").selectOption("qr");
  await expect(bc.locator('svg[preserveAspectRatio="xMidYMid meet"]')).toBeVisible();
  await page.getByLabel("값").fill("");
  await expect(bc).toHaveClass(/dp-err/);                                      // 빈 값은 그 요소만 #ERR
});
```

- [ ] **Step 3: 실행**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter studio e2e` (dev 서버가 이미 떠 있으면 시드가 바뀌었으니 재시작), 그 다음 루트 `pnpm typecheck && pnpm test`.
Expected: 단위 PASS, E2E 1·2단계 6개 + 3단계 3개 PASS, 루트 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/studio
git commit -m "test(studio): 라벨 예제 시드, 3단계 E2E — 바코드·라벨 다운로드·비트맵 미리보기·프리셋"
```

---

## 완료 기준 대응표 (스펙 10장)

| 완료 기준 | 검증하는 태스크 |
|---|---|
| 1. 6종 예제 존재, 골든·픽셀 비교 통과 | T5 골든, T9 라벨 vs PDF 픽셀 비교, T12 시드(문서 4종은 2단계) |
| 2. 바코드 5종이 HTML·PDF·라벨 비트맵에서 동일 | T2 골든(SVG), T9 비교(같은 SVG를 두 경로로 래스터) |
| 3. ZPL·TSPL 다운로드, repeat N건 → N장 | T4 인코더, T9 renderLabel(3 블록), T10 라우트, T12 E2E |
| 4. 허용 목록 프린터 raw TCP 전송, 목록 없으면 버튼 없음 | T10 print 라우트(가짜 서버), T11 툴바, T12 E2E |
| 5. 프리셋 저장·선택·삭제 | T6 저장소·API, T7 패널, T12 E2E |
| 6. pdf 테스트가 browser 분리 후 통과 | T3 |

## 웨이브 병합 절차

2단계 플랜과 같다: 레인마다 브랜치(또는 순차 실행), 웨이브가 끝나면 통합 브랜치(`feature/phase3`)에 병합하고 루트에서 `pnpm install && pnpm typecheck && pnpm test`. 웨이브 4 뒤 `pnpm --filter studio e2e`.
