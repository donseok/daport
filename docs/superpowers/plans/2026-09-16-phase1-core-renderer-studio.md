# daport 1단계 구현 플랜: core + renderer + pdf + 최소 studio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 품질보증서 한 장을 studio 캔버스와 JSON 편집기로 양방향 편집하고, 브라우저 미리보기와 PDF가 동일하게 나오는 최소 동작 시스템을 만든다.

**Architecture:** pnpm 모노레포. `core`(zod 스키마, 표현식, static 데이터셋)는 의존성 없음. `renderer`는 `(모델, 데이터) → Page[]` 순수 레이아웃과 React 페인트로 나뉘며 텍스트 측정은 미리 생성한 폰트 메트릭 JSON으로 한다. `pdf`는 렌더러 HTML을 Playwright로 인쇄한다. `studio`(Next.js)는 zustand + JSON Patch 히스토리로 캔버스와 Monaco를 같은 모델에 묶는다.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, zod 4, jexl, fast-json-patch, React 19, Next.js 16 App Router, zustand 5, @monaco-editor/react, Tailwind 4, drizzle-orm + @neondatabase/serverless, @vercel/blob, Playwright, opentype.js(메트릭 생성 스크립트 전용), pdf-lib·pdf-to-img·pixelmatch(테스트 전용).

스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` 13장.

---

## 파일 구조

```
package.json                     루트. workspaces 스크립트
pnpm-workspace.yaml
tsconfig.base.json
vitest.workspace.ts
packages/core/
  package.json
  src/index.ts                   공개 API 재export
  src/units.ts                   mm/pt/px 변환
  src/schema/style.ts            StyleSchema
  src/schema/elements.ts         요소 zod 스키마 (discriminatedUnion)
  src/schema/report.ts           ReportSchema, PageSchema, DatasetSchema, ParamSchema
  src/schema/json-schema.ts      zod → JSON Schema (Monaco용)
  src/expression/engine.ts       jexl 인스턴스, 등록 함수, evaluate()
  src/expression/template.ts     "{{ }}" 보간 interpolate()
  src/data/resolve.ts            resolveData(model, params) → DataContext (static만)
  src/__tests__/*.test.ts
packages/renderer/
  package.json
  fonts/Pretendard-Regular.otf   동봉 폰트 (SIL OFL)
  fonts/Pretendard-Bold.otf
  scripts/gen-metrics.ts         opentype.js로 metrics.json 생성
  src/metrics.json               생성 결과 (커밋)
  src/index.ts
  src/text/measure.ts            measureText(), wrapText()
  src/layout/types.ts            Page, PlacedItem
  src/layout/layout.ts           layout(model, data): Page[]
  src/layout/flatten.ts          group → 절대좌표 평탄화
  src/paint/Paint.tsx            <PaintPages pages /> React 컴포넌트
  src/paint/css.ts               페이지 CSS, @page, @font-face
  src/html.ts                    renderToHtml(model, data, {fontBaseUrl})
  src/__tests__/*.test.ts
  src/__tests__/fixtures/quality-cert.report.json
  src/__tests__/__snapshots__/  골든 스냅샷
packages/pdf/
  package.json
  src/index.ts                   renderPdf(model, data): Promise<Buffer>
  src/pool.ts                    Chromium 브라우저 풀
  src/__tests__/pdf.test.ts
apps/studio/
  package.json
  next.config.ts
  drizzle.config.ts
  src/db/schema.ts               reports 테이블
  src/db/client.ts
  src/app/layout.tsx
  src/app/page.tsx               레포트 목록
  src/app/reports/[id]/page.tsx  에디터 진입
  src/app/api/reports/route.ts           GET 목록, POST 생성
  src/app/api/reports/[id]/route.ts      GET, PUT
  src/app/api/reports/[id]/pdf/route.ts  POST PDF
  src/app/api/assets/route.ts            POST 업로드 (Vercel Blob)
  src/editor/store.ts            zustand: model, selection, history(JSON Patch)
  src/editor/history.ts          applyPatch/undo/redo 순수 함수
  src/editor/Editor.tsx          3단 레이아웃 조립
  src/editor/canvas/Canvas.tsx   페이지 + 오버레이
  src/editor/canvas/useDrag.ts   드래그/리사이즈 포인터 핸들러, 스냅
  src/editor/canvas/SelectionBox.tsx
  src/editor/panels/ElementPalette.tsx
  src/editor/panels/PropertyPanel.tsx
  src/editor/panels/PagePanel.tsx
  src/editor/json/JsonEditor.tsx Monaco + 양방향 동기화
  src/editor/Preview.tsx
  src/editor/useKeyboard.ts      단축키
  src/lib/fonts.ts               폰트 URL
  public/fonts/                  renderer 폰트 심볼릭 복사
  e2e/editor.spec.ts             Playwright E2E
```

---

### Task 1: 모노레포 골격

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, `.npmrc`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`

- [ ] **Step 1: 루트 파일 작성**

`package.json`:
```json
{
  "name": "daport",
  "private": true,
  "packageManager": "pnpm@10.12.1",
  "scripts": {
    "build": "pnpm -r --filter './packages/*' build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r typecheck",
    "dev": "pnpm --filter studio dev"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.2.0",
    "@types/node": "^24.0.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`.npmrc`:
```
auto-install-peers=true
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "jsx": "react-jsx",
    "isolatedModules": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ["packages/*", "apps/*"];
```

`.gitignore`:
```
node_modules
dist
.next
.env*
!.env.example
test-results
playwright-report
```

- [ ] **Step 2: core 패키지 골격**

`packages/core/package.json`:
```json
{
  "name": "@daport/core",
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
    "zod": "^4.0.0",
    "jexl": "^2.3.0"
  },
  "devDependencies": {
    "@types/jexl": "^2.3.4"
  }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/src/index.ts`:
```ts
export const VERSION = "0.0.1";
```

패키지는 빌드 없이 소스(`src/index.ts`)를 직접 export 한다. 모노레포 내부 소비자(studio, Next.js)가 `transpilePackages`로 처리한다. 외부 배포는 4단계에서 다룬다.

- [ ] **Step 3: 설치 및 확인**

Run: `pnpm install && pnpm typecheck`
Expected: 오류 없이 종료.

- [ ] **Step 4: 스모크 테스트**

`packages/core/src/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { VERSION } from "../index";

describe("core", () => {
  it("exports version", () => expect(VERSION).toBe("0.0.1"));
});
```

Run: `pnpm test`
Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: pnpm 모노레포 골격과 core 패키지"
```

---

### Task 2: core 단위 변환과 스타일 스키마

**Files:**
- Create: `packages/core/src/units.ts`, `packages/core/src/schema/style.ts`
- Test: `packages/core/src/__tests__/units.test.ts`, `packages/core/src/__tests__/style.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/units.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toMm, mmToPx, mmToPt } from "../units";

describe("units", () => {
  it("converts pt and px to mm", () => {
    expect(toMm(72, "pt")).toBeCloseTo(25.4, 5);
    expect(toMm(96, "px")).toBeCloseTo(25.4, 5);
    expect(toMm(10, "mm")).toBe(10);
  });
  it("converts mm to px at 96dpi and to pt", () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 5);
    expect(mmToPt(25.4)).toBeCloseTo(72, 5);
  });
});
```

`packages/core/src/__tests__/style.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { StyleSchema } from "../schema/style";

describe("StyleSchema", () => {
  it("applies defaults", () => {
    const s = StyleSchema.parse({});
    expect(s.fontSize).toBe(10);
    expect(s.align).toBe("left");
    expect(s.wrap).toBe(true);
  });
  it("rejects unknown align", () => {
    expect(() => StyleSchema.parse({ align: "middle" })).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test`
Expected: FAIL, 모듈 없음.

- [ ] **Step 3: 구현**

`packages/core/src/units.ts`:
```ts
export type Unit = "mm" | "pt" | "px";
const PT_PER_INCH = 72;
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

export function toMm(value: number, unit: Unit): number {
  if (unit === "mm") return value;
  if (unit === "pt") return (value / PT_PER_INCH) * MM_PER_INCH;
  return (value / PX_PER_INCH) * MM_PER_INCH;
}
export function mmToPx(mm: number): number { return (mm / MM_PER_INCH) * PX_PER_INCH; }
export function mmToPt(mm: number): number { return (mm / MM_PER_INCH) * PT_PER_INCH; }
export function ptToMm(pt: number): number { return toMm(pt, "pt"); }
```

`packages/core/src/schema/style.ts`:
```ts
import { z } from "zod";

export const StyleSchema = z.object({
  fontFamily: z.enum(["Pretendard"]).default("Pretendard"),
  fontSize: z.number().positive().default(10),     // pt
  bold: z.boolean().default(false),
  color: z.string().default("#000000"),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  wrap: z.boolean().default(true),
  lineHeight: z.number().positive().default(1.3),  // 배수
  stroke: z.string().optional(),                   // 선/테두리 색
  strokeWidth: z.number().nonnegative().default(0.2), // mm
  fill: z.string().optional(),
  radius: z.number().nonnegative().default(0),     // mm
  padding: z.number().nonnegative().default(0),    // mm
});
export type Style = z.infer<typeof StyleSchema>;
export type StyleInput = z.input<typeof StyleSchema>;
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): 단위 변환과 StyleSchema"
```

---

### Task 3: core 요소·레포트 스키마

**Files:**
- Create: `packages/core/src/schema/elements.ts`, `packages/core/src/schema/report.ts`, `packages/core/src/schema/json-schema.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ReportSchema, parseReport } from "../schema/report";
import { reportJsonSchema } from "../schema/json-schema";

const base = {
  id: "r1", version: 1,
  page: { width: 210, height: 297, margin: [10, 10, 10, 10] },
  datasets: [], params: [], elements: [],
};

describe("ReportSchema", () => {
  it("parses minimal report with defaults", () => {
    const r = parseReport(base);
    expect(r.page.unit).toBe("mm");
    expect(r.elements).toEqual([]);
  });
  it("parses text element and fills style defaults", () => {
    const r = parseReport({ ...base, elements: [
      { id: "t1", type: "text", x: 1, y: 2, w: 50, h: 8, value: "hi" },
    ]});
    const el = r.elements[0];
    expect(el.type).toBe("text");
    if (el.type === "text") expect(el.style.fontSize).toBe(10);
    expect(el.flow).toBe("once");
  });
  it("parses nested group", () => {
    const r = parseReport({ ...base, elements: [
      { id: "g", type: "group", x: 0, y: 0, w: 100, h: 20, children: [
        { id: "l", type: "line", x: 0, y: 0, w: 100, h: 0, x2: 100, y2: 0 },
      ]},
    ]});
    expect(r.elements[0].type).toBe("group");
  });
  it("accepts table/barcode/ref/pageNumber types (declared only)", () => {
    const r = parseReport({ ...base, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "qr", value: "{{ params.lot }}" },
      { id: "p", type: "pageNumber", x: 0, y: 280, w: 40, h: 5 },
      { id: "c", type: "ref", x: 0, y: 0, w: 40, h: 5, ref: "hdr" },
      { id: "t", type: "table", x: 0, y: 0, w: 100, h: 100, source: "items", columns: [] },
    ]});
    expect(r.elements).toHaveLength(4);
  });
  it("rejects duplicate element ids", () => {
    expect(() => parseReport({ ...base, elements: [
      { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 },
    ]})).toThrow(/duplicate/i);
  });
  it("rejects unknown element type", () => {
    expect(() => ReportSchema.parse({ ...base, elements: [{ id: "x", type: "chart", x: 0, y: 0, w: 1, h: 1 }] })).toThrow();
  });
  it("exports a JSON schema with elements definition", () => {
    const js = reportJsonSchema() as any;
    expect(js.type).toBe("object");
    expect(js.properties.elements).toBeDefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test`
Expected: FAIL, 모듈 없음.

- [ ] **Step 3: 요소 스키마 구현**

`packages/core/src/schema/elements.ts`:
```ts
import { z } from "zod";
import { StyleSchema } from "./style";

const Base = z.object({
  id: z.string().min(1),
  x: z.number(), y: z.number(),
  w: z.number().nonnegative(), h: z.number().nonnegative(),
  visible: z.string().optional(),               // 표현식. 미지정이면 항상 표시
  flow: z.enum(["once", "every", "last"]).default("once"),
  style: StyleSchema.default({}),
});

export const TextElementSchema = Base.extend({
  type: z.literal("text"),
  value: z.string().default(""),
});
export const ImageElementSchema = Base.extend({
  type: z.literal("image"),
  src: z.string().default(""),                  // asset://id | http(s) URL | 표현식
  fit: z.enum(["contain", "cover", "stretch"]).default("contain"),
});
export const LineElementSchema = Base.extend({
  type: z.literal("line"),
  x2: z.number(), y2: z.number(),               // 절대 mm (그룹 안이면 그룹 상대)
});
export const RectElementSchema = Base.extend({ type: z.literal("rect") });

export const BarcodeElementSchema = Base.extend({
  type: z.literal("barcode"),
  format: z.enum(["code128", "ean13", "qr"]),
  value: z.string().default(""),
  showText: z.boolean().default(true),
});
export const PageNumberElementSchema = Base.extend({
  type: z.literal("pageNumber"),
  format: z.string().default("{{ page }} / {{ total }}"),
});
export const RefElementSchema = Base.extend({
  type: z.literal("ref"),
  ref: z.string().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});
export const TableColumnSchema = z.object({
  header: z.string().default(""),
  value: z.string().default(""),
  w: z.number().positive(),
  style: StyleSchema.default({}),
});
export const TableElementSchema = Base.extend({
  type: z.literal("table"),
  source: z.string().min(1),
  columns: z.array(TableColumnSchema),
  repeatHeader: z.boolean().default(true),
  overflow: z.enum(["continue", "clip"]).default("continue"),
  keepTogether: z.enum(["none", "row"]).default("row"),
  rowHeight: z.number().positive().default(6),
  headerHeight: z.number().positive().default(7),
});

type LeafElement =
  | z.infer<typeof TextElementSchema> | z.infer<typeof ImageElementSchema>
  | z.infer<typeof LineElementSchema> | z.infer<typeof RectElementSchema>
  | z.infer<typeof BarcodeElementSchema> | z.infer<typeof PageNumberElementSchema>
  | z.infer<typeof RefElementSchema> | z.infer<typeof TableElementSchema>;
export type GroupElement = z.infer<typeof Base> & { type: "group"; children: Element[] };
export type Element = LeafElement | GroupElement;

export const GroupElementSchema: z.ZodType<GroupElement> = Base.extend({
  type: z.literal("group"),
  children: z.lazy(() => z.array(ElementSchema)),
}) as unknown as z.ZodType<GroupElement>;

export const ElementSchema: z.ZodType<Element> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TextElementSchema, ImageElementSchema, LineElementSchema, RectElementSchema,
    BarcodeElementSchema, PageNumberElementSchema, RefElementSchema, TableElementSchema,
    GroupElementSchema as any,
  ])
) as unknown as z.ZodType<Element>;

export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type LineElement = z.infer<typeof LineElementSchema>;
export type RectElement = z.infer<typeof RectElementSchema>;
export type ElementType = Element["type"];
```

- [ ] **Step 4: 레포트 스키마와 JSON Schema 구현**

`packages/core/src/schema/report.ts`:
```ts
import { z } from "zod";
import { ElementSchema, type Element } from "./elements";

export const PageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  margin: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([10, 10, 10, 10]), // top,right,bottom,left
  unit: z.literal("mm").default("mm"),
});

export const DatasetSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string().min(1), type: z.literal("static"), rows: z.array(z.record(z.string(), z.unknown())) }),
  z.object({ name: z.string().min(1), type: z.literal("sql"), connection: z.string(), query: z.string() }),
  z.object({ name: z.string().min(1), type: z.literal("http"), url: z.string(), method: z.enum(["GET", "POST"]).default("GET") }),
]);

export const ParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "date"]).default("string"),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export const ReportSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  version: z.number().int().nonnegative().default(1),
  page: PageSchema,
  datasets: z.array(DatasetSchema).default([]),
  params: z.array(ParamSchema).default([]),
  elements: z.array(ElementSchema).default([]),
  onExpressionError: z.enum(["blank", "fail"]).default("blank"),
}).superRefine((r, ctx) => {
  const seen = new Set<string>();
  const walk = (els: Element[], path: (string | number)[]) => {
    els.forEach((el, i) => {
      if (seen.has(el.id)) ctx.addIssue({ code: "custom", message: `duplicate element id: ${el.id}`, path: [...path, i, "id"] });
      seen.add(el.id);
      if (el.type === "group") walk(el.children, [...path, i, "children"]);
    });
  };
  walk(r.elements, ["elements"]);
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportInput = z.input<typeof ReportSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type Param = z.infer<typeof ParamSchema>;

export function parseReport(input: unknown): Report { return ReportSchema.parse(input); }
export function safeParseReport(input: unknown) { return ReportSchema.safeParse(input); }
```

`packages/core/src/schema/json-schema.ts`:
```ts
import { z } from "zod";
import { ReportSchema } from "./report";

export function reportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ReportSchema, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
```

`packages/core/src/index.ts`:
```ts
export const VERSION = "0.0.1";
export * from "./units";
export * from "./schema/style";
export * from "./schema/elements";
export * from "./schema/report";
export * from "./schema/json-schema";
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/core test`
Expected: 모두 통과. 재귀 스키마에서 zod가 오류를 내면 `GroupElementSchema` 캐스팅을 `z.ZodType<GroupElement>`로 유지한 채 `ElementSchema`를 `z.lazy` 없이 정의하고 `GroupElementSchema` 안의 `children`만 lazy로 둔다.

- [ ] **Step 6: Commit**

```bash
git add packages/core && git commit -m "feat(core): 요소·레포트 zod 스키마와 JSON Schema 내보내기"
```

---

### Task 4: core 표현식 엔진과 템플릿 보간

**Files:**
- Create: `packages/core/src/expression/engine.ts`, `packages/core/src/expression/template.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/expression.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/expression.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluate, ExpressionError } from "../expression/engine";
import { interpolate, hasTemplate } from "../expression/template";

const ctx = {
  params: { orderNo: "A-1" },
  order: { CUSTOMER_NAME: "ACME", QTY: 3, PRICE: 1000, DT: new Date("2026-09-16T00:00:00Z") },
  items: [{ QTY: 1 }, { QTY: 2 }],
};

describe("evaluate", () => {
  it("reads fields and does math", () => {
    expect(evaluate("order.QTY * order.PRICE", ctx)).toBe(3000);
    expect(evaluate("params.orderNo", ctx)).toBe("A-1");
  });
  it("supports ternary and comparison", () => {
    expect(evaluate("order.QTY > 2 ? 'many' : 'few'", ctx)).toBe("many");
  });
  it("runs registered functions", () => {
    expect(evaluate("sum(items, 'QTY')", ctx)).toBe(3);
    expect(evaluate("count(items)", ctx)).toBe(2);
    expect(evaluate("formatNumber(1234567.891, '#,##0.00')", ctx)).toBe("1,234,567.89");
    expect(evaluate("formatDate(order.DT, 'yyyy-MM-dd')", ctx)).toBe("2026-09-16");
    expect(evaluate("pad(7, 3, '0')", ctx)).toBe("007");
    expect(evaluate("upper('ab')", ctx)).toBe("AB");
    expect(evaluate("default(order.MISSING, '-')", ctx)).toBe("-");
  });
  it("blocks prototype and global access", () => {
    expect(() => evaluate("order.constructor", ctx)).toThrow(ExpressionError);
    expect(() => evaluate("order.__proto__", ctx)).toThrow(ExpressionError);
    expect(() => evaluate("globalThis", ctx)).toThrow(ExpressionError);
  });
  it("wraps syntax errors", () => {
    expect(() => evaluate("order.", ctx)).toThrow(ExpressionError);
  });
});

describe("interpolate", () => {
  it("replaces all {{ }} segments", () => {
    expect(interpolate("고객: {{ order.CUSTOMER_NAME }} / {{ order.QTY }}개", ctx)).toBe("고객: ACME / 3개");
  });
  it("returns plain string unchanged", () => {
    expect(interpolate("no template", ctx)).toBe("no template");
    expect(hasTemplate("no template")).toBe(false);
    expect(hasTemplate("{{ a }}")).toBe(true);
  });
  it("renders null/undefined as empty", () => {
    expect(interpolate("[{{ order.MISSING }}]", ctx)).toBe("[]");
  });
  it("throws ExpressionError on bad segment", () => {
    expect(() => interpolate("{{ order. }}", ctx)).toThrow(ExpressionError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test`
Expected: FAIL, 모듈 없음.

- [ ] **Step 3: 엔진 구현**

`packages/core/src/expression/engine.ts`:
```ts
import { Jexl } from "jexl";

export class ExpressionError extends Error {
  constructor(public expression: string, cause: unknown) {
    super(`Expression error in "${expression}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ExpressionError";
  }
}

export type DataContext = Record<string, unknown>;

const FORBIDDEN = /(^|[^\w])(constructor|__proto__|prototype|globalThis|window|process|require|eval|Function)([^\w]|$)/;

function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function formatNumber(value: unknown, pattern = "#,##0"): string {
  const n = toNumber(value);
  const dec = pattern.includes(".") ? pattern.split(".")[1].length : 0;
  const grouped = pattern.includes(",");
  const fixed = n.toFixed(dec);
  if (!grouped) return fixed;
  const [int, frac] = fixed.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + withCommas + (frac !== undefined ? "." + frac : "");
}

export function formatDate(value: unknown, pattern = "yyyy-MM-dd"): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return pattern
    .replace(/yyyy/g, String(d.getUTCFullYear()))
    .replace(/MM/g, p(d.getUTCMonth() + 1))
    .replace(/dd/g, p(d.getUTCDate()))
    .replace(/HH/g, p(d.getUTCHours()))
    .replace(/mm/g, p(d.getUTCMinutes()))
    .replace(/ss/g, p(d.getUTCSeconds()));
}

function createJexl(): Jexl {
  const j = new Jexl();
  j.addFunction("sum", (rows: unknown, field: string) =>
    Array.isArray(rows) ? rows.reduce((a, r) => a + toNumber((r as Record<string, unknown>)?.[field]), 0) : 0);
  j.addFunction("count", (rows: unknown) => (Array.isArray(rows) ? rows.length : 0));
  j.addFunction("formatNumber", formatNumber);
  j.addFunction("formatDate", formatDate);
  j.addFunction("pad", (v: unknown, len: number, ch = " ") => String(v ?? "").padStart(len, ch));
  j.addFunction("upper", (v: unknown) => String(v ?? "").toUpperCase());
  j.addFunction("lower", (v: unknown) => String(v ?? "").toLowerCase());
  j.addFunction("default", (v: unknown, fb: unknown) => (v === null || v === undefined || v === "" ? fb : v));
  return j;
}

const jexl = createJexl();

export function evaluate(expression: string, context: DataContext): unknown {
  if (FORBIDDEN.test(expression)) throw new ExpressionError(expression, "forbidden identifier");
  try {
    return jexl.evalSync(expression, context);
  } catch (e) {
    throw new ExpressionError(expression, e);
  }
}
```

`packages/core/src/expression/template.ts`:
```ts
import { evaluate, type DataContext } from "./engine";

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export function hasTemplate(s: string): boolean { return /\{\{[\s\S]+?\}\}/.test(s); }

export function interpolate(template: string, context: DataContext): string {
  if (!hasTemplate(template)) return template;
  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const v = evaluate(expr, context);
    return v === null || v === undefined ? "" : String(v);
  });
}

/** 전체가 하나의 {{ }}이면 문자열화하지 않고 원래 타입을 돌려준다 (visible 조건 등에 사용) */
export function evaluateTemplateValue(template: string, context: DataContext): unknown {
  const m = template.trim().match(/^\{\{\s*([\s\S]+?)\s*\}\}$/);
  if (m) return evaluate(m[1], context);
  return hasTemplate(template) ? interpolate(template, context) : template;
}
```

`packages/core/src/index.ts`에 추가:
```ts
export * from "./expression/engine";
export * from "./expression/template";
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test`
Expected: 모두 통과. jexl에서 `order.`가 예외가 아니라 undefined를 돌려주면 `evaluate` 앞에 `jexl.compile(expression)`을 호출해 구문 오류를 강제로 발생시킨다.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): jexl 표현식 엔진, 등록 함수, 템플릿 보간"
```

---

### Task 5: core static 데이터셋 해석

**Files:**
- Create: `packages/core/src/data/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/resolve.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/resolve.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "../schema/report";
import { resolveData } from "../data/resolve";

const report = parseReport({
  id: "r", version: 1, page: { width: 100, height: 100 },
  params: [{ name: "orderNo", type: "string", required: true }, { name: "copies", type: "number", default: 1 }],
  datasets: [
    { name: "order", type: "static", rows: [{ CUSTOMER_NAME: "ACME" }] },
    { name: "items", type: "static", rows: [{ QTY: 1 }, { QTY: 2 }] },
    { name: "empty", type: "static", rows: [] },
  ],
});

describe("resolveData", () => {
  it("exposes params, first row as object, and rows array", async () => {
    const ctx = await resolveData(report, { orderNo: "A" });
    expect(ctx.params).toEqual({ orderNo: "A", copies: 1 });
    expect((ctx.order as any).CUSTOMER_NAME).toBe("ACME");
    expect(ctx.items).toHaveLength(2);
    expect((ctx.items as any).QTY).toBe(1);   // 배열이지만 첫 행 필드도 접근 가능
    expect(ctx.empty).toEqual([]);
  });
  it("throws when required param missing", async () => {
    await expect(resolveData(report, {})).rejects.toThrow(/orderNo/);
  });
  it("rejects sql/http datasets in phase 1", async () => {
    const r = parseReport({ id: "x", version: 1, page: { width: 1, height: 1 },
      datasets: [{ name: "d", type: "sql", connection: "mes", query: "select 1" }] });
    await expect(resolveData(r, {})).rejects.toThrow(/not supported/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test`
Expected: FAIL.

- [ ] **Step 3: 구현**

`packages/core/src/data/resolve.ts`:
```ts
import type { Report } from "../schema/report";
import type { DataContext } from "../expression/engine";

export type Params = Record<string, unknown>;

/** 행 배열에 첫 행의 필드를 얹어 `ds.FIELD`와 `ds[0].FIELD` 둘 다 되게 한다 */
export function rowsProxy(rows: Record<string, unknown>[]): unknown {
  const arr = rows.slice();
  const first = rows[0] ?? {};
  for (const k of Object.keys(first)) {
    if (!(k in arr)) Object.defineProperty(arr, k, { value: first[k], enumerable: false });
  }
  return arr;
}

export async function resolveData(report: Report, params: Params): Promise<DataContext> {
  const resolvedParams: Params = {};
  for (const p of report.params) {
    const v = params[p.name] ?? p.default;
    if (p.required && (v === undefined || v === null || v === "")) throw new Error(`missing required param: ${p.name}`);
    resolvedParams[p.name] = p.type === "number" && v !== undefined ? Number(v) : v;
  }
  const ctx: DataContext = { params: resolvedParams };
  for (const ds of report.datasets) {
    if (ds.type !== "static") throw new Error(`dataset type "${ds.type}" is not supported in this phase`);
    ctx[ds.name] = rowsProxy(ds.rows);
  }
  return ctx;
}
```

`packages/core/src/index.ts`에 추가:
```ts
export * from "./data/resolve";
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test`
Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "feat(core): static 데이터셋 해석과 파라미터 검증"
```

---

### Task 6: renderer 폰트 메트릭과 텍스트 측정

**Files:**
- Create: `packages/renderer/package.json`, `packages/renderer/tsconfig.json`, `packages/renderer/fonts/Pretendard-Regular.otf`, `packages/renderer/fonts/Pretendard-Bold.otf`, `packages/renderer/scripts/gen-metrics.ts`, `packages/renderer/src/metrics.json`, `packages/renderer/src/text/measure.ts`
- Test: `packages/renderer/src/__tests__/measure.test.ts`

- [ ] **Step 1: 패키지 골격과 폰트 다운로드**

`packages/renderer/package.json`:
```json
{
  "name": "@daport/renderer",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./fonts/*": "./fonts/*" },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "gen:metrics": "tsx scripts/gen-metrics.ts"
  },
  "dependencies": {
    "@daport/core": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "opentype.js": "^1.3.4",
    "@types/opentype.js": "^1.3.8",
    "tsx": "^4.19.0"
  }
}
```

`packages/renderer/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "scripts"] }
```

폰트 다운로드 (Pretendard 1.3.9, SIL OFL):
```bash
mkdir -p packages/renderer/fonts && cd packages/renderer/fonts
curl -L -o pretendard.zip https://github.com/orioncactus/pretendard/releases/download/v1.3.9/Pretendard-1.3.9.zip
unzip -j pretendard.zip "*/public/static/OTF/Pretendard-Regular.otf" "*/public/static/OTF/Pretendard-Bold.otf" -d .
rm pretendard.zip && ls
```
Expected: `Pretendard-Bold.otf  Pretendard-Regular.otf`. zip 내부 경로가 다르면 `unzip -l pretendard.zip | grep -i 'Pretendard-Regular.otf'`로 실제 경로를 찾아 바꾼다.

- [ ] **Step 2: 메트릭 생성 스크립트**

`packages/renderer/scripts/gen-metrics.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "opentype.js";

type FontMetrics = { unitsPerEm: number; ascender: number; descender: number; hangul: number; fallback: number; widths: Record<string, number> };

function build(path: string): FontMetrics {
  const font = parse(readFileSync(path).buffer.slice(0));
  const widths: Record<string, number> = {};
  for (let cp = 0x20; cp <= 0x24f; cp++) {           // ASCII + Latin-1 + Latin Extended-A
    const ch = String.fromCodePoint(cp);
    const g = font.charToGlyph(ch);
    if (g && g.advanceWidth) widths[ch] = g.advanceWidth;
  }
  for (const ch of "·※○●□■◎△▲▽▼◇◆☆★→←↑↓℃㎜㎏㎡") {
    const g = font.charToGlyph(ch);
    if (g && g.advanceWidth) widths[ch] = g.advanceWidth;
  }
  const hangul = font.charToGlyph("가").advanceWidth ?? font.unitsPerEm;
  return { unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, hangul, fallback: hangul, widths };
}

const out = { regular: build("fonts/Pretendard-Regular.otf"), bold: build("fonts/Pretendard-Bold.otf") };
writeFileSync("src/metrics.json", JSON.stringify(out));
console.log("metrics written", Object.keys(out.regular.widths).length, "glyphs");
```

Run: `pnpm install && pnpm --filter @daport/renderer gen:metrics`
Expected: `metrics written 5xx glyphs`, `src/metrics.json` 생성.

- [ ] **Step 3: 실패 테스트 작성**

`packages/renderer/src/__tests__/measure.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { measureWidth, wrapText, lineHeightMm } from "../text/measure";

describe("measure", () => {
  it("hangul is wider than latin i", () => {
    expect(measureWidth("가", 10, false)).toBeGreaterThan(measureWidth("i", 10, false));
  });
  it("width scales with font size", () => {
    expect(measureWidth("ABC", 20, false)).toBeCloseTo(measureWidth("ABC", 10, false) * 2, 5);
  });
  it("line height in mm for 10pt * 1.3", () => {
    expect(lineHeightMm(10, 1.3)).toBeCloseTo((10 / 72) * 25.4 * 1.3, 5);
  });
  it("wraps by width and breaks on spaces", () => {
    const lines = wrapText("hello world foo", 10, false, measureWidth("hello world", 10, false) + 0.1);
    expect(lines).toEqual(["hello world", "foo"]);
  });
  it("wraps hangul per character when no spaces", () => {
    const w = measureWidth("가나", 10, false);
    expect(wrapText("가나다라", 10, false, w + 0.01)).toEqual(["가나", "다라"]);
  });
  it("respects explicit newlines and never returns empty for empty string", () => {
    expect(wrapText("a\nb", 10, false, 100)).toEqual(["a", "b"]);
    expect(wrapText("", 10, false, 100)).toEqual([""]);
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm --filter @daport/renderer test`
Expected: FAIL, 모듈 없음.

- [ ] **Step 5: 구현**

`packages/renderer/src/text/measure.ts`:
```ts
import metrics from "../metrics.json";
import { ptToMm } from "@daport/core";

type FontMetrics = typeof metrics.regular;

function fm(bold: boolean): FontMetrics { return bold ? metrics.bold : metrics.regular; }

function isHangul(cp: number) { return (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f); }
function isWide(cp: number) { return isHangul(cp) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0xff00 && cp <= 0xffef); }

/** 문자열 폭(mm). fontSize는 pt */
export function measureWidth(text: string, fontSize: number, bold: boolean): number {
  const m = fm(bold);
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const w = (m.widths as Record<string, number>)[ch];
    units += w !== undefined ? w : isWide(cp) ? m.hangul : m.fallback * 0.6;
  }
  return ptToMm((units / m.unitsPerEm) * fontSize);
}

export function lineHeightMm(fontSize: number, lineHeight: number): number { return ptToMm(fontSize) * lineHeight; }

/** maxWidth(mm)에 맞춰 줄바꿈. 공백 우선, 없으면 문자 단위 */
export function wrapText(text: string, fontSize: number, bold: boolean, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para === "") { out.push(""); continue; }
    let line = "";
    const tokens = para.split(/(\s+)/).filter((t) => t !== "");
    for (const tok of tokens) {
      const candidate = line + tok;
      if (measureWidth(candidate, fontSize, bold) <= maxWidth || line === "" && /^\s+$/.test(tok)) {
        line = candidate; continue;
      }
      if (/^\s+$/.test(tok)) { out.push(line); line = ""; continue; }
      if (line !== "") { out.push(line.trimEnd()); line = ""; }
      // 토큰 자체가 넘치면 문자 단위로 쪼갠다
      for (const ch of tok) {
        if (measureWidth(line + ch, fontSize, bold) <= maxWidth || line === "") line += ch;
        else { out.push(line); line = ch; }
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [""];
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter @daport/renderer test`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer pnpm-lock.yaml && git commit -m "feat(renderer): Pretendard 메트릭 생성과 텍스트 측정·줄바꿈"
```

---

### Task 7: renderer 레이아웃 (단일 페이지)

**Files:**
- Create: `packages/renderer/src/layout/types.ts`, `packages/renderer/src/layout/flatten.ts`, `packages/renderer/src/layout/layout.ts`, `packages/renderer/src/index.ts`
- Test: `packages/renderer/src/__tests__/layout.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`packages/renderer/src/__tests__/layout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { flatten } from "../layout/flatten";

const page = { width: 100, height: 50, margin: [5, 5, 5, 5] as [number, number, number, number] };
const ctx = { params: {}, order: { NAME: "ACME", HIDE: false } };

describe("flatten", () => {
  it("offsets group children to absolute coordinates", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "g", type: "group", x: 10, y: 20, w: 50, h: 20, children: [
        { id: "t", type: "text", x: 1, y: 2, w: 10, h: 5, value: "a" },
        { id: "l", type: "line", x: 0, y: 0, w: 50, h: 0, x2: 50, y2: 0 },
      ]},
    ]});
    const flat = flatten(r.elements);
    expect(flat.map((e) => e.id)).toEqual(["t", "l"]);
    expect(flat[0]).toMatchObject({ x: 11, y: 22 });
    expect(flat[1]).toMatchObject({ x: 10, y: 20, x2: 60, y2: 20 });
  });
});

describe("layout", () => {
  it("produces one page with page size and evaluated text", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "t", type: "text", x: 5, y: 5, w: 40, h: 10, value: "고객: {{ order.NAME }}" },
    ]});
    const pages = layout(r, ctx);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ index: 0, width: 100, height: 50 });
    const t = pages[0].items[0];
    expect(t.kind).toBe("text");
    if (t.kind === "text") expect(t.lines).toEqual(["고객: ACME"]);
  });
  it("wraps long text into multiple lines and reports overflow", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "t", type: "text", x: 5, y: 5, w: 15, h: 4, value: "가나다라마바사아자차", style: { fontSize: 10 } },
    ]});
    const t = layout(r, ctx)[0].items[0];
    if (t.kind === "text") { expect(t.lines.length).toBeGreaterThan(1); expect(t.overflow).toBe(true); }
  });
  it("omits element whose visible expression is false", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "{{ order.HIDE }}" },
      { id: "b", type: "rect", x: 0, y: 0, w: 1, h: 1, visible: "{{ !order.HIDE }}" },
    ]});
    expect(layout(r, ctx)[0].items.map((i) => i.elementId)).toEqual(["b"]);
  });
  it("marks expression error on the element only (blank mode)", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "bad", type: "text", x: 0, y: 0, w: 10, h: 5, value: "{{ order. }}" },
      { id: "ok", type: "text", x: 0, y: 0, w: 10, h: 5, value: "fine" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items[0]).toMatchObject({ elementId: "bad", error: expect.stringContaining("Expression") });
    expect(items[1]).toMatchObject({ elementId: "ok", error: undefined });
  });
  it("throws in fail mode", () => {
    const r = parseReport({ id: "r", version: 1, page, onExpressionError: "fail", elements: [
      { id: "bad", type: "text", x: 0, y: 0, w: 10, h: 5, value: "{{ order. }}" },
    ]});
    expect(() => layout(r, ctx)).toThrow();
  });
  it("renders pageNumber with page/total and image src interpolation", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "p", type: "pageNumber", x: 0, y: 0, w: 10, h: 5 },
      { id: "i", type: "image", x: 0, y: 0, w: 10, h: 5, src: "asset://{{ order.NAME }}" },
    ]});
    const items = layout(r, ctx)[0].items;
    expect(items[0]).toMatchObject({ kind: "text", lines: ["1 / 1"] });
    expect(items[1]).toMatchObject({ kind: "image", src: "asset://ACME" });
  });
  it("keeps declared-only types as placeholders", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 10, h: 5, format: "qr", value: "x" },
      { id: "t", type: "table", x: 0, y: 0, w: 10, h: 5, source: "s", columns: [] },
      { id: "c", type: "ref", x: 0, y: 0, w: 10, h: 5, ref: "hdr" },
    ]});
    const kinds = layout(r, ctx)[0].items.map((i) => i.kind);
    expect(kinds).toEqual(["placeholder", "placeholder", "placeholder"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/renderer test`
Expected: FAIL.

- [ ] **Step 3: 타입과 flatten 구현**

`packages/renderer/src/layout/types.ts`:
```ts
import type { Style } from "@daport/core";

type PlacedBase = { elementId: string; x: number; y: number; w: number; h: number; style: Style; error?: string };

export type PlacedText = PlacedBase & { kind: "text"; lines: string[]; lineHeight: number; overflow: boolean };
export type PlacedImage = PlacedBase & { kind: "image"; src: string; fit: "contain" | "cover" | "stretch" };
export type PlacedLine = PlacedBase & { kind: "line"; x2: number; y2: number };
export type PlacedRect = PlacedBase & { kind: "rect" };
export type PlacedPlaceholder = PlacedBase & { kind: "placeholder"; label: string };

export type PlacedItem = PlacedText | PlacedImage | PlacedLine | PlacedRect | PlacedPlaceholder;

export type Page = { index: number; width: number; height: number; items: PlacedItem[] };
```

`packages/renderer/src/layout/flatten.ts`:
```ts
import type { Element } from "@daport/core";

export type FlatElement = Exclude<Element, { type: "group" }>;

/** 그룹을 풀어 모든 요소를 페이지 절대좌표로 만든다. 순서는 문서 순서 유지 */
export function flatten(elements: Element[], dx = 0, dy = 0): FlatElement[] {
  const out: FlatElement[] = [];
  for (const el of elements) {
    if (el.type === "group") { out.push(...flatten(el.children, dx + el.x, dy + el.y)); continue; }
    const moved = { ...el, x: el.x + dx, y: el.y + dy } as FlatElement;
    if (moved.type === "line") { moved.x2 += dx; moved.y2 += dy; }
    out.push(moved);
  }
  return out;
}
```

- [ ] **Step 4: layout 구현**

`packages/renderer/src/layout/layout.ts`:
```ts
import { interpolate, evaluateTemplateValue, type Report, type DataContext, type Style } from "@daport/core";
import { flatten, type FlatElement } from "./flatten";
import { wrapText, lineHeightMm } from "../text/measure";
import type { Page, PlacedItem, PlacedText } from "./types";

function textItem(el: { id: string; x: number; y: number; w: number; h: number; style: Style }, text: string): PlacedText {
  const inner = Math.max(0, el.w - el.style.padding * 2);
  const lines = el.style.wrap ? wrapText(text, el.style.fontSize, el.style.bold, inner) : text.split(/\r?\n/);
  const lh = lineHeightMm(el.style.fontSize, el.style.lineHeight);
  const overflow = lines.length * lh > el.h - el.style.padding * 2 + 1e-6;
  return { kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style, lines, lineHeight: lh, overflow };
}

function place(el: FlatElement, ctx: DataContext): PlacedItem | null {
  if (el.visible !== undefined && !evaluateTemplateValue(el.visible, ctx)) return null;
  const base = { elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style };
  switch (el.type) {
    case "text": return textItem(el, interpolate(el.value, ctx));
    case "pageNumber": return textItem(el, interpolate(el.format, ctx));
    case "image": return { ...base, kind: "image", src: interpolate(el.src, ctx), fit: el.fit };
    case "line": return { ...base, kind: "line", x2: el.x2, y2: el.y2 };
    case "rect": return { ...base, kind: "rect" };
    case "barcode": return { ...base, kind: "placeholder", label: `barcode:${el.format}` };
    case "table": return { ...base, kind: "placeholder", label: `table:${el.source}` };
    case "ref": return { ...base, kind: "placeholder", label: `ref:${el.ref}` };
  }
}

export function layout(report: Report, data: DataContext): Page[] {
  const ctx: DataContext = { ...data, page: 1, total: 1 };
  const items: PlacedItem[] = [];
  for (const el of flatten(report.elements)) {
    try {
      const item = place(el, ctx);
      if (item) items.push(item);
    } catch (e) {
      if (report.onExpressionError === "fail") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      items.push({ kind: "text", elementId: el.id, x: el.x, y: el.y, w: el.w, h: el.h, style: el.style,
        lines: ["#ERR"], lineHeight: lineHeightMm(el.style.fontSize, el.style.lineHeight), overflow: false, error: msg });
    }
  }
  return [{ index: 0, width: report.page.width, height: report.page.height, items }];
}
```

`packages/renderer/src/index.ts`:
```ts
export * from "./layout/types";
export * from "./layout/flatten";
export * from "./layout/layout";
export * from "./text/measure";
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/renderer test`
Expected: 모두 통과.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer && git commit -m "feat(renderer): 그룹 평탄화와 단일 페이지 레이아웃"
```

---

### Task 8: renderer 페인트(React)와 HTML 출력

**Files:**
- Create: `packages/renderer/src/paint/css.ts`, `packages/renderer/src/paint/Paint.tsx`, `packages/renderer/src/html.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: `packages/renderer/src/__tests__/paint.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`packages/renderer/src/__tests__/paint.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { PaintPages } from "../paint/Paint";
import { pageCss } from "../paint/css";
import { renderToHtml } from "../html";

const report = parseReport({ id: "r", version: 1, page: { width: 60, height: 40 }, elements: [
  { id: "t", type: "text", x: 5, y: 5, w: 40, h: 10, value: "Hello", style: { fontSize: 12, bold: true, align: "center" } },
  { id: "r", type: "rect", x: 1, y: 1, w: 58, h: 38, style: { stroke: "#000", strokeWidth: 0.3 } },
  { id: "l", type: "line", x: 5, y: 20, w: 50, h: 0, x2: 55, y2: 20, style: { stroke: "#f00" } },
  { id: "i", type: "image", x: 5, y: 25, w: 10, h: 10, src: "https://example.com/a.png" },
  { id: "b", type: "barcode", x: 20, y: 25, w: 20, h: 10, format: "qr", value: "x" },
]});

describe("paint", () => {
  it("renders absolute mm positioned elements", () => {
    const html = renderToStaticMarkup(<PaintPages pages={layout(report, { params: {} })} />);
    expect(html).toContain('data-element-id="t"');
    expect(html).toMatch(/left:5mm;top:5mm;width:40mm;height:10mm/);
    expect(html).toContain("font-weight:700");
    expect(html).toContain("text-align:center");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain("barcode:qr");
    expect(html).toContain("<svg");           // line은 svg
  });
  it("emits @page size from page dims", () => {
    expect(pageCss(60, 40)).toContain("@page{size:60mm 40mm;margin:0}");
  });
  it("renderToHtml returns a full document with font-face", () => {
    const html = renderToHtml(report, { params: {} }, { fontBaseUrl: "/fonts" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("@font-face");
    expect(html).toContain("/fonts/Pretendard-Regular.otf");
    expect(html).toContain('class="dp-page"');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/renderer test`
Expected: FAIL.

- [ ] **Step 3: CSS 유틸 구현**

`packages/renderer/src/paint/css.ts`:
```ts
export function fontFaceCss(fontBaseUrl: string): string {
  return [
    `@font-face{font-family:'Pretendard';font-weight:400;src:url('${fontBaseUrl}/Pretendard-Regular.otf') format('opentype')}`,
    `@font-face{font-family:'Pretendard';font-weight:700;src:url('${fontBaseUrl}/Pretendard-Bold.otf') format('opentype')}`,
  ].join("\n");
}

export function pageCss(width: number, height: number): string {
  return [
    `@page{size:${width}mm ${height}mm;margin:0}`,
    `html,body{margin:0;padding:0}`,
    `.dp-page{position:relative;width:${width}mm;height:${height}mm;overflow:hidden;background:#fff;page-break-after:always;font-family:'Pretendard',sans-serif;color:#000}`,
    `.dp-page:last-child{page-break-after:auto}`,
    `.dp-el{position:absolute;box-sizing:border-box;margin:0}`,
    `.dp-text{white-space:pre;overflow:hidden}`,
    `.dp-line{overflow:visible}`,
    `.dp-ph{border:0.2mm dashed #999;color:#999;font-size:6pt;display:flex;align-items:center;justify-content:center}`,
    `.dp-err{outline:0.3mm solid #e00;color:#e00}`,
  ].join("\n");
}
```

- [ ] **Step 4: Paint 컴포넌트 구현**

`packages/renderer/src/paint/Paint.tsx`:
```tsx
import type { CSSProperties } from "react";
import type { Page, PlacedItem } from "../layout/types";

function box(i: PlacedItem): CSSProperties {
  return { left: `${i.x}mm`, top: `${i.y}mm`, width: `${i.w}mm`, height: `${i.h}mm` };
}

function Item({ item }: { item: PlacedItem }) {
  const s = item.style;
  const cls = "dp-el" + (item.error ? " dp-err" : "");
  const common = { className: cls, "data-element-id": item.elementId, title: item.error } as const;
  switch (item.kind) {
    case "text": {
      const justify = s.valign === "middle" ? "center" : s.valign === "bottom" ? "flex-end" : "flex-start";
      return (
        <div {...common} className={cls + " dp-text"} style={{ ...box(item), fontSize: `${s.fontSize}pt`, fontWeight: s.bold ? 700 : 400,
          color: s.color, textAlign: s.align, lineHeight: `${item.lineHeight}mm`, padding: `${s.padding}mm`,
          background: s.fill, border: s.stroke ? `${s.strokeWidth}mm solid ${s.stroke}` : undefined,
          display: "flex", flexDirection: "column", justifyContent: justify }}>
          {item.lines.map((l, n) => <div key={n}>{l === "" ? " " : l}</div>)}
        </div>
      );
    }
    case "rect":
      return <div {...common} style={{ ...box(item), background: s.fill, borderRadius: `${s.radius}mm`,
        border: s.stroke ? `${s.strokeWidth}mm solid ${s.stroke}` : undefined }} />;
    case "line": {
      const minX = Math.min(item.x, item.x2), minY = Math.min(item.y, item.y2);
      const w = Math.max(Math.abs(item.x2 - item.x), 0.01), h = Math.max(Math.abs(item.y2 - item.y), 0.01);
      return (
        <svg {...common} className={cls + " dp-line"} style={{ left: `${minX}mm`, top: `${minY}mm`, width: `${w}mm`, height: `${h}mm` }}
          viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
          <line x1={item.x - minX} y1={item.y - minY} x2={item.x2 - minX} y2={item.y2 - minY}
            stroke={s.stroke ?? "#000"} strokeWidth={s.strokeWidth} vectorEffect="non-scaling-stroke" />
        </svg>
      );
    }
    case "image":
      return <img {...common} src={item.src} alt="" style={{ ...box(item), objectFit: item.fit === "stretch" ? "fill" : item.fit }} />;
    case "placeholder":
      return <div {...common} className={cls + " dp-ph"} style={box(item)}>{item.label}</div>;
  }
}

export function PaintPage({ page }: { page: Page }) {
  return (
    <div className="dp-page" data-page-index={page.index}>
      {page.items.map((it) => <Item key={it.elementId} item={it} />)}
    </div>
  );
}

export function PaintPages({ pages }: { pages: Page[] }) {
  return <>{pages.map((p) => <PaintPage key={p.index} page={p} />)}</>;
}
```

- [ ] **Step 5: renderToHtml 구현**

`packages/renderer/src/html.ts`:
```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Report, DataContext } from "@daport/core";
import { layout } from "./layout/layout";
import { PaintPages } from "./paint/Paint";
import { fontFaceCss, pageCss } from "./paint/css";

export type HtmlOptions = { fontBaseUrl: string };

export function renderToHtml(report: Report, data: DataContext, opts: HtmlOptions): string {
  const pages = layout(report, data);
  const body = renderToStaticMarkup(createElement(PaintPages, { pages }));
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${report.name || report.id}</title>` +
    `<style>${fontFaceCss(opts.fontBaseUrl)}\n${pageCss(report.page.width, report.page.height)}</style></head>` +
    `<body>${body}</body></html>`;
}
```

`packages/renderer/src/index.ts`에 추가:
```ts
export * from "./paint/Paint";
export * from "./paint/css";
export * from "./html";
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter @daport/renderer test`
Expected: 모두 통과. React 인라인 스타일 직렬화가 `left:5mm;top:5mm;...` 순서와 다르면 테스트의 정규식을 실제 출력 순서에 맞춘다.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer && git commit -m "feat(renderer): React 페인트와 HTML 문서 출력"
```

---

### Task 9: renderer 골든 테스트 픽스처 (품질보증서)

**Files:**
- Create: `packages/renderer/src/__tests__/fixtures/quality-cert.report.json`, `packages/renderer/src/__tests__/golden.test.ts`

- [ ] **Step 1: 픽스처 작성**

`packages/renderer/src/__tests__/fixtures/quality-cert.report.json`:
```json
{
  "id": "quality-cert",
  "name": "품질보증서",
  "version": 1,
  "page": { "width": 210, "height": 297, "margin": [15, 15, 15, 15] },
  "params": [{ "name": "lotNo", "type": "string", "required": true }],
  "datasets": [
    { "name": "cert", "type": "static", "rows": [{
      "CUSTOMER_NAME": "대한정밀(주)", "PRODUCT_NAME": "베어링 하우징 BH-220", "LOT_NO": "L2609-0142",
      "QTY": 1200, "ISSUE_DT": "2026-09-16", "INSPECTOR": "김품질", "SPEC": "KS B 2023"
    }]},
    { "name": "results", "type": "static", "rows": [
      { "ITEM": "외경", "STD": "220.0 ±0.05", "MEASURED": "220.02", "JUDGE": "합격" },
      { "ITEM": "내경", "STD": "180.0 ±0.05", "MEASURED": "179.98", "JUDGE": "합격" },
      { "ITEM": "경도", "STD": "HRC 58~62", "MEASURED": "HRC 60", "JUDGE": "합격" }
    ]}
  ],
  "elements": [
    { "id": "border", "type": "rect", "x": 10, "y": 10, "w": 190, "h": 277, "style": { "stroke": "#000", "strokeWidth": 0.4 } },
    { "id": "title", "type": "text", "x": 15, "y": 20, "w": 180, "h": 14, "value": "품 질 보 증 서",
      "style": { "fontSize": 24, "bold": true, "align": "center" } },
    { "id": "subtitle", "type": "text", "x": 15, "y": 34, "w": 180, "h": 6, "value": "CERTIFICATE OF QUALITY",
      "style": { "fontSize": 10, "align": "center", "color": "#444" } },
    { "id": "hr", "type": "line", "x": 15, "y": 44, "w": 180, "h": 0, "x2": 195, "y2": 44, "style": { "stroke": "#000", "strokeWidth": 0.5 } },
    { "id": "info", "type": "group", "x": 15, "y": 50, "w": 180, "h": 50, "children": [
      { "id": "lbl-cust", "type": "text", "x": 0, "y": 0, "w": 35, "h": 8, "value": "고객사", "style": { "bold": true, "valign": "middle", "fill": "#f2f2f2", "padding": 2 } },
      { "id": "val-cust", "type": "text", "x": 35, "y": 0, "w": 145, "h": 8, "value": "{{ cert.CUSTOMER_NAME }}", "style": { "valign": "middle", "padding": 2 } },
      { "id": "lbl-prod", "type": "text", "x": 0, "y": 8, "w": 35, "h": 8, "value": "품명", "style": { "bold": true, "valign": "middle", "fill": "#f2f2f2", "padding": 2 } },
      { "id": "val-prod", "type": "text", "x": 35, "y": 8, "w": 145, "h": 8, "value": "{{ cert.PRODUCT_NAME }}", "style": { "valign": "middle", "padding": 2 } },
      { "id": "lbl-lot", "type": "text", "x": 0, "y": 16, "w": 35, "h": 8, "value": "LOT No.", "style": { "bold": true, "valign": "middle", "fill": "#f2f2f2", "padding": 2 } },
      { "id": "val-lot", "type": "text", "x": 35, "y": 16, "w": 55, "h": 8, "value": "{{ cert.LOT_NO }}", "style": { "valign": "middle", "padding": 2 } },
      { "id": "lbl-qty", "type": "text", "x": 90, "y": 16, "w": 35, "h": 8, "value": "수량", "style": { "bold": true, "valign": "middle", "fill": "#f2f2f2", "padding": 2 } },
      { "id": "val-qty", "type": "text", "x": 125, "y": 16, "w": 55, "h": 8, "value": "{{ formatNumber(cert.QTY, '#,##0') }} EA", "style": { "valign": "middle", "padding": 2 } },
      { "id": "lbl-spec", "type": "text", "x": 0, "y": 24, "w": 35, "h": 8, "value": "적용규격", "style": { "bold": true, "valign": "middle", "fill": "#f2f2f2", "padding": 2 } },
      { "id": "val-spec", "type": "text", "x": 35, "y": 24, "w": 145, "h": 8, "value": "{{ cert.SPEC }}", "style": { "valign": "middle", "padding": 2 } },
      { "id": "info-box", "type": "rect", "x": 0, "y": 0, "w": 180, "h": 32, "style": { "stroke": "#000", "strokeWidth": 0.3 } }
    ]},
    { "id": "results-title", "type": "text", "x": 15, "y": 95, "w": 100, "h": 8, "value": "검사 결과", "style": { "fontSize": 12, "bold": true } },
    { "id": "results-table", "type": "table", "x": 15, "y": 104, "w": 180, "h": 60, "source": "results",
      "columns": [
        { "header": "검사항목", "value": "{{ row.ITEM }}", "w": 45 },
        { "header": "규격", "value": "{{ row.STD }}", "w": 55 },
        { "header": "측정값", "value": "{{ row.MEASURED }}", "w": 45 },
        { "header": "판정", "value": "{{ row.JUDGE }}", "w": 35 }
      ]},
    { "id": "statement", "type": "text", "x": 15, "y": 180, "w": 180, "h": 20,
      "value": "상기 제품은 당사 품질관리 기준에 따라 검사한 결과 규격에 적합함을 보증합니다.", "style": { "fontSize": 11, "align": "center", "valign": "middle" } },
    { "id": "issue-dt", "type": "text", "x": 15, "y": 230, "w": 180, "h": 8, "value": "{{ formatDate(cert.ISSUE_DT, 'yyyy년 MM월 dd일') }}", "style": { "fontSize": 12, "align": "center" } },
    { "id": "inspector", "type": "text", "x": 110, "y": 250, "w": 60, "h": 8, "value": "검사자: {{ cert.INSPECTOR }}", "style": { "fontSize": 11, "align": "right", "valign": "middle" } },
    { "id": "stamp", "type": "image", "x": 172, "y": 244, "w": 20, "h": 20, "src": "asset://stamp" },
    { "id": "pn", "type": "pageNumber", "x": 15, "y": 278, "w": 180, "h": 6, "style": { "fontSize": 8, "align": "center", "color": "#666" } }
  ]
}
```

`formatDate`의 패턴에 한글이 들어가도 `yyyy/MM/dd` 치환만 하므로 동작한다.

- [ ] **Step 2: 골든 테스트 작성**

`packages/renderer/src/__tests__/golden.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport, resolveData } from "@daport/core";
import { layout } from "../layout/layout";
import fixture from "./fixtures/quality-cert.report.json";

describe("golden: quality-cert", () => {
  it("layout matches snapshot", async () => {
    const report = parseReport(fixture);
    const data = await resolveData(report, { lotNo: "L2609-0142" });
    const pages = layout(report, data);
    expect(pages).toHaveLength(1);
    expect(pages[0].items.every((i) => !i.error)).toBe(true);
    expect(pages).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: 실행하여 스냅샷 생성**

Run: `pnpm --filter @daport/renderer test`
Expected: 통과, `__snapshots__/golden.test.ts.snap` 생성. 스냅샷을 열어 `val-qty`의 lines가 `["1,200 EA"]`, `issue-dt`가 `["2026년 09월 16일"]`인지 눈으로 확인한다.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer && git commit -m "test(renderer): 품질보증서 골든 픽스처와 레이아웃 스냅샷"
```

---

### Task 10: pdf 패키지 (Playwright)

**Files:**
- Create: `packages/pdf/package.json`, `packages/pdf/tsconfig.json`, `packages/pdf/src/pool.ts`, `packages/pdf/src/index.ts`
- Test: `packages/pdf/src/__tests__/pdf.test.ts`

- [ ] **Step 1: 패키지 골격**

`packages/pdf/package.json`:
```json
{
  "name": "@daport/pdf",
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
    "@daport/core": "workspace:*",
    "@daport/renderer": "workspace:*",
    "playwright": "^1.55.0"
  },
  "devDependencies": {
    "pdf-lib": "^1.17.1",
    "pdf-to-img": "^4.4.0",
    "pixelmatch": "^7.1.0",
    "pngjs": "^7.0.0",
    "@types/pixelmatch": "^5.2.6",
    "@types/pngjs": "^6.0.5"
  }
}
```

`packages/pdf/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Run: `pnpm install && pnpm --filter @daport/pdf exec playwright install chromium`
Expected: Chromium 다운로드 완료.

- [ ] **Step 2: 실패 테스트 작성**

`packages/pdf/src/__tests__/pdf.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdf as pdfToImg } from "pdf-to-img";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { parseReport, resolveData } from "@daport/core";
import { renderToHtml } from "@daport/renderer";
import { renderPdf, renderHtmlScreenshot, closePool } from "../index";

const mkReport = (w: number, h: number) => parseReport({ id: "t", version: 1, page: { width: w, height: h }, elements: [
  { id: "r", type: "rect", x: 2, y: 2, w: w - 4, h: h - 4, style: { stroke: "#000", strokeWidth: 0.5 } },
  { id: "t", type: "text", x: 5, y: 5, w: w - 10, h: 10, value: "품질 TEST 123", style: { fontSize: 12, bold: true } },
]});

afterAll(closePool);

describe("renderPdf", () => {
  it.each([[210, 297], [297, 210], [60, 40]])("produces %dx%dmm page", async (w, h) => {
    const buf = await renderPdf(mkReport(w, h), { params: {} });
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();      // pt
    expect(width / 72 * 25.4).toBeCloseTo(w, 0);
    expect(height / 72 * 25.4).toBeCloseTo(h, 0);
  }, 30_000);

  it("PDF raster matches HTML screenshot within tolerance", async () => {
    const report = mkReport(100, 60);
    const buf = await renderPdf(report, { params: {} });
    const doc = await pdfToImg(buf, { scale: 96 / 72 });   // 96dpi
    const pdfPng = PNG.sync.read(Buffer.from((await doc.getPage(1))));
    const shot = await renderHtmlScreenshot(report, { params: {} });
    const htmlPng = PNG.sync.read(shot);
    expect(htmlPng.width).toBe(pdfPng.width);
    expect(htmlPng.height).toBe(pdfPng.height);
    const diff = pixelmatch(htmlPng.data, pdfPng.data, null, pdfPng.width, pdfPng.height, { threshold: 0.2 });
    expect(diff / (pdfPng.width * pdfPng.height)).toBeLessThan(0.01);   // 1% 미만 차이
  }, 30_000);
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/pdf test`
Expected: FAIL.

- [ ] **Step 4: 구현**

`packages/pdf/src/pool.ts`:
```ts
import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch({ headless: true }).then((b) => { browser = b; launching = null; return b; });
  }
  return launching;
}

export async function closePool(): Promise<void> {
  const b = browser; browser = null;
  if (b) await b.close();
}
```

`packages/pdf/src/index.ts`:
```ts
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Report, DataContext } from "@daport/core";
import { renderToHtml } from "@daport/renderer";
import { getBrowser } from "./pool";
export { closePool } from "./pool";

const fontsDir = resolve(dirname(fileURLToPath(import.meta.resolve("@daport/renderer"))), "../fonts");
const fontBaseUrl = "file://" + fontsDir;

async function withPage<T>(html: string, fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => (document as any).fonts.ready);
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

export async function renderPdf(report: Report, data: DataContext, attempt = 0): Promise<Buffer> {
  const html = renderToHtml(report, data, { fontBaseUrl });
  try {
    return await withPage(html, (page) => page.pdf({
      width: `${report.page.width}mm`, height: `${report.page.height}mm`,
      printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
  } catch (e) {
    if (attempt === 0) return renderPdf(report, data, 1);     // Chromium 크래시 1회 재시도
    throw e;
  }
}

/** 테스트·미리보기 비교용: 첫 페이지를 96dpi PNG로 */
export async function renderHtmlScreenshot(report: Report, data: DataContext): Promise<Buffer> {
  const html = renderToHtml(report, data, { fontBaseUrl });
  return withPage(html, async (page) => {
    await page.setViewportSize({ width: Math.round(report.page.width / 25.4 * 96), height: Math.round(report.page.height / 25.4 * 96) });
    return page.locator(".dp-page").first().screenshot({ type: "png" });
  });
}
```

`import.meta.resolve`가 tsx/vitest에서 동작하지 않으면 `createRequire(import.meta.url).resolve("@daport/renderer/package.json")`로 바꾼다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/pdf test`
Expected: 4 passed. 픽셀 비교가 1%를 넘으면 크기 반올림 차이인지 먼저 확인한다(`htmlPng.width` vs `pdfPng.width`). 한 픽셀 차이면 두 이미지를 같은 크기로 자른 뒤 비교하도록 테스트를 조정한다. 폰트가 로드되지 않으면(`@font-face` 미적용) `fontBaseUrl`의 `file://` 경로가 실제 폰트 위치인지 `ls`로 확인한다.

- [ ] **Step 6: Commit**

```bash
git add packages/pdf pnpm-lock.yaml && git commit -m "feat(pdf): Playwright PDF 생성, 브라우저 풀, 픽셀 비교 테스트"
```

---

### Task 11: studio 앱 골격, DB, 레포트 API

**Files:**
- Create: `apps/studio/package.json`, `apps/studio/next.config.ts`, `apps/studio/tsconfig.json`, `apps/studio/postcss.config.mjs`, `apps/studio/drizzle.config.ts`, `apps/studio/.env.example`, `apps/studio/src/app/globals.css`, `apps/studio/src/app/layout.tsx`, `apps/studio/src/db/schema.ts`, `apps/studio/src/db/client.ts`, `apps/studio/src/app/api/reports/route.ts`, `apps/studio/src/app/api/reports/[id]/route.ts`, `apps/studio/src/lib/report-store.ts`
- Test: `apps/studio/src/lib/__tests__/report-store.test.ts`

- [ ] **Step 1: Next.js 앱 골격**

`apps/studio/package.json`:
```json
{
  "name": "studio",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test",
    "db:push": "drizzle-kit push",
    "postinstall": "node scripts/copy-fonts.mjs"
  },
  "dependencies": {
    "@daport/core": "workspace:*",
    "@daport/renderer": "workspace:*",
    "@daport/pdf": "workspace:*",
    "@neondatabase/serverless": "^1.0.0",
    "@vercel/blob": "^1.1.0",
    "drizzle-orm": "^0.44.0",
    "fast-json-patch": "^3.1.1",
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "@monaco-editor/react": "^4.7.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@tailwindcss/postcss": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "drizzle-kit": "^0.31.0",
    "tailwindcss": "^4.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^26.0.0"
  }
}
```

`apps/studio/scripts/copy-fonts.mjs`:
```js
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/fonts", { recursive: true });
cpSync("../../packages/renderer/fonts", "public/fonts", { recursive: true });
```

`apps/studio/next.config.ts`:
```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@daport/core", "@daport/renderer", "@daport/pdf"],
  serverExternalPackages: ["playwright"],
};
export default config;
```

`apps/studio/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "jsx": "preserve", "plugins": [{ "name": "next" }], "paths": { "@/*": ["./src/*"] }, "incremental": true },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/studio/postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`apps/studio/src/app/globals.css`:
```css
@import "tailwindcss";
html, body { height: 100%; margin: 0; }
```

`apps/studio/src/app/layout.tsx`:
```tsx
import "./globals.css";
export const metadata = { title: "daport studio" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body className="h-full bg-neutral-100 text-neutral-900">{children}</body></html>;
}
```

`apps/studio/.env.example`:
```
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
BLOB_READ_WRITE_TOKEN=
```

- [ ] **Step 2: DB 스키마와 클라이언트**

`apps/studio/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/db/schema.ts", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } });
```

`apps/studio/src/db/schema.ts`:
```ts
import { pgTable, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  draft: jsonb("draft").notNull(),
  publishedVersionId: integer("published_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`apps/studio/src/db/client.ts`:
```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}
```

- [ ] **Step 3: 저장소 추상화와 실패 테스트**

DB 접근을 인터페이스 뒤에 두어 API 핸들러를 메모리 구현으로 테스트한다.

`apps/studio/src/lib/report-store.ts`:
```ts
import { eq } from "drizzle-orm";
import { parseReport, type Report, type ReportInput } from "@daport/core";
import { db } from "@/db/client";
import { reports } from "@/db/schema";

export type ReportSummary = { id: string; name: string; updatedAt: string };

export interface ReportStore {
  list(): Promise<ReportSummary[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  update(id: string, input: ReportInput): Promise<Report>;
}

export class MemoryReportStore implements ReportStore {
  private map = new Map<string, Report>();
  async list() { return [...this.map.values()].map((r) => ({ id: r.id, name: r.name, updatedAt: new Date().toISOString() })); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async create(input: ReportInput) {
    const r = parseReport(input);
    if (this.map.has(r.id)) throw new Error(`report exists: ${r.id}`);
    this.map.set(r.id, r); return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    if (!this.map.has(id)) throw new Error(`report not found: ${id}`);
    this.map.set(id, r); return r;
  }
}

export class DbReportStore implements ReportStore {
  async list() {
    const rows = await db().select({ id: reports.id, name: reports.name, updatedAt: reports.updatedAt }).from(reports);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }
  async get(id: string) {
    const [row] = await db().select().from(reports).where(eq(reports.id, id));
    return row ? parseReport(row.draft) : null;
  }
  async create(input: ReportInput) {
    const r = parseReport(input);
    await db().insert(reports).values({ id: r.id, name: r.name, draft: r });
    return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const res = await db().update(reports).set({ name: r.name, draft: r, updatedAt: new Date() }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new Error(`report not found: ${id}`);
    return r;
  }
}

let store: ReportStore | null = null;
export function getStore(): ReportStore {
  if (!store) store = process.env.DATABASE_URL ? new DbReportStore() : new MemoryReportStore();
  return store;
}
```

`apps/studio/src/lib/__tests__/report-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MemoryReportStore } from "../report-store";

const input = { id: "a", name: "A", version: 1, page: { width: 100, height: 100 } };

describe("MemoryReportStore", () => {
  it("creates, gets, lists, updates", async () => {
    const s = new MemoryReportStore();
    await s.create(input);
    expect((await s.get("a"))?.name).toBe("A");
    expect(await s.list()).toHaveLength(1);
    await s.update("a", { ...input, name: "B" });
    expect((await s.get("a"))?.name).toBe("B");
  });
  it("rejects duplicate and missing", async () => {
    const s = new MemoryReportStore();
    await s.create(input);
    await expect(s.create(input)).rejects.toThrow(/exists/);
    await expect(s.update("zz", input)).rejects.toThrow(/not found/);
  });
  it("rejects invalid report", async () => {
    await expect(new MemoryReportStore().create({ id: "x" } as any)).rejects.toThrow();
  });
});
```

`apps/studio/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

Run: `pnpm install && pnpm --filter studio test`
Expected: 3 passed.

- [ ] **Step 4: API 라우트**

`apps/studio/src/app/api/reports/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getStore } from "@/lib/report-store";

export async function GET() { return NextResponse.json(await getStore().list()); }

export async function POST(req: Request) {
  try {
    const r = await getStore().create(await req.json());
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`apps/studio/src/app/api/reports/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getStore } from "@/lib/report-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const r = await getStore().get((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    return NextResponse.json(await getStore().update((await params).id, await req.json()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 400 });
  }
}
```

- [ ] **Step 5: 수동 확인**

Run: `pnpm --filter studio dev` 후 다른 터미널에서
```bash
curl -s -X POST localhost:3000/api/reports -H 'content-type: application/json' \
  -d '{"id":"t1","name":"테스트","version":1,"page":{"width":210,"height":297}}'
curl -s localhost:3000/api/reports
```
Expected: 첫 응답에 `"id":"t1"`, 둘째에 목록 1건. `DATABASE_URL` 없이 메모리 저장소로 동작한다.

- [ ] **Step 6: Commit**

```bash
git add apps/studio pnpm-lock.yaml && git commit -m "feat(studio): Next.js 골격, Neon 스키마, 레포트 CRUD API"
```

---

### Task 12: studio 에디터 상태 (zustand + JSON Patch 히스토리)

**Files:**
- Create: `apps/studio/src/editor/history.ts`, `apps/studio/src/editor/store.ts`
- Test: `apps/studio/src/editor/__tests__/history.test.ts`, `apps/studio/src/editor/__tests__/store.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/history.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { commit, undo, redo, createHistory } from "../history";

describe("history", () => {
  it("commits a patch and undoes/redoes it", () => {
    const h0 = createHistory({ a: 1, list: [{ id: "x" }] });
    const h1 = commit(h0, (d) => { d.a = 2; d.list.push({ id: "y" }); });
    expect(h1.present).toEqual({ a: 2, list: [{ id: "x" }, { id: "y" }] });
    expect(h1.past).toHaveLength(1);
    const h2 = undo(h1);
    expect(h2.present).toEqual({ a: 1, list: [{ id: "x" }] });
    const h3 = redo(h2);
    expect(h3.present).toEqual(h1.present);
  });
  it("undo on empty past is a no-op; commit clears future", () => {
    const h0 = createHistory({ a: 1 });
    expect(undo(h0)).toBe(h0);
    const h1 = undo(commit(h0, (d) => { d.a = 2; }));
    expect(h1.future).toHaveLength(1);
    const h2 = commit(h1, (d) => { d.a = 3; });
    expect(h2.future).toHaveLength(0);
  });
  it("skips no-op commits", () => {
    const h0 = createHistory({ a: 1 });
    expect(commit(h0, () => {})).toBe(h0);
  });
});
```

`apps/studio/src/editor/__tests__/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { parseReport } from "@daport/core";
import { createEditorStore } from "../store";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [{ id: "b", type: "rect", x: 1, y: 1, w: 5, h: 5 }] },
]});

describe("editor store", () => {
  let store: ReturnType<typeof createEditorStore>;
  beforeEach(() => { store = createEditorStore(report); });

  it("selects and moves elements with undo", () => {
    store.getState().select(["a"]);
    store.getState().moveSelected(5, -2);
    expect(store.getState().findElement("a")).toMatchObject({ x: 15, y: 8 });
    store.getState().undo();
    expect(store.getState().findElement("a")).toMatchObject({ x: 10, y: 10 });
  });
  it("updates a nested element by id", () => {
    store.getState().updateElement("b", { w: 9 });
    expect(store.getState().findElement("b")).toMatchObject({ w: 9 });
  });
  it("adds, duplicates and deletes", () => {
    store.getState().addElement({ id: "n", type: "rect", x: 0, y: 0, w: 1, h: 1 });
    expect(store.getState().findElement("n")).toBeTruthy();
    store.getState().select(["n"]);
    store.getState().duplicateSelected();
    expect(store.getState().report.elements).toHaveLength(4);
    expect(store.getState().selection).toHaveLength(1);
    expect(store.getState().selection[0]).not.toBe("n");
    store.getState().deleteSelected();
    expect(store.getState().report.elements).toHaveLength(3);
  });
  it("replaces whole report from JSON text and reports validation errors", () => {
    const ok = store.getState().replaceReport({ ...report, name: "new" });
    expect(ok).toBe(true);
    expect(store.getState().report.name).toBe("new");
    const bad = store.getState().replaceReport({ ...report, elements: [{ id: "z", type: "nope" }] } as any);
    expect(bad).toBe(false);
    expect(store.getState().problems.length).toBeGreaterThan(0);
    expect(store.getState().report.name).toBe("new");   // 마지막 유효 모델 유지
  });
  it("updates page size", () => {
    store.getState().updatePage({ width: 297, height: 210 });
    expect(store.getState().report.page).toMatchObject({ width: 297, height: 210 });
  });
  it("marks dirty after change and clean after markSaved", () => {
    expect(store.getState().dirty).toBe(false);
    store.getState().updatePage({ width: 50 });
    expect(store.getState().dirty).toBe(true);
    store.getState().markSaved();
    expect(store.getState().dirty).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test`
Expected: FAIL.

- [ ] **Step 3: history 구현**

`apps/studio/src/editor/history.ts`:
```ts
import { compare, applyPatch, deepClone, type Operation } from "fast-json-patch";

export type History<T> = { present: T; past: Operation[][]; future: Operation[][] };   // past[i]는 present→이전 상태로 가는 역패치

export function createHistory<T>(initial: T): History<T> { return { present: initial, past: [], future: [] }; }

/** mutate로 복제본을 고치고, 정방향/역방향 패치를 기록한다 */
export function commit<T extends object>(h: History<T>, mutate: (draft: T) => void, limit = 200): History<T> {
  const next = deepClone(h.present) as T;
  mutate(next);
  const forward = compare(h.present as object, next as object);
  if (forward.length === 0) return h;
  const inverse = compare(next as object, h.present as object);
  return { present: next, past: [...h.past.slice(-limit + 1), inverse], future: [] };
}

export function undo<T extends object>(h: History<T>): History<T> {
  const inverse = h.past[h.past.length - 1];
  if (!inverse) return h;
  const prev = applyPatch(deepClone(h.present) as object, deepClone(inverse), false, false).newDocument as T;
  const redoPatch = compare(prev as object, h.present as object);
  return { present: prev, past: h.past.slice(0, -1), future: [...h.future, redoPatch] };
}

export function redo<T extends object>(h: History<T>): History<T> {
  const fwd = h.future[h.future.length - 1];
  if (!fwd) return h;
  const next = applyPatch(deepClone(h.present) as object, deepClone(fwd), false, false).newDocument as T;
  const inverse = compare(next as object, h.present as object);
  return { present: next, past: [...h.past, inverse], future: h.future.slice(0, -1) };
}
```

- [ ] **Step 4: store 구현**

`apps/studio/src/editor/store.ts`:
```ts
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { createContext, useContext } from "react";
import { safeParseReport, type Report, type Element, type Page } from "@daport/core";
import { createHistory, commit, undo, redo, type History } from "./history";

export type Problem = { path: string; message: string };

export type EditorState = {
  history: History<Report>;
  report: Report;
  selection: string[];
  problems: Problem[];
  dirty: boolean;
  mode: "design" | "preview";
  // queries
  findElement(id: string): Element | undefined;
  // mutations
  select(ids: string[]): void;
  toggleSelect(id: string): void;
  updateElement(id: string, patch: Partial<Element>): void;
  moveSelected(dx: number, dy: number): void;
  resizeElement(id: string, box: { x: number; y: number; w: number; h: number }): void;
  addElement(el: Element): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  updatePage(patch: Partial<Page>): void;
  replaceReport(candidate: unknown): boolean;
  undo(): void;
  redo(): void;
  setMode(m: "design" | "preview"): void;
  markSaved(): void;
};

function walk(els: Element[], fn: (el: Element, parent: Element[] , idx: number) => boolean | void): boolean {
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (fn(el, els, i)) return true;
    if (el.type === "group" && walk(el.children, fn)) return true;
  }
  return false;
}

function newId(base: string, report: Report): string {
  const ids = new Set<string>();
  walk(report.elements, (el) => { ids.add(el.id); });
  let n = 1; let id = `${base}-${n}`;
  while (ids.has(id)) { n++; id = `${base}-${n}`; }
  return id;
}

const round = (v: number) => Math.round(v * 100) / 100;

export function createEditorStore(initial: Report) {
  return createStore<EditorState>((set, get) => {
    const apply = (mutate: (r: Report) => void) => {
      const h = commit(get().history, mutate);
      if (h !== get().history) set({ history: h, report: h.present, dirty: true, problems: [] });
    };
    return {
      history: createHistory(initial), report: initial, selection: [], problems: [], dirty: false, mode: "design",
      findElement: (id) => { let found: Element | undefined; walk(get().report.elements, (el) => { if (el.id === id) { found = el; return true; } }); return found; },
      select: (ids) => set({ selection: ids }),
      toggleSelect: (id) => set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
      updateElement: (id, patch) => apply((r) => { walk(r.elements, (el) => { if (el.id === id) { Object.assign(el, patch); return true; } }); }),
      moveSelected: (dx, dy) => apply((r) => { const sel = new Set(get().selection); walk(r.elements, (el) => {
        if (sel.has(el.id)) { el.x = round(el.x + dx); el.y = round(el.y + dy); if (el.type === "line") { el.x2 = round(el.x2 + dx); el.y2 = round(el.y2 + dy); } } }); }),
      resizeElement: (id, box) => apply((r) => { walk(r.elements, (el) => { if (el.id === id) {
        if (el.type === "line") { el.x2 = round(el.x2 + (box.x + box.w) - (el.x + el.w)); el.y2 = round(el.y2 + (box.y + box.h) - (el.y + el.h)); }
        el.x = round(box.x); el.y = round(box.y); el.w = round(box.w); el.h = round(box.h); return true; } }); }),
      addElement: (el) => { apply((r) => { r.elements.push(el); }); set({ selection: [el.id] }); },
      duplicateSelected: () => {
        const ids: string[] = [];
        apply((r) => { const sel = new Set(get().selection); const copies: Element[] = [];
          walk(r.elements, (el) => { if (sel.has(el.id)) { const c = structuredClone(el) as Element; c.id = newId(el.id, r); c.x += 5; c.y += 5; ids.push(c.id); copies.push(c); } });
          r.elements.push(...copies); });
        set({ selection: ids });
      },
      deleteSelected: () => { apply((r) => { const sel = new Set(get().selection); const prune = (els: Element[]) => { for (let i = els.length - 1; i >= 0; i--) { if (sel.has(els[i].id)) els.splice(i, 1); else if (els[i].type === "group") prune((els[i] as any).children); } }; prune(r.elements); }); set({ selection: [] }); },
      updatePage: (patch) => apply((r) => { Object.assign(r.page, patch); }),
      replaceReport: (candidate) => {
        const res = safeParseReport(candidate);
        if (!res.success) { set({ problems: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }); return false; }
        apply((r) => { Object.assign(r, res.data); for (const k of Object.keys(r)) if (!(k in res.data)) delete (r as any)[k]; });
        set({ selection: get().selection.filter((id) => !!get().findElement(id)) });
        return true;
      },
      undo: () => { const h = undo(get().history); set({ history: h, report: h.present, dirty: true }); },
      redo: () => { const h = redo(get().history); set({ history: h, report: h.present, dirty: true }); },
      setMode: (mode) => set({ mode }),
      markSaved: () => set({ dirty: false }),
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

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test`
Expected: 모두 통과.

- [ ] **Step 6: Commit**

```bash
git add apps/studio && git commit -m "feat(studio): JSON Patch 히스토리와 에디터 zustand 스토어"
```

---

### Task 13: studio 캔버스 (드래그·리사이즈·스냅·다중 선택)

**Files:**
- Create: `apps/studio/src/editor/canvas/snap.ts`, `apps/studio/src/editor/canvas/useDrag.ts`, `apps/studio/src/editor/canvas/SelectionBox.tsx`, `apps/studio/src/editor/canvas/Canvas.tsx`
- Test: `apps/studio/src/editor/canvas/__tests__/snap.test.ts`

캔버스는 렌더러의 `PaintPage`로 페이지를 그리고, 그 위에 투명 오버레이 레이어를 얹어 선택·드래그를 처리한다. 렌더러 출력은 건드리지 않는다. 화면 배율은 CSS `transform: scale(zoom)`으로 하고 좌표 변환은 `px / (96/25.4) / zoom`으로 mm를 얻는다.

- [ ] **Step 1: 스냅 유틸 실패 테스트**

`apps/studio/src/editor/canvas/__tests__/snap.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { snapMm, pxToMm, mmToPxScaled } from "../snap";

describe("snap", () => {
  it("snaps to 0.5mm grid", () => {
    expect(snapMm(10.24)).toBe(10);
    expect(snapMm(10.26)).toBe(10.5);
    expect(snapMm(3.1, 1)).toBe(3);
  });
  it("converts px <-> mm with zoom", () => {
    expect(pxToMm(96, 1)).toBeCloseTo(25.4, 5);
    expect(pxToMm(192, 2)).toBeCloseTo(25.4, 5);
    expect(mmToPxScaled(25.4, 2)).toBeCloseTo(192, 5);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test`
Expected: FAIL.

- [ ] **Step 3: 스냅 유틸 구현**

`apps/studio/src/editor/canvas/snap.ts`:
```ts
const PX_PER_MM = 96 / 25.4;
export function snapMm(v: number, grid = 0.5): number { return Math.round(v / grid) * grid; }
export function pxToMm(px: number, zoom: number): number { return px / PX_PER_MM / zoom; }
export function mmToPxScaled(mm: number, zoom: number): number { return mm * PX_PER_MM * zoom; }
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test`
Expected: 통과.

- [ ] **Step 5: 드래그 훅 구현**

`apps/studio/src/editor/canvas/useDrag.ts`:
```ts
import { useRef, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { pxToMm, snapMm } from "./snap";

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type Box = { x: number; y: number; w: number; h: number };

type DragState = { handle: Handle; start: { px: number; py: number }; boxes: Record<string, Box>; last: Record<string, Box> };

/** 포인터 드래그를 mm 델타로 바꿔 onChange(id, box)로 흘리고, 끝나면 onEnd로 최종 박스를 넘긴다 */
export function useDrag(opts: {
  zoom: number;
  onChange: (boxes: Record<string, Box>) => void;
  onEnd: (boxes: Record<string, Box>) => void;
}) {
  const state = useRef<DragState | null>(null);

  const begin = useCallback((e: ReactPointerEvent, handle: Handle, boxes: Record<string, Box>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    state.current = { handle, start: { px: e.clientX, py: e.clientY }, boxes, last: boxes };
  }, []);

  const move = useCallback((e: ReactPointerEvent) => {
    const s = state.current; if (!s) return;
    const dx = snapMm(pxToMm(e.clientX - s.start.px, opts.zoom));
    const dy = snapMm(pxToMm(e.clientY - s.start.py, opts.zoom));
    const next: Record<string, Box> = {};
    for (const [id, b] of Object.entries(s.boxes)) next[id] = applyHandle(b, s.handle, dx, dy);
    s.last = next;
    opts.onChange(next);
  }, [opts]);

  const end = useCallback(() => {
    const s = state.current; if (!s) return;
    state.current = null;
    opts.onEnd(s.last);
  }, [opts]);

  return { begin, move, end };
}

export function applyHandle(b: Box, h: Handle, dx: number, dy: number, min = 1): Box {
  let { x, y, w, h: hh } = b;
  if (h === "move") return { x: x + dx, y: y + dy, w, h: hh };
  if (h.includes("e")) w = Math.max(min, w + dx);
  if (h.includes("s")) hh = Math.max(min, hh + dy);
  if (h.includes("w")) { const nw = Math.max(min, w - dx); x += w - nw; w = nw; }
  if (h.includes("n")) { const nh = Math.max(min, hh - dy); y += hh - nh; hh = nh; }
  return { x, y, w, h: hh };
}
```

- [ ] **Step 6: 선택 박스와 캔버스 구현**

`apps/studio/src/editor/canvas/SelectionBox.tsx`:
```tsx
import type { PointerEvent } from "react";
import type { Box, Handle } from "./useDrag";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const pos: Record<Handle, string> = {
  move: "", n: "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize", s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-s-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-e-resize", w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-w-resize",
  ne: "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize", nw: "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize",
  se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize", sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize",
};

export function SelectionBox({ box, single, onHandleDown }: { box: Box; single: boolean; onHandleDown: (e: PointerEvent, h: Handle) => void }) {
  return (
    <div className="absolute border border-blue-500 pointer-events-none" style={{ left: `${box.x}mm`, top: `${box.y}mm`, width: `${box.w}mm`, height: `${box.h}mm` }}>
      {single && HANDLES.map((h) => (
        <div key={h} data-handle={h} onPointerDown={(e) => { e.stopPropagation(); onHandleDown(e, h); }}
          className={`absolute w-2 h-2 bg-white border border-blue-500 pointer-events-auto ${pos[h]}`} />
      ))}
    </div>
  );
}
```

`apps/studio/src/editor/canvas/Canvas.tsx`:
```tsx
"use client";
import { useMemo, useState, type PointerEvent } from "react";
import { layout, PaintPage, pageCss, fontFaceCss } from "@daport/renderer";
import { resolveDataSync } from "@/lib/data";
import { useEditor } from "../store";
import { useDrag, type Box, type Handle } from "./useDrag";
import { SelectionBox } from "./SelectionBox";
import { pxToMm } from "./snap";

export function Canvas({ zoom }: { zoom: number }) {
  const report = useEditor((s) => s.report);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const findElement = useEditor((s) => s.findElement);
  const resizeElement = useEditor((s) => s.resizeElement);
  const [ghost, setGhost] = useState<Record<string, Box> | null>(null);

  const data = useMemo(() => resolveDataSync(report), [report]);
  const pages = useMemo(() => layout(report, data), [report, data]);
  const css = useMemo(() => fontFaceCss("/fonts") + "\n" + pageCss(report.page.width, report.page.height), [report.page.width, report.page.height]);

  // 선택 요소들의 절대 박스 (그룹 자식은 layout 결과에서 좌표를 얻는다)
  const boxes = useMemo(() => {
    const m: Record<string, Box> = {};
    for (const it of pages[0].items) if (selection.includes(it.elementId)) m[it.elementId] = { x: it.x, y: it.y, w: it.w, h: it.h };
    return m;
  }, [pages, selection]);

  const drag = useDrag({
    zoom,
    onChange: setGhost,
    onEnd: (final) => {
      setGhost(null);
      for (const [id, b] of Object.entries(final)) {
        const el = findElement(id); const orig = boxes[id]; if (!el || !orig) continue;
        // 그룹 자식은 layout 절대좌표와 요소 상대좌표의 차이를 유지한다
        resizeElement(id, { x: el.x + (b.x - orig.x), y: el.y + (b.y - orig.y), w: b.w, h: b.h });
      }
    },
  });

  const onPagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("[data-element-id]") as HTMLElement | null;
    if (!target) { select([]); return; }
    const id = target.dataset.elementId!;
    if (e.shiftKey) { toggleSelect(id); return; }
    const ids = selection.includes(id) ? selection : [id];
    if (!selection.includes(id)) select([id]);
    const start: Record<string, Box> = {};
    for (const sid of ids) { const it = pages[0].items.find((i) => i.elementId === sid); if (it) start[sid] = { x: it.x, y: it.y, w: it.w, h: it.h }; }
    drag.begin(e, "move", start);
  };
  const onHandleDown = (e: PointerEvent, h: Handle) => { drag.begin(e, h, boxes); };

  const shown = ghost ?? boxes;
  return (
    <div className="relative inline-block shadow-lg" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
      data-testid="canvas" onPointerDown={onPagePointerDown} onPointerMove={drag.move} onPointerUp={drag.end}>
      <style>{css}</style>
      <PaintPage page={pages[0]} />
      <div className="absolute inset-0 pointer-events-none">
        {Object.entries(shown).map(([id, b]) => <SelectionBox key={id} box={b} single={selection.length === 1} onHandleDown={onHandleDown} />)}
      </div>
    </div>
  );
}
```

`apps/studio/src/lib/data.ts` (static 데이터셋은 동기 해석이 가능하므로 캔버스용 동기 버전):
```ts
import { rowsProxy, type Report, type DataContext } from "@daport/core";

export function resolveDataSync(report: Report): DataContext {
  const params: Record<string, unknown> = {};
  for (const p of report.params) params[p.name] = p.default ?? (p.type === "number" ? 0 : `{${p.name}}`);
  const ctx: DataContext = { params };
  for (const ds of report.datasets) ctx[ds.name] = ds.type === "static" ? rowsProxy(ds.rows) : rowsProxy([]);
  return ctx;
}
```

- [ ] **Step 7: 타입 확인**

Run: `pnpm --filter studio typecheck`
Expected: 오류 없음. `pxToMm` 미사용 경고가 나면 import를 제거한다.

- [ ] **Step 8: Commit**

```bash
git add apps/studio && git commit -m "feat(studio): 캔버스 선택·드래그·리사이즈·스냅"
```

---

### Task 14: studio 패널 (요소 팔레트, 속성, 페이지) + 단축키

**Files:**
- Create: `apps/studio/src/editor/panels/ElementPalette.tsx`, `apps/studio/src/editor/panels/PropertyPanel.tsx`, `apps/studio/src/editor/panels/PagePanel.tsx`, `apps/studio/src/editor/panels/Field.tsx`, `apps/studio/src/editor/useKeyboard.ts`
- Test: `apps/studio/src/editor/__tests__/PropertyPanel.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/PropertyPanel.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PropertyPanel } from "../panels/PropertyPanel";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
]});

describe("PropertyPanel", () => {
  it("shows nothing selected message", () => {
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    expect(screen.getByText(/선택된 요소가 없습니다/)).toBeTruthy();
  });
  it("edits x and value of selected text", () => {
    const store = createEditorStore(report);
    store.getState().select(["a"]);
    render(<EditorContext.Provider value={store}><PropertyPanel /></EditorContext.Provider>);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "{{ params.x }}" } });
    expect(store.getState().findElement("a")).toMatchObject({ x: 15, value: "{{ params.x }}" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test`
Expected: FAIL.

- [ ] **Step 3: 공용 필드와 패널 구현**

`apps/studio/src/editor/panels/Field.tsx`:
```tsx
import type { ReactNode } from "react";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex items-center gap-2 text-xs"><span className="w-16 shrink-0 text-neutral-500">{label}</span>{children}</label>;
}
export function NumberField({ label, value, onChange, step = 0.5 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <Field label={label}><input aria-label={label} type="number" step={step} value={value} className="w-full border rounded px-1 py-0.5"
    onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} /></Field>;
}
export function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return <Field label={label}>{multiline
    ? <textarea aria-label={label} value={value} rows={3} className="w-full border rounded px-1 py-0.5" onChange={(e) => onChange(e.target.value)} />
    : <input aria-label={label} type="text" value={value} className="w-full border rounded px-1 py-0.5" onChange={(e) => onChange(e.target.value)} />}</Field>;
}
export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return <Field label={label}><select aria-label={label} value={value} className="w-full border rounded px-1 py-0.5" onChange={(e) => onChange(e.target.value as T)}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>;
}
export function CheckField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Field label={label}><input aria-label={label} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /></Field>;
}
```

`apps/studio/src/editor/panels/PropertyPanel.tsx`:
```tsx
"use client";
import type { Element, Style } from "@daport/core";
import { useEditor } from "../store";
import { NumberField, TextField, SelectField, CheckField } from "./Field";

export function PropertyPanel() {
  const selection = useEditor((s) => s.selection);
  const findElement = useEditor((s) => s.findElement);
  const updateElement = useEditor((s) => s.updateElement);
  const report = useEditor((s) => s.report);   // 구독용: 변경 시 재렌더
  void report;
  if (selection.length !== 1) return <div className="p-3 text-xs text-neutral-500">{selection.length === 0 ? "선택된 요소가 없습니다" : `${selection.length}개 선택됨`}</div>;
  const el = findElement(selection[0]);
  if (!el) return null;
  const set = (patch: Partial<Element>) => updateElement(el.id, patch);
  const setStyle = (patch: Partial<Style>) => updateElement(el.id, { style: { ...el.style, ...patch } } as Partial<Element>);

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">{el.type} <span className="text-neutral-400">#{el.id}</span></div>
      <NumberField label="X" value={el.x} onChange={(x) => set({ x })} />
      <NumberField label="Y" value={el.y} onChange={(y) => set({ y })} />
      <NumberField label="W" value={el.w} onChange={(w) => set({ w })} />
      <NumberField label="H" value={el.h} onChange={(h) => set({ h })} />
      {el.type === "line" && <><NumberField label="X2" value={el.x2} onChange={(x2) => set({ x2 } as any)} /><NumberField label="Y2" value={el.y2} onChange={(y2) => set({ y2 } as any)} /></>}
      {el.type === "text" && <TextField label="내용" value={el.value} multiline onChange={(value) => set({ value } as any)} />}
      {el.type === "image" && <><TextField label="src" value={el.src} onChange={(src) => set({ src } as any)} />
        <SelectField label="fit" value={el.fit} options={["contain", "cover", "stretch"]} onChange={(fit) => set({ fit } as any)} /></>}
      <TextField label="visible" value={el.visible ?? ""} onChange={(v) => set({ visible: v || undefined })} />
      <div className="text-xs font-semibold mt-2">스타일</div>
      {(el.type === "text" || el.type === "pageNumber") && <>
        <NumberField label="글자크기" value={el.style.fontSize} step={0.5} onChange={(fontSize) => setStyle({ fontSize })} />
        <CheckField label="굵게" value={el.style.bold} onChange={(bold) => setStyle({ bold })} />
        <SelectField label="정렬" value={el.style.align} options={["left", "center", "right"]} onChange={(align) => setStyle({ align })} />
        <SelectField label="세로정렬" value={el.style.valign} options={["top", "middle", "bottom"]} onChange={(valign) => setStyle({ valign })} />
        <CheckField label="줄바꿈" value={el.style.wrap} onChange={(wrap) => setStyle({ wrap })} />
        <TextField label="글자색" value={el.style.color} onChange={(color) => setStyle({ color })} />
        <NumberField label="여백" value={el.style.padding} onChange={(padding) => setStyle({ padding })} />
      </>}
      <TextField label="선색" value={el.style.stroke ?? ""} onChange={(v) => setStyle({ stroke: v || undefined })} />
      <NumberField label="선굵기" value={el.style.strokeWidth} step={0.1} onChange={(strokeWidth) => setStyle({ strokeWidth })} />
      <TextField label="배경색" value={el.style.fill ?? ""} onChange={(v) => setStyle({ fill: v || undefined })} />
      {el.type === "rect" && <NumberField label="모서리" value={el.style.radius} onChange={(radius) => setStyle({ radius })} />}
    </div>
  );
}
```

`apps/studio/src/editor/panels/PagePanel.tsx`:
```tsx
"use client";
import { useEditor } from "../store";
import { NumberField, SelectField } from "./Field";

const PRESETS: Record<string, [number, number]> = {
  "A4 세로": [210, 297], "A4 가로": [297, 210], "A3 세로": [297, 420], "A3 가로": [420, 297], "Letter": [215.9, 279.4], "Tag 60×40": [60, 40], "사용자 정의": [0, 0],
};

export function PagePanel() {
  const page = useEditor((s) => s.report.page);
  const updatePage = useEditor((s) => s.updatePage);
  const current = Object.entries(PRESETS).find(([, [w, h]]) => w === page.width && h === page.height)?.[0] ?? "사용자 정의";
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold">페이지</div>
      <SelectField label="프리셋" value={current} options={Object.keys(PRESETS)} onChange={(k) => { const [w, h] = PRESETS[k]; if (w) updatePage({ width: w, height: h }); }} />
      <NumberField label="너비(mm)" value={page.width} onChange={(width) => updatePage({ width })} />
      <NumberField label="높이(mm)" value={page.height} onChange={(height) => updatePage({ height })} />
    </div>
  );
}
```

`apps/studio/src/editor/panels/ElementPalette.tsx`:
```tsx
"use client";
import type { Element } from "@daport/core";
import { useEditor } from "../store";

const ITEMS: { label: string; make: (id: string) => Element }[] = [
  { label: "텍스트", make: (id) => ({ id, type: "text", x: 10, y: 10, w: 40, h: 8, value: "텍스트", flow: "once", style: defaultStyle() }) },
  { label: "이미지", make: (id) => ({ id, type: "image", x: 10, y: 10, w: 30, h: 30, src: "", fit: "contain", flow: "once", style: defaultStyle() }) },
  { label: "선", make: (id) => ({ id, type: "line", x: 10, y: 10, w: 50, h: 0, x2: 60, y2: 10, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "사각형", make: (id) => ({ id, type: "rect", x: 10, y: 10, w: 40, h: 20, flow: "once", style: { ...defaultStyle(), stroke: "#000" } }) },
  { label: "페이지번호", make: (id) => ({ id, type: "pageNumber", x: 10, y: 10, w: 40, h: 6, format: "{{ page }} / {{ total }}", flow: "every", style: defaultStyle() }) },
];

function defaultStyle() {
  return { fontFamily: "Pretendard" as const, fontSize: 10, bold: false, color: "#000000", align: "left" as const, valign: "top" as const, wrap: true, lineHeight: 1.3, strokeWidth: 0.2, radius: 0, padding: 0 };
}

export function ElementPalette() {
  const addElement = useEditor((s) => s.addElement);
  const findElement = useEditor((s) => s.findElement);
  const nextId = (base: string) => { let n = 1; while (findElement(`${base}-${n}`)) n++; return `${base}-${n}`; };
  return (
    <div className="p-3 flex flex-col gap-1">
      <div className="text-xs font-semibold mb-1">요소</div>
      {ITEMS.map((it) => (
        <button key={it.label} className="text-left text-xs border rounded px-2 py-1 hover:bg-neutral-100" onClick={() => addElement(it.make(nextId(it.label === "텍스트" ? "text" : it.label === "이미지" ? "image" : it.label === "선" ? "line" : it.label === "사각형" ? "rect" : "pn")))}>
          + {it.label}
        </button>
      ))}
    </div>
  );
}
```

`apps/studio/src/editor/useKeyboard.ts`:
```ts
import { useEffect } from "react";
import type { EditorStore } from "./store";

export function useKeyboard(store: EditorStore) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, .monaco-editor")) return;
      const s = store.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (meta && e.key.toLowerCase() === "d") { e.preventDefault(); s.duplicateSelected(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { if (s.selection.length) { e.preventDefault(); s.deleteSelected(); } return; }
      const step = e.shiftKey ? 5 : 0.5;
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key] && s.selection.length) { e.preventDefault(); s.moveSelected(...map[e.key]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
```

Cmd+G 그룹화는 그룹 편집 UI(자식 좌표 재계산, 해제)가 필요하므로 2단계 컴포넌트 라이브러리와 함께 다룬다. 1단계는 JSON 편집기로 그룹을 만든다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 통과.

- [ ] **Step 5: Commit**

```bash
git add apps/studio && git commit -m "feat(studio): 요소 팔레트, 속성·페이지 패널, 단축키"
```

---

### Task 15: studio JSON 편집기 (Monaco 양방향 동기화)

**Files:**
- Create: `apps/studio/src/editor/json/sync.ts`, `apps/studio/src/editor/json/JsonEditor.tsx`, `apps/studio/src/app/api/schema/route.ts`
- Test: `apps/studio/src/editor/json/__tests__/sync.test.ts`

양방향 동기화 규칙: 스토어 → 편집기는 `report`가 바뀔 때마다 `JSON.stringify(report, null, 2)`를 편집기에 넣되, 마지막으로 편집기가 보낸 텍스트와 파싱 결과가 같으면 덮어쓰지 않는다(커서 튐 방지). 편집기 → 스토어는 400ms 디바운스 후 `JSON.parse` → `replaceReport`. 파싱 실패는 문제 목록에만 표시한다.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/json/__tests__/sync.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { shouldPushToEditor, parseEditorText } from "../sync";

describe("json sync", () => {
  it("does not push when editor text already equals report", () => {
    const report = { id: "a", x: 1 };
    const text = JSON.stringify(report, null, 2);
    expect(shouldPushToEditor(text, report)).toBe(false);
    expect(shouldPushToEditor(text.replace("1", "2"), report)).toBe(true);
    expect(shouldPushToEditor("{ bad", report)).toBe(true);
  });
  it("parses valid json and reports syntax error", () => {
    expect(parseEditorText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const r = parseEditorText("{a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test`
Expected: FAIL.

- [ ] **Step 3: 구현**

`apps/studio/src/editor/json/sync.ts`:
```ts
export function shouldPushToEditor(editorText: string, report: unknown): boolean {
  try { return JSON.stringify(JSON.parse(editorText)) !== JSON.stringify(report); } catch { return true; }
}
export function parseEditorText(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, message: `JSON 구문 오류: ${(e as Error).message}` }; }
}
export function toEditorText(report: unknown): string { return JSON.stringify(report, null, 2); }
```

`apps/studio/src/app/api/schema/route.ts`:
```ts
import { NextResponse } from "next/server";
import { reportJsonSchema } from "@daport/core";
export function GET() { return NextResponse.json(reportJsonSchema()); }
```

`apps/studio/src/editor/json/JsonEditor.tsx`:
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useEditor } from "../store";
import { shouldPushToEditor, parseEditorText, toEditorText } from "./sync";

export function JsonEditor() {
  const report = useEditor((s) => s.report);
  const replaceReport = useEditor((s) => s.replaceReport);
  const problems = useEditor((s) => s.problems);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 스토어 → 편집기
  useEffect(() => {
    const ed = editorRef.current; if (!ed) return;
    const text = ed.getValue();
    if (shouldPushToEditor(text, report)) ed.setValue(toEditorText(report));
  }, [report]);

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.setValue(toEditorText(report));
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      schemas: [{ uri: "/api/schema", fileMatch: ["*"] }],
    });
  };

  // 편집기 → 스토어 (디바운스)
  const onChange = (value?: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = parseEditorText(value ?? "");
      if (!r.ok) { setSyntaxError(r.message); return; }
      setSyntaxError(null);
      replaceReport(r.value);
    }, 400);
  };

  return (
    <div className="flex flex-col h-full">
      <Editor height="100%" defaultLanguage="json" path="report.json" onMount={onMount} onChange={onChange}
        options={{ minimap: { enabled: false }, fontSize: 12, tabSize: 2, automaticLayout: true }} />
      {(syntaxError || problems.length > 0) && (
        <div className="max-h-24 overflow-auto border-t bg-red-50 text-red-700 text-xs p-2">
          {syntaxError && <div>{syntaxError}</div>}
          {problems.map((p, i) => <div key={i}>{p.path}: {p.message}</div>)}
        </div>
      )}
    </div>
  );
}
```

Monaco의 스키마 `uri`는 실제 fetch되지 않고 식별자로만 쓰이므로, `onMount`에서 `fetch("/api/schema")` 결과를 `schema` 필드에 직접 넣는다:
```ts
fetch("/api/schema").then((r) => r.json()).then((schema) => {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, schemas: [{ uri: "daport://report", fileMatch: ["*"], schema }] });
});
```
위 코드로 `onMount`의 `setDiagnosticsOptions` 호출을 대체한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 통과.

- [ ] **Step 5: Commit**

```bash
git add apps/studio && git commit -m "feat(studio): Monaco JSON 편집기와 양방향 동기화, JSON Schema API"
```

---

### Task 16: studio 에디터 조립, 미리보기, 저장, PDF, 에셋 업로드

**Files:**
- Create: `apps/studio/src/editor/Editor.tsx`, `apps/studio/src/editor/Preview.tsx`, `apps/studio/src/editor/Toolbar.tsx`, `apps/studio/src/app/reports/[id]/page.tsx`, `apps/studio/src/app/page.tsx`, `apps/studio/src/app/api/reports/[id]/pdf/route.ts`, `apps/studio/src/app/api/reports/[id]/preview/route.ts`, `apps/studio/src/app/api/assets/route.ts`, `apps/studio/src/lib/assets.ts`
- Test: `apps/studio/src/lib/__tests__/assets.test.ts`

- [ ] **Step 1: 에셋 URL 해석 실패 테스트**

이미지 `src`가 `asset://id`이면 Blob URL로 바꿔야 브라우저와 PDF에서 보인다. 매핑은 저장 시 레포트에 `assets: { id: url }`를 두지 않고, 업로드 응답의 URL을 그대로 `src`에 넣는 방식이 가장 단순하다. 1단계는 그렇게 하고, `asset://` 접두사는 렌더 직전 `resolveAssetUrls`로 `/api/assets/{id}`로 바꿔 나중에 매핑 테이블을 붙일 자리를 만든다.

`apps/studio/src/lib/__tests__/assets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { resolveAssetUrls } from "../assets";

describe("resolveAssetUrls", () => {
  it("rewrites asset:// to /api/assets/{id} and leaves http alone", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, elements: [
      { id: "a", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://stamp" },
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "b", type: "image", x: 0, y: 0, w: 1, h: 1, src: "https://x/y.png" }] },
    ]});
    const out = resolveAssetUrls(r, "https://studio.example");
    expect((out.elements[0] as any).src).toBe("https://studio.example/api/assets/stamp");
    expect(((out.elements[1] as any).children[0]).src).toBe("https://x/y.png");
    expect((r.elements[0] as any).src).toBe("asset://stamp");   // 원본 불변
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test`
Expected: FAIL.

- [ ] **Step 3: 에셋 유틸과 API 구현**

`apps/studio/src/lib/assets.ts`:
```ts
import type { Report, Element } from "@daport/core";

export function resolveAssetUrls(report: Report, baseUrl: string): Report {
  const clone = structuredClone(report);
  const walk = (els: Element[]) => { for (const el of els) {
    if (el.type === "image" && el.src.startsWith("asset://")) el.src = `${baseUrl}/api/assets/${el.src.slice("asset://".length)}`;
    if (el.type === "group") walk(el.children);
  } };
  walk(clone.elements);
  return clone;
}
```

`apps/studio/src/app/api/assets/route.ts`:
```ts
import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  const id = crypto.randomUUID();
  const blob = await put(`assets/${id}-${file.name}`, file, { access: "public", addRandomSuffix: false });
  return NextResponse.json({ id, url: blob.url, name: file.name }, { status: 201 });
}

export async function GET() {
  const { blobs } = await list({ prefix: "assets/" });
  return NextResponse.json(blobs.map((b) => ({ url: b.url, name: b.pathname.replace(/^assets\//, "") })));
}
```

`apps/studio/src/app/api/assets/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { blobs } = await list({ prefix: `assets/${id}-` });
  if (!blobs[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(blobs[0].url, 302);
}
```

`BLOB_READ_WRITE_TOKEN`이 없으면 업로드는 500이 난다. 로컬 개발에서는 Vercel 프로젝트를 링크하고 `vercel env pull`로 받는다(Vercel Blob 스토어 생성은 대시보드 또는 `vercel blob store add`).

- [ ] **Step 4: 미리보기·PDF API**

`apps/studio/src/app/api/reports/[id]/preview/route.ts`:
```ts
import { NextResponse } from "next/server";
import { resolveData } from "@daport/core";
import { renderToHtml } from "@daport/renderer";
import { getStore } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const report = body.report ? await import("@daport/core").then((m) => m.parseReport(body.report)) : await getStore().get(id);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const origin = new URL(req.url).origin;
    const data = await resolveData(report, body.params ?? {});
    const html = renderToHtml(resolveAssetUrls(report, origin), data, { fontBaseUrl: `${origin}/fonts` });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`apps/studio/src/app/api/reports/[id]/pdf/route.ts`:
```ts
import { NextResponse } from "next/server";
import { resolveData, parseReport } from "@daport/core";
import { renderPdf } from "@daport/pdf";
import { getStore } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const report = body.report ? parseReport(body.report) : await getStore().get(id);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const origin = new URL(req.url).origin;
    const data = await resolveData(report, body.params ?? {});
    const pdf = await renderPdf(resolveAssetUrls(report, origin), data);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${encodeURIComponent(report.name || report.id)}.pdf"`,
    } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
```

`body.report`를 받는 이유: 저장 전 편집 중인 모델로도 미리보기·PDF를 뽑기 위해서다. Vercel 배포에서는 Playwright Chromium이 번들에 필요하므로 `playwright` 대신 `playwright-core` + `@sparticuz/chromium`으로 교체해야 한다. 1단계 완료 기준은 로컬 실행이므로 이 교체는 4단계(배포)에서 한다. `packages/pdf/src/pool.ts`의 `chromium.launch` 한 곳만 바꾸면 된다.

- [ ] **Step 5: 미리보기·툴바·에디터 조립**

`apps/studio/src/editor/Preview.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useEditor } from "../store";

export function Preview() {
  const report = useEditor((s) => s.report);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params: Record<string, unknown> = {};
    for (const p of report.params) params[p.name] = p.default ?? "SAMPLE";
    fetch(`/api/reports/${report.id}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, params }) })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); return r.text(); })
      .then((t) => { setHtml(t); setError(null); })
      .catch((e) => setError(e.message));
  }, [report]);
  if (error) return <div className="p-4 text-red-700 text-sm">{error}</div>;
  return <iframe title="preview" className="w-full h-full bg-neutral-300" srcDoc={html} />;
}
```

`apps/studio/src/editor/Toolbar.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useEditor } from "../store";

export function Toolbar({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const report = useEditor((s) => s.report);
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const markSaved = useEditor((s) => s.markSaved);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const r = await fetch(`/api/reports/${report.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
    setBusy(false);
    if (r.ok) markSaved(); else alert((await r.json()).error);
  };
  const pdf = async () => {
    const params: Record<string, unknown> = {};
    for (const p of report.params) params[p.name] = p.default ?? "SAMPLE";
    const r = await fetch(`/api/reports/${report.id}/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report, params }) });
    if (!r.ok) { alert((await r.json()).error); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${report.name || report.id}.pdf` });
    a.click(); URL.revokeObjectURL(url);
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-white">
      <span className="font-semibold text-sm">{report.name || report.id}{dirty ? " *" : ""}</span>
      <button className={btn} onClick={undo}>되돌리기</button>
      <button className={btn} onClick={redo}>다시하기</button>
      <button className={btn} onClick={() => setMode(mode === "design" ? "preview" : "design")}>{mode === "design" ? "미리보기" : "디자인"}</button>
      <label className="text-xs ml-2">배율 <input type="range" min={0.25} max={3} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {Math.round(zoom * 100)}%</label>
      <div className="flex-1" />
      <button className={btn} onClick={pdf}>PDF</button>
      <button className={btn} disabled={busy || !dirty} onClick={save} data-testid="save">저장</button>
    </div>
  );
}
```

`apps/studio/src/editor/Editor.tsx`:
```tsx
"use client";
import { useMemo, useState } from "react";
import type { Report } from "@daport/core";
import { createEditorStore, EditorContext, useEditor } from "./store";
import { useKeyboard } from "./useKeyboard";
import { Canvas } from "./canvas/Canvas";
import { Preview } from "./Preview";
import { Toolbar } from "./Toolbar";
import { ElementPalette } from "./panels/ElementPalette";
import { PropertyPanel } from "./panels/PropertyPanel";
import { PagePanel } from "./panels/PagePanel";
import { JsonEditor } from "./json/JsonEditor";

function Body({ zoom }: { zoom: number }) {
  const mode = useEditor((s) => s.mode);
  return mode === "preview" ? <Preview /> : <div className="p-8 overflow-auto h-full"><Canvas zoom={zoom} /></div>;
}

export function Editor({ initial }: { initial: Report }) {
  const store = useMemo(() => createEditorStore(initial), [initial]);
  const [zoom, setZoom] = useState(1);
  useKeyboard(store);
  return (
    <EditorContext.Provider value={store}>
      <div className="h-screen flex flex-col">
        <Toolbar zoom={zoom} setZoom={setZoom} />
        <div className="flex-1 grid grid-cols-[200px_1fr_260px] min-h-0">
          <aside className="border-r bg-white overflow-auto"><ElementPalette /></aside>
          <main className="min-w-0 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-auto"><Body zoom={zoom} /></div>
            <div className="h-64 border-t bg-white"><JsonEditor /></div>
          </main>
          <aside className="border-l bg-white overflow-auto"><PagePanel /><PropertyPanel /></aside>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
```

`apps/studio/src/app/reports/[id]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getStore } from "@/lib/report-store";
import { Editor } from "@/editor/Editor";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const report = await getStore().get((await params).id);
  if (!report) notFound();
  return <Editor initial={report} />;
}
```

`apps/studio/src/app/page.tsx`:
```tsx
import Link from "next/link";
import { getStore } from "@/lib/report-store";
import { NewReportForm } from "./NewReportForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const list = await getStore().list();
  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-4">레포트</h1>
      <ul className="divide-y bg-white border rounded mb-6">
        {list.map((r) => <li key={r.id} className="p-3"><Link className="text-blue-700 hover:underline" href={`/reports/${r.id}`}>{r.name || r.id}</Link></li>)}
        {list.length === 0 && <li className="p-3 text-neutral-500 text-sm">레포트가 없습니다</li>}
      </ul>
      <NewReportForm />
    </main>
  );
}
```

`apps/studio/src/app/NewReportForm.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewReportForm() {
  const router = useRouter();
  const [id, setId] = useState(""); const [name, setName] = useState("");
  const [size, setSize] = useState("210x297");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [width, height] = size.split("x").map(Number);
    const r = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, version: 1, page: { width, height }, datasets: [], params: [], elements: [] }) });
    if (r.ok) router.push(`/reports/${id}`); else alert((await r.json()).error);
  };
  return (
    <form onSubmit={submit} className="flex gap-2 items-end">
      <label className="text-xs">ID<input required pattern="[a-z0-9-]+" value={id} onChange={(e) => setId(e.target.value)} className="block border rounded px-2 py-1" /></label>
      <label className="text-xs">이름<input value={name} onChange={(e) => setName(e.target.value)} className="block border rounded px-2 py-1" /></label>
      <label className="text-xs">크기<select value={size} onChange={(e) => setSize(e.target.value)} className="block border rounded px-2 py-1">
        <option value="210x297">A4 세로</option><option value="297x210">A4 가로</option><option value="60x40">Tag 60×40</option></select></label>
      <button className="text-sm border rounded px-3 py-1 bg-white">새 레포트</button>
    </form>
  );
}
```

- [ ] **Step 6: 수동 확인**

Run: `pnpm --filter studio dev`
1. `/`에서 `qc`, A4 세로로 생성 → 에디터 열림.
2. 팔레트에서 텍스트 추가 → 캔버스 드래그 → JSON 편집기 좌표가 바뀜.
3. JSON에서 `"x": 50`으로 수정 → 캔버스 이동.
4. 미리보기 전환 → iframe에 같은 배치. PDF 버튼 → 다운로드된 PDF가 동일 배치.
5. 저장 → `*` 사라짐. 새로고침 후 유지.

- [ ] **Step 7: Commit**

```bash
git add apps/studio && git commit -m "feat(studio): 에디터 조립, 미리보기, 저장, PDF 다운로드, 에셋 업로드"
```

---

### Task 17: 품질보증서 시드, E2E 스모크, 완료 기준 검증

**Files:**
- Create: `apps/studio/scripts/seed.ts`, `apps/studio/playwright.config.ts`, `apps/studio/e2e/editor.spec.ts`, `.github/workflows/ci.yml`

- [ ] **Step 1: 시드 스크립트**

골든 픽스처를 studio 저장소에 넣는다. 메모리 저장소는 프로세스마다 초기화되므로 dev 서버 부팅 시 자동 시드하도록 `getStore()`에 훅을 둔다.

`apps/studio/src/lib/report-store.ts`의 `getStore` 를 다음으로 교체:
```ts
import fixture from "../../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json";

let store: ReportStore | null = null;
let seeded: Promise<void> | null = null;
export function getStore(): ReportStore {
  if (!store) {
    store = process.env.DATABASE_URL ? new DbReportStore() : new MemoryReportStore();
    if (!process.env.DATABASE_URL) seeded = store.create(fixture as any).then(() => {});
  }
  return store;
}
export function ready(): Promise<void> { return seeded ?? Promise.resolve(); }
```
그리고 `list`/`get`을 호출하는 곳(`api/reports/route.ts`, `api/reports/[id]/route.ts`, `app/page.tsx`, `reports/[id]/page.tsx`)에서 `await ready()`를 먼저 호출한다. 예: `export async function GET() { await ready(); return NextResponse.json(await getStore().list()); }`

DB 사용 시 시드: `apps/studio/scripts/seed.ts`
```ts
import { DbReportStore } from "../src/lib/report-store";
import fixture from "../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json";
const s = new DbReportStore();
s.create(fixture as any).then(() => console.log("seeded quality-cert")).catch((e) => { console.error(e.message); process.exit(1); });
```
`package.json` scripts에 `"db:seed": "tsx scripts/seed.ts"` 추가, devDependencies에 `"tsx": "^4.19.0"` 추가.

- [ ] **Step 2: Playwright 설정과 E2E**

`apps/studio/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", headless: true },
  webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
```

`apps/studio/e2e/editor.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("edit quality-cert: drag updates JSON, JSON updates canvas, undo, pdf", async ({ page }) => {
  await page.goto("/reports/quality-cert");
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-element-id="title"]')).toBeVisible();

  // 캔버스 드래그 → JSON 반영
  const title = canvas.locator('[data-element-id="title"]');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + 96, box.y + 10, { steps: 5 });   // +25.4mm
  await page.mouse.up();
  await expect(page.locator(".monaco-editor")).toContainText('"x": 40.5');   // 15 + 25.5 (0.5mm 스냅)

  // 되돌리기
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".monaco-editor")).toContainText('"x": 15,');

  // JSON 편집 → 캔버스 반영 (title y: 20 → 60)
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Meta+f");
  await page.keyboard.type('"y": 20,');
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type('      "y": 60,');
  await page.waitForTimeout(600);
  const style = await title.getAttribute("style");
  expect(style).toContain("top: 60mm");

  // PDF 응답
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});

test("create A4 landscape and tag reports", async ({ page }) => {
  for (const [id, size, w] of [["land", "297x210", "297mm"], ["tag", "60x40", "60mm"]] as const) {
    await page.goto("/");
    await page.getByLabel("ID").fill(id + Date.now());
    await page.getByLabel("크기").selectOption(size);
    await page.getByRole("button", { name: "새 레포트" }).click();
    await expect(page.getByTestId("canvas").locator(".dp-page")).toHaveCSS("width", /.*/);
    const width = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
    expect(Math.round(parseFloat(width))).toBe(Math.round(parseFloat(w) / 25.4 * 96));
  }
});
```

Monaco 텍스트 조작이 불안정하면 두 번째 블록은 `page.evaluate`로 편집기 모델에 직접 접근한다:
```ts
await page.evaluate(() => { const m = (window as any).monaco.editor.getModels()[0]; m.setValue(m.getValue().replace('"y": 20,', '"y": 60,')); });
```
이를 위해 `JsonEditor.tsx`의 `onMount`에서 `(window as any).monaco = monaco;`를 추가한다.

Run: `pnpm --filter studio exec playwright install chromium && pnpm --filter studio e2e`
Expected: 2 passed. `Meta+z`는 Linux CI에서 `Control+z`로 바꾼다(`process.platform === "darwin" ? "Meta+z" : "Control+z"`).

- [ ] **Step 3: CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @daport/pdf exec playwright install --with-deps chromium
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter studio e2e
```

- [ ] **Step 4: 완료 기준 점검**

스펙 13.3의 다섯 항목을 순서대로 확인하고 결과를 기록한다.

| 기준 | 확인 방법 |
|---|---|
| 1. 캔버스 편집·저장 | E2E 첫 테스트 + 수동 저장 후 새로고침 |
| 2. JSON ↔ 캔버스 양방향 | E2E 첫 테스트 |
| 3. HTML과 PDF 동일 배치 | `pnpm --filter @daport/pdf test` 픽셀 비교 |
| 4. 골든·단위 테스트 CI 통과 | `pnpm test` 전체 녹색 |
| 5. A4 세로/가로, Tag PDF 크기 | `pnpm --filter @daport/pdf test`의 `it.each` + E2E 둘째 테스트 |

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(studio): 품질보증서 시드, Playwright E2E, CI 워크플로"
```

---

## 실행 순서와 의존

Task 1 → 2 → 3 → 4 → 5 (core) → 6 → 7 → 8 → 9 (renderer) → 10 (pdf) → 11 → 12 → 13 → 14 → 15 → 16 → 17 (studio). Task 6은 Task 3 이후면 병렬 가능하고, Task 11은 Task 9 이후 병렬 가능하다. 나머지는 순차.

## 1단계에서 의도적으로 뺀 것

- 표 넘침, 바코드, `ref` 확장: 캔버스에 점선 placeholder로만 표시 (2·3단계).
- 데이터 트리, Oracle: `resolveData`가 `sql`/`http`를 거부 (2단계).
- Cmd+G 그룹화 UI (2단계 컴포넌트 라이브러리와 함께).
- 인증, 버전/배포, Vercel 배포용 Chromium 교체 (4단계).
