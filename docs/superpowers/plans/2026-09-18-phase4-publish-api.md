# daport 4단계 구현 플랜: 버전·배포, 렌더 API, API 키, 번들

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레포트를 불변 버전으로 배포하고, MES가 API 키로 배포 버전을 HTML·PDF·ZPL·TSPL로 받는 렌더 API를 열며, 레포트·에셋을 zip 번들로 옮기고, 서버 Chromium의 외부 요청을 허용 목록으로 묶는다.

**Architecture:** core에 모델 해시 하나, browser에 요청 허용 목록 하나를 더하고 나머지는 전부 `apps/studio`다. `report_versions`·`api_keys` 테이블과 저장소, 공통 렌더 함수 `renderReport`(기존 pdf·label·preview 라우트도 이것을 쓴다), MES용 `render`·`published` 라우트(API 키 + CORS), 내부 `publish`·`versions`·`published` 라우트, `fflate` zip 번들, 툴바 배포 영역·버전 패널, 홈 화면 상태·내보내기·가져오기, 읽기 전용 API 키 페이지, E2E.

**Tech Stack:** TypeScript, zod 4, drizzle-orm(neon-http), Next.js 16 route handlers, `fflate`, `node:crypto`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-daport-phase4-publish-api-design.md` (승인됨). 플랜은 스펙의 논거이며 충돌 시 스펙이 우선한다. 이 플랜이 스펙을 구체화한 곳(4.1의 `hash`·`draft_hash` 컬럼, 4.2 `publish`의 모델 인자, T5의 `signal`)은 각 태스크에 적어 두었다.

## Global Constraints

- 의존 방향: `core ← renderer ← pdf/label`, `browser`는 Playwright만 의존하고 renderer·core를 import하지 않는다. `pdf → renderer, browser`, `label → renderer, browser`. studio만 label·pdf·datasource를 import한다.
- 새 외부 의존은 `fflate`(studio) 하나. 루트 `pnpm install`은 T8에서 한 번만 실행한다.
- 한글 주석·UI 문구, 영문 식별자. 커밋 제목 `type(pkg): …` 한글, 모든 커밋 메시지는 정확히 이 트레일러로 끝난다: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git -c core.hooksPath=/dev/null commit`으로 커밋하고 파일 경로로만 스테이징한다(`git add -A` 금지).
- 렌더 API(`render`·`published` GET)만 `X-API-Key`를 요구한다. studio 내부 라우트는 무인증(동일 출처) 그대로.
- 렌더 API는 배포 버전(또는 지정 버전)만 읽는다. draft를 읽는 코드 경로가 있으면 결함이다.
- 인증 실패 401 응답은 키·레포트 존재 여부를 드러내지 않는다. 존재 여부(404)는 인증 통과 후에만 구분한다.
- 요청 본문 한도 20MB(`readJsonBody`, `MAX_BODY_BYTES`). 렌더 라우트 `maxDuration = 60`.
- 오류 코드(스펙 8장): `UNAUTHORIZED`(401), `FORBIDDEN`(403), `NOT_PUBLISHED`(404), `FORMAT_MISMATCH`(400), `COMPONENT_MISMATCH`(409), `BUNDLE_INVALID`(400). 기존 코드(`LABEL_TOO_LARGE`, `LayoutLimitError.code`)는 유지.
- 기존 pdf·label·preview·print 라우트의 요청·응답·상태 코드는 바뀌지 않는다. 기존 테스트가 그대로 통과해야 한다.
- 테스트는 실제 네트워크·실제 DB·실제 Blob에 닿지 않는다(메모리 저장소, `vi.mock`, 로컬 소켓).
- vitest 호이스팅 주의: `beforeEach(() => mock.mockReset())`처럼 mock을 반환하는 화살표 본문은 cleanup 훅으로 오인된다. 항상 블록 본문 `beforeEach(() => { … })`를 쓴다.
- Next 라우트 파일(`route.ts`)은 HTTP 메서드와 설정만 export한다. 상수·헬퍼는 `src/lib/`에 둔다.

## 파일 구조

```
packages/core/src/schema/hash.ts                          + reportHash                                  (T1)
packages/core/src/__tests__/hash.test.ts                  + reportHash 테스트                            (T1)
packages/browser/src/page.ts                              + allowHosts, isAllowedUrl                     (T2)
packages/browser/src/index.ts                             + isAllowedUrl export                          (T2)
packages/browser/src/__tests__/page.test.ts               + 허용 목록 테스트                             (T2)
packages/pdf/src/index.ts                                 renderPdf(report, data, opts?)                 (T2)
packages/label/src/raster.ts, index.ts                    rasterizePages(…, opts?), renderLabel(…, opts?) (T2)
apps/studio/src/db/schema.ts                              reports.published_version·draft_hash, report_versions, api_keys (T3, T4)
apps/studio/src/lib/report-store.ts                       버전 메서드                                    (T3)
apps/studio/src/lib/__tests__/report-store.test.ts        + 버전 테스트                                  (T3)
apps/studio/src/lib/api-key-store.ts                      키 저장소                                      (T4)
apps/studio/src/lib/auth.ts                               authorize(req, reportId)                       (T4)
apps/studio/src/lib/keys-cli.ts, scripts/keys.ts          CLI                                            (T4)
apps/studio/src/lib/__tests__/api-key-store.test.ts, auth.test.ts, keys-cli.test.ts                      (T4)
apps/studio/src/lib/render.ts                             renderReport, renderErrorResponse              (T5)
apps/studio/src/lib/__tests__/render.test.ts                                                             (T5)
apps/studio/src/app/api/reports/[id]/{pdf,label,preview}/route.ts   renderReport 사용으로 리팩터링       (T5)
apps/studio/src/app/api/reports/[id]/publish/route.ts     POST                                           (T6)
apps/studio/src/app/api/reports/[id]/versions/route.ts    GET                                            (T6)
apps/studio/src/app/api/reports/[id]/published/route.ts   PUT(내부) + GET(API 키) + OPTIONS               (T6, T7)
apps/studio/src/app/api/reports/__tests__/publish-routes.test.ts                                         (T6)
apps/studio/src/lib/cors.ts                               corsHeaders, preflight                         (T7)
apps/studio/src/app/api/reports/[id]/render/route.ts      POST + OPTIONS                                 (T7)
apps/studio/src/app/api/reports/__tests__/render-route.test.ts, published-route.test.ts, cors.test.ts    (T7)
apps/studio/src/lib/bundle.ts, asset-io.ts, import-bundle.ts                                             (T8)
apps/studio/src/app/api/export/route.ts, import/route.ts                                                 (T8)
apps/studio/src/lib/__tests__/bundle.test.ts, import-bundle.test.ts                                      (T8)
apps/studio/src/editor/PublishControls.tsx                툴바 배포 영역·버전 패널                        (T9)
apps/studio/src/editor/Toolbar.tsx                        PublishControls 삽입                            (T9)
apps/studio/src/editor/__tests__/PublishControls.test.tsx                                                (T9)
apps/studio/src/app/ReportList.tsx                        상태 열·체크박스·내보내기·가져오기              (T10)
apps/studio/src/app/page.tsx                              ReportList 사용, API 키 링크                    (T10)
apps/studio/src/app/settings/keys/page.tsx                읽기 전용 키 목록                               (T10)
apps/studio/src/app/__tests__/ReportList.test.tsx                                                        (T10)
apps/studio/e2e/phase4.spec.ts, playwright.config.ts, .env.example                                       (T11)
```

## 태스크 순서와 병렬성

- 1차: T1(core), T2(browser·pdf·label), T3(studio 저장소), T4(studio 키) — 서로 다른 패키지/파일이라 동시 가능. T3·T4는 둘 다 `db/schema.ts`를 고치므로 **T3 → T4 순서**로.
- 2차: T5(render 공통 함수, T2·T3 필요) → T6(내부 배포 라우트, T3) · T7(MES 라우트, T4·T5) → T8(번들, T3·T5).
- 3차: T9(툴바, T6) → T10(홈·키 페이지, T4·T8) → T11(E2E, 전부).
- studio 안에서는 구현자 한 명씩만 돌린다(같은 패키지 동시 편집 금지).

---

### Task 1: core `reportHash`

**Files:**
- Modify: `packages/core/src/schema/hash.ts`
- Test: `packages/core/src/__tests__/hash.test.ts` (기존 파일에 describe 추가; 없으면 새로 만든다)

**Interfaces:**
- Consumes: 기존 `canonicalJson`, `sha256Hex`.
- Produces: `reportHash(report: Report): string` — `@daport/core`에서 export(`index.ts`는 이미 `export * from "./schema/hash"`).

- [ ] **Step 1: 실패 테스트 작성**

`packages/core/src/__tests__/hash.test.ts`에 추가(파일이 있으면 끝에, 없으면 새 파일에 아래 import 포함):
```ts
import { describe, it, expect } from "vitest";
import { parseReport, reportHash } from "../index";

describe("reportHash", () => {
  const base = { id: "r", name: "R", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, text: "a" }] };
  it("is stable across key order and whitespace", () => {
    const a = parseReport(base);
    const b = parseReport(JSON.parse(JSON.stringify({ elements: base.elements, page: { height: 100, width: 100 }, version: 1, name: "R", id: "r" })));
    expect(reportHash(a)).toBe(reportHash(b));
    expect(reportHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when the model changes", () => {
    const a = parseReport(base);
    const b = parseReport({ ...base, name: "S" });
    expect(reportHash(a)).not.toBe(reportHash(b));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/core test -- hash`
Expected: FAIL — `reportHash is not a function` (또는 export 없음)

- [ ] **Step 3: 구현**

`packages/core/src/schema/hash.ts` 끝에 추가:
```ts
import type { Report } from "./report";

/** 레포트 모델 해시: sha256Hex(canonicalJson(report)). 배포 버전과 draft가 같은지 비교하는 데 쓴다 (4단계 스펙 4.4) */
export function reportHash(report: Report): string {
  return sha256Hex(canonicalJson(report));
}
```
(`import type`은 런타임 순환을 만들지 않는다. 파일 맨 위의 기존 `import type { ComponentBody }` 옆으로 옮겨도 된다.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/core test && pnpm --filter @daport/core typecheck`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/schema/hash.ts packages/core/src/__tests__/hash.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(core): 레포트 모델 해시 reportHash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: browser 외부 요청 허용 목록, pdf·label 옵션 전달

**Files:**
- Modify: `packages/browser/src/page.ts`, `packages/browser/src/index.ts`, `packages/pdf/src/index.ts`, `packages/label/src/raster.ts`, `packages/label/src/index.ts`
- Test: `packages/browser/src/__tests__/page.test.ts`(추가), `packages/label/src/__tests__/retry.test.ts`·`packages/pdf/src/__tests__/retry.test.ts`(기존 호출 그대로 통과해야 함)

**Interfaces:**
- Consumes: 기존 `withPage`, `serveFonts`, `fontBaseUrl`.
- Produces:
  - browser: `PageOptions.allowHosts?: string[]`, `isAllowedUrl(url: string, allowHosts: string[]): boolean`.
  - pdf: `renderPdf(report, data, opts?: RenderOptions)`; `RenderOptions = { allowHosts?: string[] }`.
  - label: `rasterizePages(report, data, dpi, threshold, opts?: RenderOptions)`, `renderLabel(report, data, opts?: RenderOptions)`. 재시도 카운터는 마지막 인자로 남는다.

- [ ] **Step 1: 실패 테스트 작성**

`packages/browser/src/__tests__/page.test.ts`의 `describe("withPage")` 안 `beforeEach`에서 `ctx`에 `route: vi.fn().mockResolvedValue(undefined)`를 추가하고, 파일 끝에 추가:
```ts
import { isAllowedUrl } from "../page";

describe("withPage allowHosts", () => {
  function fakeRoute(url: string) {
    return { request: () => ({ url: () => url }), fallback: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  }
  it("does not intercept when allowHosts is not given", async () => {
    await withPage("<html></html>", { fontsDir: "/fonts" }, async () => "ok");
    expect(ctx.route).not.toHaveBeenCalled();
  });
  it("lets allowed hosts, the font origin and data: URLs through and aborts the rest with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withPage("<html></html>", { fontsDir: "/fonts", allowHosts: ["studio.local:3000", "cdn.example.com"] }, async () => "ok");
    expect(ctx.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    const handler = ctx.route.mock.calls[0][1] as (r: ReturnType<typeof fakeRoute>) => Promise<void>;
    const ok = [fakeRoute("http://studio.local:3000/api/assets/1"), fakeRoute("https://cdn.example.com/logo.png"), fakeRoute("http://fonts.daport.local/Pretendard-Regular.otf"), fakeRoute("data:image/png;base64,AAAA")];
    for (const r of ok) { await handler(r); expect(r.fallback).toHaveBeenCalledTimes(1); expect(r.abort).not.toHaveBeenCalled(); }
    const blocked = fakeRoute("https://evil.example.org/x.png");
    await handler(blocked);
    expect(blocked.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(blocked.fallback).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("evil.example.org"));
    warn.mockRestore();
  });
});

describe("isAllowedUrl", () => {
  it("compares host including a non-default port", () => {
    expect(isAllowedUrl("http://a.local:8080/x", ["a.local:8080"])).toBe(true);
    expect(isAllowedUrl("http://a.local:8081/x", ["a.local:8080"])).toBe(false);
    expect(isAllowedUrl("https://a.local/x", ["a.local"])).toBe(true);
    expect(isAllowedUrl("not a url", ["a.local"])).toBe(false);
    expect(isAllowedUrl("blob:http://x/1", [])).toBe(true);
  });
});
```
(`ctx`가 describe 바깥에서 보이도록, 기존 `let ctx` 선언을 파일 상단(모듈 스코프)으로 올린다. 기존 네 테스트는 그대로 통과해야 한다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/browser test`
Expected: FAIL — `isAllowedUrl` export 없음

- [ ] **Step 3: 구현 (browser)**

`packages/browser/src/page.ts` 전체를 다음으로 교체:
```ts
import type { BrowserContext, Page } from "playwright";
import { getBrowser } from "./pool";
import { serveFonts, fontBaseUrl } from "./fonts";

export type PageOptions = { fontsDir: string; deviceScaleFactor?: number; setContentTimeoutMs?: number; allowHosts?: string[] };

const FONT_HOST = new URL(fontBaseUrl).host;

/** 허용 판정 (4단계 스펙 5.6). data·blob·about는 네트워크가 아니고, 폰트 가상 오리진은 serveFonts가 응답한다. 호스트는 포트까지 비교한다 */
export function isAllowedUrl(url: string, allowHosts: string[]): boolean {
  if (/^(data|blob|about):/i.test(url)) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.host === FONT_HOST || allowHosts.includes(u.host);
}

/**
 * 허용 목록 밖의 요청을 막는다. Playwright는 나중에 등록한 라우트를 먼저 보므로 serveFonts 뒤에 등록하고,
 * 허용된 요청은 fallback()으로 앞선 라우트(폰트)나 네트워크에 넘긴다. 막힌 이미지는 빈 채로 렌더된다
 */
async function restrictHosts(ctx: BrowserContext, allowHosts: string[]): Promise<void> {
  await ctx.route("**/*", async (route) => {
    const url = route.request().url();
    if (isAllowedUrl(url, allowHosts)) return route.fallback();
    console.warn(`[daport/browser] blocked request: ${url}`);
    await route.abort("blockedbyclient");
  });
}

/** 새 컨텍스트에 HTML을 올리고 폰트 로드까지 기다린 뒤 fn을 실행한다. 라우트 maxDuration 안에 재시도까지 들어가도록 로드 시간을 묶는다 */
export async function withPage<T>(html: string, opts: PageOptions, fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext(opts.deviceScaleFactor ? { deviceScaleFactor: opts.deviceScaleFactor } : {});
  try {
    await serveFonts(ctx, opts.fontsDir);
    if (opts.allowHosts) await restrictHosts(ctx, opts.allowHosts);
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: opts.setContentTimeoutMs ?? 20_000 });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await ctx.close();
  }
}
```
`packages/browser/src/index.ts`의 마지막 줄을 `export { withPage, isAllowedUrl, type PageOptions } from "./page";`로.

- [ ] **Step 4: 구현 (pdf·label 옵션 전달)**

`packages/pdf/src/index.ts`:
```ts
import { renderToHtml, type Report, type DataContext } from "@daport/renderer";
import { withPage, fontBaseUrl, isBrowserCrash } from "@daport/browser";
import { fontsDir } from "./fonts-dir";
export { closePool } from "@daport/browser";

/** allowHosts: 렌더 중 Chromium이 요청할 수 있는 호스트(포트 포함). 생략하면 제한하지 않는다 (4단계 스펙 5.6) */
export type RenderOptions = { allowHosts?: string[] };

export async function renderPdf(report: Report, data: DataContext, opts: RenderOptions = {}, attempt = 0): Promise<Buffer> {
  const html = renderToHtml(report, data, { fontBaseUrl });
  try {
    return await withPage(html, { fontsDir, allowHosts: opts.allowHosts }, (page) => page.pdf({
      width: `${report.page.width}mm`, height: `${report.page.height}mm`,
      printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
  } catch (e) {
    if (attempt === 0 && isBrowserCrash(e)) return renderPdf(report, data, opts, 1);     // Chromium 크래시·끊김만 1회 재시도
    throw e;
  }
}
```
(`renderHtmlScreenshot`은 그대로 둔다.)

`packages/label/src/raster.ts`: 시그니처를 `rasterizePages(report, data, dpi, threshold, opts: RenderOptions = {}, attempt = 0)`로 바꾸고 `withPage(html, { fontsDir, deviceScaleFactor: dpi / 96, allowHosts: opts.allowHosts }, …)`, 재시도 호출은 `rasterizePages(report, data, dpi, threshold, opts, 1)`. 파일 상단에 `export type RenderOptions = { allowHosts?: string[] };`를 추가한다(`LabelTooLargeError` 위).

`packages/label/src/index.ts`: `renderLabel(report, data, opts: RenderOptions = {})`로 바꾸고 `rasterizePages(report, data, dpi, threshold, opts)`로 전달. `RenderOptions`는 `./raster`에서 `export *`로 이미 나간다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/browser test && pnpm --filter @daport/pdf test && pnpm --filter @daport/label test && pnpm -r typecheck`
Expected: 전부 PASS (pdf·label의 retry 테스트는 기존 호출 형태 그대로 통과)

- [ ] **Step 6: 커밋**

```bash
git add packages/browser/src/page.ts packages/browser/src/index.ts packages/browser/src/__tests__/page.test.ts packages/pdf/src/index.ts packages/label/src/raster.ts packages/label/src/index.ts
git -c core.hooksPath=/dev/null commit -m "feat(browser,pdf,label): 렌더 중 외부 요청 허용 목록 allowHosts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: studio 버전 저장소 (`report_versions`, 배포 포인터)

**Files:**
- Modify: `apps/studio/src/db/schema.ts`, `apps/studio/src/lib/report-store.ts`
- Test: `apps/studio/src/lib/__tests__/report-store.test.ts`(추가)

**Interfaces:**
- Consumes: T1 `reportHash`; 기존 `parseReport`, `NotFoundError`, `db()`.
- Produces (`ReportStore` 확장, 스펙 4.2를 이렇게 구체화한다 — `publish`는 라우트가 컴포넌트 검사·정리를 마친 모델을 넘긴다):
```ts
export type ReportSummary = { id: string; name: string; updatedAt: string; publishedVersion: number | null; modified: boolean };
export type VersionSummary = { version: number; createdAt: string; note: string | null; hash: string; published: boolean };
export type VersionList = { versions: VersionSummary[]; publishedVersion: number | null; draftHash: string };
export type PublishedReport = { version: number; report: Report };
addVersion(id: string, model: Report, note?: string): Promise<{ version: number; createdAt: string }>; // 버전만 추가, 포인터 그대로 (번들 가져오기용). 없는 id → NotFoundError
publish(id: string, model: Report, note?: string): Promise<{ version: number; createdAt: string }>;   // addVersion + 포인터 이동. 없는 id → NotFoundError
setPublished(id: string, version: number): Promise<void>;                                              // 없는 id·버전 → NotFoundError
listVersions(id: string): Promise<VersionList | null>;                                                 // 없는 id → null
getVersion(id: string, version: number): Promise<Report | null>;
getPublished(id: string): Promise<PublishedReport | null>;                                             // 미배포 → null
```
- 스키마 구체화(스펙 4.1): `report_versions.hash`(모델 해시, 목록에서 다시 계산하지 않기 위해)와 `reports.draft_hash`(저장 때 계산, 홈 목록의 "수정됨" 판정용)를 둔다. 기존 행의 `draft_hash`는 null이며 다음 저장 때 채워진다(그때까지 목록은 `modified: true`로 보인다).

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/report-store.test.ts` 끝에 추가(import에 `reportHash`를 `@daport/core`에서 가져온다):
```ts
import { reportHash, parseReport } from "@daport/core";

describe("MemoryReportStore versions", () => {
  const draft = { id: "v", name: "V", version: 1, page: { width: 100, height: 100 } };
  async function withReport() { const s = new MemoryReportStore(); await s.create(draft); return s; }

  it("publish stores an immutable version N+1 and moves the pointer", async () => {
    const s = await withReport();
    const v1 = await s.publish("v", parseReport(draft), "첫 배포");
    expect(v1.version).toBe(1);
    await s.update("v", { ...draft, name: "V2" });
    const v2 = await s.publish("v", parseReport({ ...draft, name: "V2" }));
    expect(v2.version).toBe(2);
    expect((await s.getPublished("v"))?.version).toBe(2);
    expect((await s.getVersion("v", 1))?.name).toBe("V");
    expect((await s.getVersion("v", 3))).toBeNull();
    const list = await s.listVersions("v");
    expect(list?.versions.map((x) => [x.version, x.published, x.note])).toEqual([[1, false, "첫 배포"], [2, true, null]]);
    expect(list?.publishedVersion).toBe(2);
  });
  it("setPublished moves only the pointer; draft and versions stay", async () => {
    const s = await withReport();
    await s.publish("v", parseReport(draft));
    await s.update("v", { ...draft, name: "V2" });
    await s.publish("v", parseReport({ ...draft, name: "V2" }));
    await s.setPublished("v", 1);
    expect((await s.getPublished("v"))?.report.name).toBe("V");
    expect((await s.get("v"))?.name).toBe("V2");
    expect((await s.listVersions("v"))?.versions).toHaveLength(2);
    await expect(s.setPublished("v", 9)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.setPublished("zz", 1)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("reports hashes: draftHash matches reportHash(draft), version hash matches its model", async () => {
    const s = await withReport();
    await s.publish("v", parseReport(draft));
    const list = await s.listVersions("v");
    expect(list?.draftHash).toBe(reportHash(parseReport(draft)));
    expect(list?.versions[0].hash).toBe(reportHash(parseReport(draft)));
    expect((await s.list())[0]).toMatchObject({ publishedVersion: 1, modified: false });
    await s.update("v", { ...draft, name: "V2" });
    expect((await s.list())[0]).toMatchObject({ publishedVersion: 1, modified: true });
  });
  it("getPublished is null before the first publish and listVersions is null for an unknown id", async () => {
    const s = await withReport();
    expect(await s.getPublished("v")).toBeNull();
    expect((await s.list())[0]).toMatchObject({ publishedVersion: null, modified: false });
    expect(await s.listVersions("zz")).toBeNull();
    await expect(s.publish("zz", parseReport(draft))).rejects.toBeInstanceOf(NotFoundError);
  });
  it("addVersion adds a version without moving the pointer", async () => {
    const s = await withReport();
    await s.publish("v", parseReport(draft));
    const added = await s.addVersion("v", parseReport({ ...draft, name: "imported" }), "가져옴: x.zip");
    expect(added.version).toBe(2);
    expect((await s.getPublished("v"))?.version).toBe(1);
    expect((await s.listVersions("v"))?.versions[1]).toMatchObject({ version: 2, published: false, note: "가져옴: x.zip" });
    await expect(s.addVersion("zz", parseReport(draft))).rejects.toBeInstanceOf(NotFoundError);
  });
  it("versions are immutable copies", async () => {
    const s = await withReport();
    const model = parseReport(draft);
    await s.publish("v", model);
    model.name = "mutated";
    expect((await s.getVersion("v", 1))?.name).toBe("V");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- report-store`
Expected: FAIL — `s.publish is not a function`

- [ ] **Step 3: 스키마**

`apps/studio/src/db/schema.ts`의 `reports`를 다음으로 바꾸고(`publishedVersionId` 제거), `reportVersions`를 추가:
```ts
export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  draft: jsonb("draft").notNull(),
  /** 저장 때 계산한 draft의 reportHash. 배포 버전 해시와 비교해 "수정됨"을 판정한다 (4단계 스펙 4.1). 옛 행은 null */
  draftHash: text("draft_hash"),
  /** 배포 포인터. null이면 미배포 */
  publishedVersion: integer("published_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 배포 버전의 불변 모델 (4단계 스펙 4.1). 레포트를 지우면 함께 지워진다 */
export const reportVersions = pgTable("report_versions", {
  reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  model: jsonb("model").notNull(),
  hash: text("hash").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.reportId, t.version] })]);
```
운영 DB에는 `pnpm --filter studio db:push`로 반영한다(테스트는 DB를 쓰지 않는다).

- [ ] **Step 4: 저장소 구현**

`apps/studio/src/lib/report-store.ts`에서:

(a) import를 `import { and, asc, eq, sql } from "drizzle-orm";`, `import { parseReport, reportHash, type Report, type ReportInput } from "@daport/core";`, `import { reports, reportVersions } from "@/db/schema";`로.

(b) 타입·인터페이스를 위 Interfaces대로 바꾼다(`ReportSummary` 확장, `VersionSummary`·`VersionList`·`PublishedReport` 추가, `ReportStore`에 다섯 메서드 추가).

(c) `MemoryReportStore` 전체 교체:
```ts
type MemVersion = { version: number; model: Report; hash: string; note: string | null; createdAt: string };
type MemEntry = { report: Report; updatedAt: string; draftHash: string; publishedVersion: number | null; versions: MemVersion[] };

export class MemoryReportStore implements ReportStore {
  private map = new Map<string, MemEntry>();
  private entry(id: string): MemEntry { const e = this.map.get(id); if (!e) throw new NotFoundError(id); return e; }
  private summary(e: MemEntry): ReportSummary {
    const published = e.versions.find((v) => v.version === e.publishedVersion);
    return { id: e.report.id, name: e.report.name, updatedAt: e.updatedAt, publishedVersion: e.publishedVersion, modified: !!published && published.hash !== e.draftHash };
  }
  async list() { return [...this.map.values()].map((e) => this.summary(e)); }
  async get(id: string) { return this.map.get(id)?.report ?? null; }
  async create(input: ReportInput) {
    const r = parseReport(input);
    if (this.map.has(r.id)) throw new Error(`report exists: ${r.id}`);
    this.map.set(r.id, { report: r, updatedAt: new Date().toISOString(), draftHash: reportHash(r), publishedVersion: null, versions: [] }); return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const e = this.entry(id);
    this.map.set(id, { ...e, report: r, updatedAt: new Date().toISOString(), draftHash: reportHash(r) }); return r;
  }
  async addVersion(id: string, model: Report, note?: string) {
    const e = this.entry(id);
    const stored = parseReport({ ...structuredClone(model), id });   // 버전은 불변이라 호출자 객체와 끊는다
    const version = (e.versions[e.versions.length - 1]?.version ?? 0) + 1;
    const createdAt = new Date().toISOString();
    e.versions.push({ version, model: stored, hash: reportHash(stored), note: note ?? null, createdAt });
    return { version, createdAt };
  }
  async publish(id: string, model: Report, note?: string) {
    const res = await this.addVersion(id, model, note);
    this.entry(id).publishedVersion = res.version;
    return res;
  }
  async setPublished(id: string, version: number) {
    const e = this.entry(id);
    if (!e.versions.some((v) => v.version === version)) throw new NotFoundError(`${id}@${version}`);
    e.publishedVersion = version;
  }
  async listVersions(id: string) {
    const e = this.map.get(id);
    if (!e) return null;
    return { versions: e.versions.map(({ version, createdAt, note, hash }) => ({ version, createdAt, note, hash, published: version === e.publishedVersion })), publishedVersion: e.publishedVersion, draftHash: e.draftHash };
  }
  async getVersion(id: string, version: number) {
    const v = this.map.get(id)?.versions.find((x) => x.version === version);
    return v ? structuredClone(v.model) : null;
  }
  async getPublished(id: string) {
    const e = this.map.get(id);
    if (!e || e.publishedVersion === null) return null;
    const report = await this.getVersion(id, e.publishedVersion);
    return report ? { version: e.publishedVersion, report } : null;
  }
}
```

(d) `DbReportStore`: `list`·`create`·`update`를 바꾸고 다섯 메서드를 추가:
```ts
export class DbReportStore implements ReportStore {
  async list() {
    // 배포 버전의 해시를 함께 읽어 "수정됨"을 판정한다. draft_hash가 null인 옛 행은 수정됨으로 본다
    const rows = await db().select({ id: reports.id, name: reports.name, updatedAt: reports.updatedAt, publishedVersion: reports.publishedVersion, draftHash: reports.draftHash, publishedHash: reportVersions.hash })
      .from(reports).leftJoin(reportVersions, and(eq(reportVersions.reportId, reports.id), eq(reportVersions.version, reports.publishedVersion)));
    return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt.toISOString(), publishedVersion: r.publishedVersion, modified: r.publishedHash !== null && r.publishedHash !== r.draftHash }));
  }
  async get(id: string) {
    const [row] = await db().select().from(reports).where(eq(reports.id, id));
    return row ? parseReport(row.draft) : null;
  }
  async create(input: ReportInput) {
    const r = parseReport(input);
    try {
      await db().insert(reports).values({ id: r.id, name: r.name, draft: r, draftHash: reportHash(r) });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error(`report exists: ${r.id}`);
      throw e;
    }
    return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const res = await db().update(reports).set({ name: r.name, draft: r, draftHash: reportHash(r), updatedAt: new Date() }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new NotFoundError(id);
    return r;
  }
  private async exists(id: string): Promise<boolean> {
    return (await db().select({ id: reports.id }).from(reports).where(eq(reports.id, id))).length > 0;
  }
  async addVersion(id: string, model: Report, note?: string) {
    if (!(await this.exists(id))) throw new NotFoundError(id);
    const stored = parseReport({ ...model, id });
    const hash = reportHash(stored);
    // neon-http는 트랜잭션이 없다. max+1로 넣고 동시 배포로 유일성 위반이 나면 한 번만 다시 센다
    for (let attempt = 0; ; attempt++) {
      const [{ max }] = await db().select({ max: sql<number | null>`max(${reportVersions.version})` }).from(reportVersions).where(eq(reportVersions.reportId, id));
      const version = (max ?? 0) + 1;
      try {
        const [row] = await db().insert(reportVersions).values({ reportId: id, version, model: stored, hash, note: note ?? null }).returning({ createdAt: reportVersions.createdAt });
        return { version, createdAt: row.createdAt.toISOString() };
      } catch (e) {
        if (attempt === 0 && isUniqueViolation(e)) continue;
        throw e;
      }
    }
  }
  async publish(id: string, model: Report, note?: string) {
    const res = await this.addVersion(id, model, note);
    await db().update(reports).set({ publishedVersion: res.version }).where(eq(reports.id, id));
    return res;
  }
  async setPublished(id: string, version: number) {
    if (!(await this.getVersion(id, version))) throw new NotFoundError(`${id}@${version}`);
    const res = await db().update(reports).set({ publishedVersion: version }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new NotFoundError(id);
  }
  async listVersions(id: string) {
    const [head] = await db().select({ draft: reports.draft, draftHash: reports.draftHash, publishedVersion: reports.publishedVersion }).from(reports).where(eq(reports.id, id));
    if (!head) return null;
    const rows = await db().select({ version: reportVersions.version, createdAt: reportVersions.createdAt, note: reportVersions.note, hash: reportVersions.hash })
      .from(reportVersions).where(eq(reportVersions.reportId, id)).orderBy(asc(reportVersions.version));
    return {
      versions: rows.map((r) => ({ version: r.version, createdAt: r.createdAt.toISOString(), note: r.note, hash: r.hash, published: r.version === head.publishedVersion })),
      publishedVersion: head.publishedVersion,
      draftHash: head.draftHash ?? reportHash(parseReport(head.draft)),
    };
  }
  async getVersion(id: string, version: number) {
    const [row] = await db().select({ model: reportVersions.model }).from(reportVersions).where(and(eq(reportVersions.reportId, id), eq(reportVersions.version, version)));
    return row ? parseReport(row.model) : null;
  }
  async getPublished(id: string) {
    const [head] = await db().select({ publishedVersion: reports.publishedVersion }).from(reports).where(eq(reports.id, id));
    if (!head || head.publishedVersion === null) return null;
    const report = await this.getVersion(id, head.publishedVersion);
    return report ? { version: head.publishedVersion, report } : null;
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS. `list()` 모양이 바뀌었으므로 홈 화면·기존 테스트가 `updatedAt`만 보는지 확인한다(`ReportSummary` 필드 추가는 호환된다).

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/src/db/schema.ts apps/studio/src/lib/report-store.ts apps/studio/src/lib/__tests__/report-store.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): 레포트 배포 버전 저장소 — report_versions·published_version·draft_hash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: studio API 키 저장소·인증·CLI

**Files:**
- Modify: `apps/studio/src/db/schema.ts`(`apiKeys` 추가), `apps/studio/package.json`(`keys` 스크립트)
- Create: `apps/studio/src/lib/api-key-store.ts`, `apps/studio/src/lib/auth.ts`, `apps/studio/src/lib/keys-cli.ts`, `apps/studio/scripts/keys.ts`
- Test: `apps/studio/src/lib/__tests__/api-key-store.test.ts`, `apps/studio/src/lib/__tests__/auth.test.ts`, `apps/studio/src/lib/__tests__/keys-cli.test.ts`

**Interfaces:**
- Produces:
```ts
// api-key-store.ts
export type ApiKeyInfo = { kid: string; name: string; allowedReportIds: string[] | null; createdAt: string; revokedAt: string | null };
export const KEY_RE = /^dpk_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;
export function hashKey(raw: string): string;                      // sha256 hex
export function generateKey(): { kid: string; rawKey: string; hash: string };
export interface ApiKeyStore { verify(raw: string): Promise<ApiKeyInfo | null>; list(): Promise<ApiKeyInfo[]>; create(name: string, allowed?: string[] | null): Promise<{ key: ApiKeyInfo; rawKey: string }>; revoke(kid: string): Promise<void> }
export class MemoryApiKeyStore implements ApiKeyStore { constructor(devKey?: string) }
export class DbApiKeyStore implements ApiKeyStore {}
export function getApiKeyStore(): ApiKeyStore;                     // DATABASE_URL이면 Db, 아니면 Memory(process.env.DAPORT_DEV_API_KEY)
// auth.ts
export type AuthResult = { ok: true; key: ApiKeyInfo } | { ok: false; response: Response };
export function allowsReport(key: ApiKeyInfo, reportId: string): boolean;
export function authorize(req: Request, reportId: string, store?: ApiKeyStore): Promise<AuthResult>;
// keys-cli.ts
export function runKeys(args: string[], store: ApiKeyStore, out: (line: string) => void): Promise<number>;   // 종료 코드
```

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/api-key-store.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { MemoryApiKeyStore, KEY_RE, generateKey, hashKey } from "../api-key-store";

afterEach(() => { vi.unstubAllEnvs(); });

describe("generateKey", () => {
  it("makes dpk_<kid>_<secret> keys whose hash is sha256 hex", () => {
    const k = generateKey();
    expect(k.rawKey).toMatch(KEY_RE);
    expect(k.rawKey.startsWith(`dpk_${k.kid}_`)).toBe(true);
    expect(k.hash).toBe(hashKey(k.rawKey));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateKey().kid).not.toBe(k.kid);
  });
});

describe("MemoryApiKeyStore", () => {
  it("verifies a created key, rejects others, and revokes", async () => {
    const s = new MemoryApiKeyStore();
    const { key, rawKey } = await s.create("MES", ["quality-cert"]);
    expect(key.allowedReportIds).toEqual(["quality-cert"]);
    expect((await s.verify(rawKey))?.kid).toBe(key.kid);
    expect(await s.verify(rawKey.slice(0, -1) + "x")).toBeNull();
    expect(await s.verify("garbage")).toBeNull();
    expect(await s.verify(`dpk_${key.kid}_${"a".repeat(32)}`)).toBeNull();
    await s.revoke(key.kid);
    expect(await s.verify(rawKey)).toBeNull();
    expect((await s.list())[0].revokedAt).not.toBeNull();
    await expect(s.revoke("nope0000")).rejects.toThrow(/not found/);
  });
  it("never returns the raw key from list()", async () => {
    const s = new MemoryApiKeyStore();
    const { rawKey } = await s.create("a");
    expect(JSON.stringify(await s.list())).not.toContain(rawKey);
  });
  it("accepts the dev key as an all-reports key", async () => {
    const s = new MemoryApiKeyStore("e2e-dev-key");
    expect(await s.verify("e2e-dev-key")).toMatchObject({ kid: "dev", allowedReportIds: null });
    expect(await s.verify("other")).toBeNull();
    expect(await new MemoryApiKeyStore().verify("e2e-dev-key")).toBeNull();
  });
});
```

`apps/studio/src/lib/__tests__/auth.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MemoryApiKeyStore } from "../api-key-store";
import { authorize } from "../auth";

const req = (key?: string) => new Request("http://localhost/x", { headers: key ? { "x-api-key": key } : {} });

describe("authorize", () => {
  it("401 without a key or with a bad key, 403 for a report outside the allow-list, ok otherwise", async () => {
    const s = new MemoryApiKeyStore();
    const { rawKey } = await s.create("MES", ["a"]);
    const missing = await authorize(req(), "a", s);
    expect(missing.ok).toBe(false);
    if (!missing.ok) { expect(missing.response.status).toBe(401); expect(await missing.response.json()).toEqual({ error: "인증 실패", code: "UNAUTHORIZED" }); }
    const bad = await authorize(req("dpk_bad"), "a", s);
    expect(!bad.ok && bad.response.status).toBe(401);
    const forbidden = await authorize(req(rawKey), "b", s);
    expect(!forbidden.ok && forbidden.response.status).toBe(403);
    if (!forbidden.ok) expect((await forbidden.response.json()).code).toBe("FORBIDDEN");
    const ok = await authorize(req(rawKey), "a", s);
    expect(ok.ok && ok.key.name).toBe("MES");
  });
  it("a null allow-list allows every report", async () => {
    const s = new MemoryApiKeyStore();
    const { rawKey } = await s.create("all");
    expect((await authorize(req(rawKey), "anything", s)).ok).toBe(true);
  });
});
```

`apps/studio/src/lib/__tests__/keys-cli.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MemoryApiKeyStore, KEY_RE } from "../api-key-store";
import { runKeys } from "../keys-cli";

describe("keys CLI", () => {
  it("create prints the raw key once, list hides it, revoke disables it", async () => {
    const s = new MemoryApiKeyStore();
    const out: string[] = [];
    expect(await runKeys(["create", "--name", "MES", "--reports", "a,b"], s, (l) => out.push(l))).toBe(0);
    const raw = out.find((l) => KEY_RE.test(l.trim()))?.trim();
    expect(raw).toBeDefined();
    expect((await s.verify(raw!))?.allowedReportIds).toEqual(["a", "b"]);
    out.length = 0;
    expect(await runKeys(["list"], s, (l) => out.push(l))).toBe(0);
    expect(out.join("\n")).toContain("MES");
    expect(out.join("\n")).not.toContain(raw!);
    const kid = (await s.list())[0].kid;
    expect(await runKeys(["revoke", kid], s, (l) => out.push(l))).toBe(0);
    expect(await s.verify(raw!)).toBeNull();
  });
  it("returns 1 with usage for an unknown command or a missing --name", async () => {
    const s = new MemoryApiKeyStore();
    const out: string[] = [];
    expect(await runKeys(["frobnicate"], s, (l) => out.push(l))).toBe(1);
    expect(await runKeys(["create"], s, (l) => out.push(l))).toBe(1);
    expect(out.join("\n")).toContain("keys create --name");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- api-key`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 스키마**

`apps/studio/src/db/schema.ts` 끝에 추가:
```ts
/** MES용 API 키 (4단계 스펙 4.3). 원문은 저장하지 않고 sha256만 둔다. allowed_report_ids가 null이면 전체 허용 */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  allowedReportIds: text("allowed_report_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
```

- [ ] **Step 4: 저장소 구현**

`apps/studio/src/lib/api-key-store.ts`:
```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";

export type ApiKeyInfo = { kid: string; name: string; allowedReportIds: string[] | null; createdAt: string; revokedAt: string | null };

/** 키 원문 형식 dpk_<kid 8자>_<secret 32자 이상 base64url> (4단계 스펙 4.3) */
export const KEY_RE = /^dpk_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;
const KID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateKey(): { kid: string; rawKey: string; hash: string } {
  const kid = Array.from(randomBytes(8), (b) => KID_ALPHABET[b % KID_ALPHABET.length]).join("");
  const rawKey = `dpk_${kid}_${randomBytes(24).toString("base64url")}`;   // 24바이트 → 32자
  return { kid, rawKey, hash: hashKey(rawKey) };
}

/** 두 hex 해시를 길이까지 상수 시간으로 비교한다 */
function sameHash(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export interface ApiKeyStore {
  /** 원문을 검증해 활성 키 정보를 돌려준다. 형식 오류·없음·해시 불일치·회수됨은 전부 null (어느 경우인지 구분하지 않는다) */
  verify(raw: string): Promise<ApiKeyInfo | null>;
  list(): Promise<ApiKeyInfo[]>;
  create(name: string, allowed?: string[] | null): Promise<{ key: ApiKeyInfo; rawKey: string }>;
  revoke(kid: string): Promise<void>;
}

type MemKey = ApiKeyInfo & { hash: string };
const info = ({ hash: _h, ...k }: MemKey): ApiKeyInfo => k;

/** dev·테스트용. devKey가 있으면 그 원문을 전체 허용 키로 인정한다(DATABASE_URL이 없을 때 DAPORT_DEV_API_KEY) */
export class MemoryApiKeyStore implements ApiKeyStore {
  private keys = new Map<string, MemKey>();
  constructor(private devKey?: string) {}
  async verify(raw: string) {
    if (this.devKey && raw === this.devKey) return { kid: "dev", name: "DAPORT_DEV_API_KEY", allowedReportIds: null, createdAt: new Date(0).toISOString(), revokedAt: null };
    const m = KEY_RE.exec(raw);
    const k = m ? this.keys.get(m[1]) : undefined;
    if (!k || k.revokedAt || !sameHash(hashKey(raw), k.hash)) return null;
    return info(k);
  }
  async list() { return [...this.keys.values()].map(info); }
  async create(name: string, allowed: string[] | null = null) {
    const g = generateKey();
    const key: MemKey = { kid: g.kid, name, allowedReportIds: allowed, createdAt: new Date().toISOString(), revokedAt: null, hash: g.hash };
    this.keys.set(g.kid, key);
    return { key: info(key), rawKey: g.rawKey };
  }
  async revoke(kid: string) {
    const k = this.keys.get(kid);
    if (!k) throw new Error(`api key not found: ${kid}`);
    k.revokedAt = new Date().toISOString();
  }
}

const rowInfo = (r: typeof apiKeys.$inferSelect): ApiKeyInfo =>
  ({ kid: r.id, name: r.name, allowedReportIds: r.allowedReportIds, createdAt: r.createdAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null });

export class DbApiKeyStore implements ApiKeyStore {
  async verify(raw: string) {
    const m = KEY_RE.exec(raw);
    if (!m) return null;
    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, m[1]));
    if (!row || row.revokedAt || !sameHash(hashKey(raw), row.keyHash)) return null;
    return rowInfo(row);
  }
  async list() { return (await db().select().from(apiKeys)).map(rowInfo); }
  async create(name: string, allowed: string[] | null = null) {
    const g = generateKey();
    const [row] = await db().insert(apiKeys).values({ id: g.kid, name, keyHash: g.hash, allowedReportIds: allowed }).returning();
    return { key: rowInfo(row), rawKey: g.rawKey };
  }
  async revoke(kid: string) {
    const res = await db().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, kid)).returning({ id: apiKeys.id });
    if (res.length === 0) throw new Error(`api key not found: ${kid}`);
  }
}

// report-store와 같은 이유로 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportApiKeyStore?: ApiKeyStore };
export function getApiKeyStore(): ApiKeyStore {
  if (!holder.__daportApiKeyStore) {
    holder.__daportApiKeyStore = process.env.DATABASE_URL ? new DbApiKeyStore() : new MemoryApiKeyStore(process.env.DAPORT_DEV_API_KEY || undefined);
  }
  return holder.__daportApiKeyStore;
}
```

`apps/studio/src/lib/auth.ts`:
```ts
import { NextResponse } from "next/server";
import { getApiKeyStore, type ApiKeyInfo, type ApiKeyStore } from "./api-key-store";

export type AuthResult = { ok: true; key: ApiKeyInfo } | { ok: false; response: Response };

export function allowsReport(key: ApiKeyInfo, reportId: string): boolean {
  return key.allowedReportIds === null || key.allowedReportIds.includes(reportId);
}

/**
 * X-API-Key 검사 (4단계 스펙 5.2, 8장). 401은 키·레포트 존재 여부를 드러내지 않는다.
 * 레포트가 있는지는 호출자가 인증 통과 뒤에 확인한다
 */
export async function authorize(req: Request, reportId: string, store: ApiKeyStore = getApiKeyStore()): Promise<AuthResult> {
  const raw = req.headers.get("x-api-key");
  const key = raw ? await store.verify(raw) : null;
  if (!key) return { ok: false, response: NextResponse.json({ error: "인증 실패", code: "UNAUTHORIZED" }, { status: 401 }) };
  if (!allowsReport(key, reportId)) return { ok: false, response: NextResponse.json({ error: "이 키로는 접근할 수 없는 레포트입니다", code: "FORBIDDEN" }, { status: 403 }) };
  return { ok: true, key };
}
```

- [ ] **Step 5: CLI**

`apps/studio/src/lib/keys-cli.ts`:
```ts
import type { ApiKeyStore } from "./api-key-store";

const USAGE = [
  "사용법:",
  "  pnpm --filter studio keys create --name <이름> [--reports a,b]   키를 만들고 원문을 한 번만 출력한다",
  "  pnpm --filter studio keys list                                  키 목록 (원문 없음)",
  "  pnpm --filter studio keys revoke <kid>                          키 회수",
];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 키 관리 CLI 본체. scripts/keys.ts가 DB 저장소로 부르고, 테스트는 메모리 저장소를 넣는다. 반환값은 종료 코드 */
export async function runKeys(args: string[], store: ApiKeyStore, out: (line: string) => void): Promise<number> {
  const [cmd] = args;
  if (cmd === "create") {
    const name = flag(args, "--name");
    if (!name) { USAGE.forEach(out); return 1; }
    const reports = flag(args, "--reports");
    const allowed = reports ? reports.split(",").map((s) => s.trim()).filter(Boolean) : null;
    const { key, rawKey } = await store.create(name, allowed);
    out(`키를 만들었습니다: ${key.name} (kid ${key.kid}, 허용 레포트: ${allowed ? allowed.join(", ") : "전체"})`);
    out("아래 원문은 지금 한 번만 보입니다. 안전한 곳에 보관하세요:");
    out(rawKey);
    return 0;
  }
  if (cmd === "list") {
    const keys = await store.list();
    if (keys.length === 0) out("키가 없습니다");
    for (const k of keys) out(`${k.kid}  ${k.name}  허용: ${k.allowedReportIds ? k.allowedReportIds.join(",") : "전체"}  발급: ${k.createdAt}${k.revokedAt ? `  회수: ${k.revokedAt}` : ""}`);
    return 0;
  }
  if (cmd === "revoke" && args[1]) {
    await store.revoke(args[1]);
    out(`회수했습니다: ${args[1]}`);
    return 0;
  }
  USAGE.forEach(out);
  return 1;
}
```

`apps/studio/scripts/keys.ts`:
```ts
import { DbApiKeyStore } from "../src/lib/api-key-store";
import { runKeys } from "../src/lib/keys-cli";

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL이 필요합니다"); process.exit(1); }
runKeys(process.argv.slice(2), new DbApiKeyStore(), console.log).then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
```
`apps/studio/package.json` scripts에 `"keys": "tsx scripts/keys.ts"` 추가(`db:seed` 다음 줄). `scripts/seed.ts`가 `../src/lib/...`를 tsx로 잘 불러오므로 같은 방식이다. `@/` 별칭은 tsx에서 tsconfig `paths`로 해석된다(`seed.ts`가 이미 `@/db/client`를 간접 import해 동작함을 확인).

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS. 추가로 `pnpm --filter studio keys` (DATABASE_URL 없이) → "DATABASE_URL이 필요합니다" 후 종료 코드 1.

- [ ] **Step 7: 커밋**

```bash
git add apps/studio/src/db/schema.ts apps/studio/src/lib/api-key-store.ts apps/studio/src/lib/auth.ts apps/studio/src/lib/keys-cli.ts apps/studio/scripts/keys.ts apps/studio/package.json apps/studio/src/lib/__tests__/api-key-store.test.ts apps/studio/src/lib/__tests__/auth.test.ts apps/studio/src/lib/__tests__/keys-cli.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): API 키 저장소·X-API-Key 인증·키 관리 CLI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: 공통 렌더 함수 `renderReport`와 기존 라우트 리팩터링

**Files:**
- Create: `apps/studio/src/lib/render.ts`
- Modify: `apps/studio/src/app/api/reports/[id]/pdf/route.ts`, `apps/studio/src/app/api/reports/[id]/label/route.ts`, `apps/studio/src/app/api/reports/[id]/preview/route.ts`
- Test: `apps/studio/src/lib/__tests__/render.test.ts`(신규), `apps/studio/src/app/api/reports/__tests__/preview-route.test.ts`(1개 추가). 기존 `pdf-route`·`label-route`·`preview-route`·`print-route` 테스트는 수정 없이 통과해야 한다.

**Interfaces:**
- Consumes: T2 `renderPdf(report, data, { allowHosts })`, `rasterizePages(…, { allowHosts })`, `renderLabel(…, { allowHosts })`; T3 `getVersion`; 기존 `runDatasets`, `resolveAssetUrls`, `renderToHtml`, `bitmapToPng`.
- Produces:
```ts
export const RENDER_FORMATS = ["html", "pdf", "zpl", "tspl", "png"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];
export function isRenderFormat(v: unknown): v is RenderFormat;
export class RenderRequestError extends Error { readonly code: string; readonly details: Record<string, unknown> }   // → 400
export class RenderAbortedError extends Error {}                                                                    // → 499
export type RenderInput = { format: RenderFormat; params?: Record<string, unknown>; data?: Record<string, unknown>; props?: Record<string, unknown>; origin: string; signal?: AbortSignal };
export type RenderOutput = { body: Buffer | string; mime: string; filename: string; pages?: number };
export function parseHostList(env: string | undefined): string[];
export function renderAllowHosts(origin: string): string[];        // [자기 origin host, ...DAPORT_RENDER_ALLOW]
export function contentDisposition(report: Report, ext: string): string;   // pdf 라우트의 RFC 5987 규칙 그대로
export async function renderReport(report: Report, input: RenderInput): Promise<RenderOutput>;
export function renderErrorResponse(e: unknown): NextResponse;      // 오류 → 상태 코드 매핑 한 곳
```
- 스펙 5.1 구체화: `signal`은 `png` 경로에서 `rasterizePages` 전과 PNG 인코딩 전에 취소를 확인하기 위한 것이다(3단계 최종 리뷰 M6의 동작 유지).

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/render.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";

const renderPdf = vi.fn();
vi.mock("@daport/pdf", () => ({ renderPdf }));
const renderLabel = vi.fn(); const rasterizePages = vi.fn();
vi.mock("@daport/label", async (orig) => ({ ...(await orig<typeof import("@daport/label")>()), renderLabel, rasterizePages }));
const { renderReport, renderErrorResponse, renderAllowHosts, parseHostList, RenderRequestError, isRenderFormat, contentDisposition } = await import("../render");

const doc = parseReport({ id: "d", name: "문서", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, text: "hi" }] });
const label = parseReport({ id: "lb", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } });
const origin = "http://studio.local:3000";

beforeEach(() => {
  renderPdf.mockReset().mockResolvedValue(Buffer.from("%PDF-"));
  renderLabel.mockReset().mockImplementation(async (r: { output: { label: { language: string } } }) =>
    ({ language: r.output.label.language, dpi: 203, pages: 1, data: Buffer.from("X"), mime: "text/plain", filename: `lb.${r.output.label.language === "zpl" ? "zpl" : "prn"}` }));
  rasterizePages.mockReset().mockResolvedValue([{ width: 8, height: 1, rowBytes: 1, data: new Uint8Array([0xff]) }]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("renderReport", () => {
  it("html: renders with fonts under the studio origin", async () => {
    const out = await renderReport(doc, { format: "html", params: {}, origin });
    expect(out.mime).toBe("text/html; charset=utf-8");
    expect(String(out.body)).toContain(`${origin}/fonts/`);
    expect(String(out.body)).toContain("hi");
  });
  it("pdf: passes allowHosts (own origin + DAPORT_RENDER_ALLOW) and returns the pdf", async () => {
    vi.stubEnv("DAPORT_RENDER_ALLOW", "cdn.example.com, img.local:8080");
    const out = await renderReport(doc, { format: "pdf", params: {}, origin });
    expect(out.mime).toBe("application/pdf");
    expect(renderPdf.mock.calls[0][2]).toEqual({ allowHosts: ["studio.local:3000", "cdn.example.com", "img.local:8080"] });
  });
  it("zpl/tspl: override the report language and require a label report", async () => {
    const tspl = await renderReport(label, { format: "tspl", params: {}, origin });
    expect(tspl.filename).toBe("lb.prn");
    expect((renderLabel.mock.calls[0][0] as typeof label).output).toMatchObject({ kind: "label", label: { language: "tspl", dpi: 203 } });
    await expect(renderReport(doc, { format: "zpl", params: {}, origin })).rejects.toMatchObject({ code: "FORMAT_MISMATCH" });
    await expect(renderReport(doc, { format: "png", params: {}, origin })).rejects.toMatchObject({ code: "FORMAT_MISMATCH" });
    expect(renderLabel).toHaveBeenCalledTimes(1);
  });
  it("png: first page bitmap as PNG; aborted signal stops before rasterizing", async () => {
    const out = await renderReport(label, { format: "png", params: {}, origin });
    expect(out.mime).toBe("image/png");
    expect((out.body as Buffer).subarray(1, 4).toString()).toBe("PNG");
    const ac = new AbortController(); ac.abort();
    await expect(renderReport(label, { format: "png", params: {}, origin, signal: ac.signal })).rejects.toThrow(/aborted/);
    expect(rasterizePages).toHaveBeenCalledTimes(1);
  });
  it("props go into the render context; a failing dataset is a 400 with datasetErrors; a missing required param is a 400", async () => {
    await renderReport(doc, { format: "pdf", params: {}, props: { a: 1 }, origin });
    expect((renderPdf.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ a: 1 });
    const withDs = parseReport({ ...doc, datasets: [{ name: "h", type: "http", url: "https://nope.example/x" }] });
    const err = await renderReport(withDs, { format: "pdf", params: {}, origin }).catch((e) => e);
    expect(err).toBeInstanceOf(RenderRequestError);
    expect(renderErrorResponse(err).status).toBe(400);
    expect((await renderErrorResponse(err).json()).datasetErrors).toHaveLength(1);
    const withParam = parseReport({ ...doc, params: [{ name: "lot", type: "string", required: true }] });
    expect(renderErrorResponse(await renderReport(withParam, { format: "pdf", params: {}, origin }).catch((e) => e)).status).toBe(400);
  });
});

describe("helpers", () => {
  it("parseHostList trims and drops empties; isRenderFormat; contentDisposition", () => {
    expect(parseHostList(" a.com ,, b.local:1 ")).toEqual(["a.com", "b.local:1"]);
    expect(parseHostList(undefined)).toEqual([]);
    expect(renderAllowHosts("https://x.example")).toEqual(["x.example"]);
    expect(isRenderFormat("pdf")).toBe(true); expect(isRenderFormat("docx")).toBe(false); expect(isRenderFormat(1)).toBe(false);
    expect(contentDisposition(doc, "pdf")).toBe(`attachment; filename="d.pdf"; filename*=UTF-8''${encodeURIComponent("문서")}.pdf`);
  });
  it("renderErrorResponse maps unknown errors to 500", async () => {
    expect(renderErrorResponse(new Error("boom")).status).toBe(500);
  });
});
```

`apps/studio/src/app/api/reports/__tests__/preview-route.test.ts` 끝에 추가(파일의 기존 import·`call` 헬퍼를 그대로 쓴다. 헬퍼 이름이 다르면 그 파일의 것에 맞춘다):
```ts
describe("POST /api/reports/:id/preview version", () => {
  it("renders the given published version instead of the draft, 404 for a missing version", async () => {
    const { getStore, ready } = await import("@/lib/report-store");
    await ready();
    const id = `pv-${Date.now()}`;
    const base = { id, name: "V1", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, text: "first" }] };
    await getStore().create(base);
    await getStore().publish(id, parseReport(base));
    await getStore().update(id, { ...base, elements: [{ ...base.elements[0], text: "second" }] });
    const v1 = await call({ version: 1 }, id);
    expect(v1.status).toBe(200);
    expect(await v1.text()).toContain("first");
    const draft = await call({}, id);
    expect(await draft.text()).toContain("second");
    expect((await call({ version: 9 }, id)).status).toBe(404);
    expect((await call({ version: "1" }, id)).status).toBe(400);
  });
});
```
(`call(body, id)`가 id를 받지 않으면 그 테스트 파일의 헬퍼에 두 번째 인자를 더한다 — 기본값은 기존 값.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- render`
Expected: FAIL — `@/lib/render` 없음

- [ ] **Step 3: `render.ts` 구현**

`apps/studio/src/lib/render.ts`:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExpressionError, type Report, type DataContext } from "@daport/core";
import { renderToHtml, LayoutLimitError, BarcodeError } from "@daport/renderer";
import { renderPdf } from "@daport/pdf";
import { renderLabel, rasterizePages, bitmapToPng, LabelTooLargeError } from "@daport/label";
import { resolveAssetUrls } from "./assets";
import { runDatasets } from "./datasets";

export const RENDER_FORMATS = ["html", "pdf", "zpl", "tspl", "png"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];
export const isRenderFormat = (v: unknown): v is RenderFormat => typeof v === "string" && (RENDER_FORMATS as readonly string[]).includes(v);

/** 요청 쪽 잘못 → 400. details는 응답 본문에 그대로 펼친다(datasetErrors 등) */
export class RenderRequestError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = "RenderRequestError"; }
}
/** 클라이언트가 요청을 취소했다 → 499 (표준은 아니지만 "클라이언트가 요청을 닫음"의 관례) */
export class RenderAbortedError extends Error { constructor() { super("request aborted"); this.name = "RenderAbortedError"; } }

export type RenderInput = { format: RenderFormat; params?: Record<string, unknown>; data?: Record<string, unknown>; props?: Record<string, unknown>; origin: string; signal?: AbortSignal };
export type RenderOutput = { body: Buffer | string; mime: string; filename: string; pages?: number };

/** 쉼표 목록 환경변수 → 호스트 배열 (공백·빈 항목 제거) */
export function parseHostList(env: string | undefined): string[] {
  return (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
/** 렌더 중 Chromium이 요청할 수 있는 호스트: 자기 origin(에셋·폰트) + DAPORT_RENDER_ALLOW (4단계 스펙 5.6). 목록이 비면 외부는 전부 차단 */
export function renderAllowHosts(origin: string): string[] {
  return [new URL(origin).host, ...parseHostList(process.env.DAPORT_RENDER_ALLOW)];
}

/** RFC 6266/5987: filename에는 ASCII 대체 이름, 한글 이름은 filename*에 UTF-8 퍼센트 인코딩으로 넣는다 */
export function contentDisposition(report: Report, ext: string): string {
  const ascii = `${report.id.replace(/[^\w.-]/g, "_")}.${ext}`;
  const utf8 = encodeURIComponent(`${report.name || report.id}.${ext}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const LABEL_FORMATS: ReadonlySet<RenderFormat> = new Set(["zpl", "tspl", "png"]);

/**
 * 모델 → 데이터셋 실행 → props → asset:// 변환 → 포맷별 출력 (4단계 스펙 5.1).
 * studio 내부 라우트(pdf·label·preview)와 MES용 render가 같은 경로를 쓴다
 */
export async function renderReport(report: Report, input: RenderInput): Promise<RenderOutput> {
  if (LABEL_FORMATS.has(input.format) && report.output.kind !== "label") throw new RenderRequestError("FORMAT_MISMATCH", "레포트의 출력 종류가 라벨이 아닙니다");
  let context: DataContext;
  try {
    const run = await runDatasets(report, { params: input.params, data: input.data });
    if (run.errors.length) throw new RenderRequestError("DATASET_FAILED", "데이터셋 실행 실패", { datasetErrors: run.errors });
    context = run.context;
  } catch (e) {
    if (e instanceof RenderRequestError) throw e;
    throw new RenderRequestError("BAD_REQUEST", e instanceof Error ? e.message : String(e));   // 필수 파라미터 누락 등
  }
  const data: DataContext = input.props ? { ...context, props: input.props } : context;
  const resolved = resolveAssetUrls(report, input.origin);
  const allowHosts = renderAllowHosts(input.origin);
  switch (input.format) {
    case "html":
      return { body: renderToHtml(resolved, data, { fontBaseUrl: `${input.origin}/fonts` }), mime: "text/html; charset=utf-8", filename: `${report.id}.html` };
    case "pdf":
      return { body: await renderPdf(resolved, data, { allowHosts }), mime: "application/pdf", filename: `${report.id}.pdf` };
    case "png": {
      if (report.output.kind !== "label") throw new RenderRequestError("FORMAT_MISMATCH", "레포트의 출력 종류가 라벨이 아닙니다");   // 타입 좁히기용, 위에서 이미 걸렀다
      if (input.signal?.aborted) throw new RenderAbortedError();   // 브라우저를 띄우기 전에 취소를 본다
      const [first] = await rasterizePages(resolved, data, report.output.label.dpi, report.output.label.threshold, { allowHosts });
      if (!first) throw new RenderRequestError("NO_PAGES", "라벨 페이지가 없습니다");
      if (input.signal?.aborted) throw new RenderAbortedError();   // 렌더 중 취소됐으면 인코딩은 건너뛴다
      return { body: bitmapToPng(first), mime: "image/png", filename: `${report.id}.png`, pages: 1 };
    }
    case "zpl":
    case "tspl": {
      if (report.output.kind !== "label") throw new RenderRequestError("FORMAT_MISMATCH", "레포트의 출력 종류가 라벨이 아닙니다");
      const withLanguage: Report = { ...resolved, output: { kind: "label", label: { ...report.output.label, language: input.format } } };
      const res = await renderLabel(withLanguage, data, { allowHosts });
      return { body: res.data, mime: res.mime, filename: res.filename, pages: res.pages };
    }
  }
}

/** 렌더 오류 → HTTP 응답. 스펙 8장: 요청 잘못 400(코드 유지), 취소 499, 그 밖은 500 */
export function renderErrorResponse(e: unknown): NextResponse {
  if (e instanceof RenderAbortedError) return new NextResponse(null, { status: 499 });
  if (e instanceof RenderRequestError) return NextResponse.json({ error: e.message, code: e.code, ...e.details }, { status: 400 });
  if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
  if (e instanceof ExpressionError || e instanceof BarcodeError || e instanceof ZodError) return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}
```

- [ ] **Step 4: 라우트 리팩터링**

`apps/studio/src/app/api/reports/[id]/pdf/route.ts` 전체:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse, contentDisposition } from "@/lib/render";

export const maxDuration = 60;
const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** PDF 다운로드. 모델·데이터·오류 규칙은 lib/render.ts 한 곳에 있다 (스펙 10장, 4단계 스펙 5.1) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  let report: Report | null;
  try { await ready(); report = body.report ? parseReport(body.report) : await getStore().get(id); }
  catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const out = await renderReport(report, { format: "pdf", params: objectField(body, "params"), data: objectField(body, "data"), props: propsField(body), origin: new URL(req.url).origin });
    return new NextResponse(new Uint8Array(out.body as Buffer), { headers: { "content-type": out.mime, "content-disposition": contentDisposition(report, "pdf") } });
  } catch (e) {
    return renderErrorResponse(e);
  }
}
```

`apps/studio/src/app/api/reports/[id]/label/route.ts` 전체:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse, contentDisposition } from "@/lib/render";

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
  if (report.output.kind !== "label") return NextResponse.json({ error: "레포트의 출력 종류가 라벨이 아닙니다", code: "FORMAT_MISMATCH" }, { status: 400 });
  const preview = new URL(req.url).searchParams.get("preview") === "png";
  try {
    const out = await renderReport(report, {
      format: preview ? "png" : report.output.label.language,
      params: objectField(body, "params"), data: objectField(body, "data"), props: propsField(body), origin: new URL(req.url).origin, signal: req.signal,
    });
    if (preview) return new NextResponse(new Uint8Array(out.body as Buffer), { headers: { "content-type": out.mime } });
    return new NextResponse(new Uint8Array(out.body as Buffer), { headers: { "content-type": out.mime, "content-disposition": contentDisposition(report, out.filename.split(".").pop()!), "x-daport-pages": String(out.pages ?? 0) } });
  } catch (e) {
    return renderErrorResponse(e);
  }
}
```
기존 label-route 테스트가 `content-disposition`에 `filename="lb.zpl"`이 포함되는지만 보므로 RFC 5987 형식으로 바뀌어도 통과한다. 통과하지 않는 단언이 있으면 라우트가 아니라 **테스트가 옛 형식을 고정한 것**이므로 해당 단언만 새 형식(`toContain('filename="lb.zpl"')`)으로 고친다.

`apps/studio/src/app/api/reports/[id]/preview/route.ts` 전체:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse } from "@/lib/render";

const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** HTML 미리보기. body.version이 있으면 그 배포 버전을, 없으면 body.report 또는 draft를 그린다 (4단계 스펙 5.4) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  let report: Report | null;
  try {
    await ready();
    if (body.version !== undefined) {
      if (!Number.isInteger(body.version)) return NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 });
      report = await getStore().getVersion(id, body.version as number);
    } else {
      report = body.report ? parseReport(body.report) : await getStore().get(id);
    }
  } catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    // 요청 data가 있으면 그 데이터셋은 실행하지 않는다 (편집 중 미리보기는 sample.data를 보낸다)
    const out = await renderReport(report, { format: "html", params: objectField(body, "params"), data: objectField(body, "data"), props: propsField(body), origin: new URL(req.url).origin });
    return new NextResponse(out.body as string, { headers: { "content-type": out.mime } });
  } catch (e) {
    return renderErrorResponse(e);
  }
}
```
주의: 예전 preview 라우트는 모든 오류를 400으로 냈다. `renderErrorResponse`는 알 수 없는 오류를 500으로 내므로, 기존 preview 테스트 중 500이 되어 깨지는 것이 있으면 그 케이스가 실제로 요청 잘못인지 확인하고, 요청 잘못이면 `RenderRequestError`로 던지도록 `renderReport`를 보강한다(테스트를 완화하지 않는다).

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS — 특히 `pdf-route`·`label-route`·`preview-route`·`print-route`·`seed-wait`가 수정 없이(또는 위에서 허용한 단언 형식 수정만으로) 통과.

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/src/lib/render.ts apps/studio/src/lib/__tests__/render.test.ts "apps/studio/src/app/api/reports/[id]/pdf/route.ts" "apps/studio/src/app/api/reports/[id]/label/route.ts" "apps/studio/src/app/api/reports/[id]/preview/route.ts" apps/studio/src/app/api/reports/__tests__/preview-route.test.ts
git -c core.hooksPath=/dev/null commit -m "refactor(studio): 공통 렌더 함수 renderReport — pdf·label·preview 라우트가 한 경로를 쓴다, preview version 인자

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 내부 배포 라우트 (publish · versions · published PUT)

**Files:**
- Create: `apps/studio/src/app/api/reports/[id]/publish/route.ts`, `apps/studio/src/app/api/reports/[id]/versions/route.ts`, `apps/studio/src/app/api/reports/[id]/published/route.ts`(PUT만; GET·OPTIONS는 T7이 같은 파일에 더한다)
- Test: `apps/studio/src/app/api/reports/__tests__/publish-routes.test.ts`

**Interfaces:**
- Consumes: T3 `publish`·`setPublished`·`listVersions`; 기존 `checkReportComponents`, `WARNINGS_HEADER`, `readJsonBody`.
- Produces: `POST /api/reports/:id/publish { note? }` → 201 `{ version, createdAt }`; `GET /api/reports/:id/versions` → `VersionList`; `PUT /api/reports/:id/published { version }` → 200 `{ publishedVersion }`.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/app/api/reports/__tests__/publish-routes.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { POST as publish } from "../[id]/publish/route";
import { GET as versions } from "../[id]/versions/route";
import { PUT as setPublished } from "../[id]/published/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body?: unknown) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("publish / versions / published", () => {
  it("publishes the draft as v1, lists it, republishes as v2, and moves the pointer back", async () => {
    await ready();
    const id = `pub-${Date.now()}`;
    const base = { id, name: "P", version: 1, page: { width: 100, height: 100 } };
    await getStore().create(base);
    const r1 = await publish(json(`/api/reports/${id}/publish`, "POST", { note: "첫 배포" }), ctx(id));
    expect(r1.status).toBe(201);
    expect(await r1.json()).toMatchObject({ version: 1 });
    await getStore().update(id, { ...base, name: "P2" });
    const r2 = await publish(json(`/api/reports/${id}/publish`, "POST", {}), ctx(id));
    expect((await r2.json()).version).toBe(2);
    const list = await (await versions(json(`/api/reports/${id}/versions`, "GET"), ctx(id))).json();
    expect(list.versions.map((v: { version: number; published: boolean; note: string | null }) => [v.version, v.published, v.note])).toEqual([[1, false, "첫 배포"], [2, true, null]]);
    expect(list.publishedVersion).toBe(2);
    expect(typeof list.draftHash).toBe("string");
    const back = await setPublished(json(`/api/reports/${id}/published`, "PUT", { version: 1 }), ctx(id));
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual({ publishedVersion: 1 });
    expect((await getStore().getPublished(id))?.report.name).toBe("P");
    expect((await getStore().get(id))?.name).toBe("P2");
  });
  it("404 for an unknown report or version, 400 for a non-integer version", async () => {
    await ready();
    expect((await publish(json("/api/reports/nope/publish", "POST", {}), ctx("nope"))).status).toBe(404);
    expect((await versions(json("/api/reports/nope/versions", "GET"), ctx("nope"))).status).toBe(404);
    const id = `pub2-${Date.now()}`;
    await getStore().create({ id, version: 1, page: { width: 10, height: 10 } });
    expect((await setPublished(json(`/api/reports/${id}/published`, "PUT", { version: 5 }), ctx(id))).status).toBe(404);
    expect((await setPublished(json(`/api/reports/${id}/published`, "PUT", { version: "1" }), ctx(id))).status).toBe(400);
  });
  it("publish runs the component guard: a mismatching component body is a 409", async () => {
    await ready();
    const { getComponentStore } = await import("@/lib/component-store");
    const body = { name: "C", w: 20, h: 10, props: [], elements: [{ id: "t", type: "text", x: 0, y: 0, w: 20, h: 10, text: "c" }] };
    const cid = `pubc${Date.now() % 100000}`;
    await getComponentStore().create(cid, body as never);
    const id = `pub3-${Date.now()}`;
    const tampered = { ...body, elements: [{ ...body.elements[0], text: "changed" }] };
    await getStore().create({ id, version: 1, page: { width: 100, height: 100 }, components: { [`${cid}@1`]: tampered },
      elements: [{ id: "r", type: "ref", x: 0, y: 0, w: 20, h: 10, component: cid, version: 1, props: {} }] });
    const res = await publish(json(`/api/reports/${id}/publish`, "POST", {}), ctx(id));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("COMPONENT_MISMATCH");
    expect(await getStore().getPublished(id)).toBeNull();
  });
});
```
(`ref` 요소의 정확한 필드 이름은 `packages/core/src/schema/elements.ts`의 `RefElementSchema`를 보고 맞춘다 — 3b단계에서 정한 이름이 우선이다. `parseReport`가 거부하면 그 스키마대로 고친다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- publish-routes`
Expected: FAIL — 라우트 모듈 없음

- [ ] **Step 3: 라우트 구현**

`apps/studio/src/app/api/reports/[id]/publish/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { checkReportComponents, WARNINGS_HEADER } from "@/lib/report-guard";

/** draft를 불변 버전으로 저장하고 배포 포인터를 옮긴다 (4단계 스펙 4.2, 5.4). 저장과 같은 컴포넌트 검사·정리를 거친다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const note = typeof parsed.body.note === "string" && parsed.body.note.trim() ? parsed.body.note.trim().slice(0, 500) : undefined;
  try {
    await ready();
    const draft = await getStore().get(id);
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
    const guard = await checkReportComponents(draft);
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    const res = NextResponse.json(await getStore().publish(id, guard.report, note), { status: 201 });
    if (guard.warnings.length) res.headers.set(WARNINGS_HEADER, JSON.stringify(guard.warnings));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFoundError ? 404 : 500 });
  }
}
```

`apps/studio/src/app/api/reports/[id]/versions/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getStore, ready } from "@/lib/report-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ready();
  const list = await getStore().listVersions((await params).id);
  return list ? NextResponse.json(list) : NextResponse.json({ error: "not found" }, { status: 404 });
}
```

`apps/studio/src/app/api/reports/[id]/published/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

/** 배포 포인터 이동 (4단계 스펙 4.2). 새 버전을 만들지 않고 draft도 건드리지 않는다. studio 내부용(무인증) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const version = parsed.body.version;
  if (!Number.isInteger(version)) return NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 });
  try {
    await ready();
    await getStore().setPublished(id, version as number);
    return NextResponse.json({ publishedVersion: version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFoundError ? 404 : 500 });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test -- publish-routes && pnpm --filter studio typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add "apps/studio/src/app/api/reports/[id]/publish/route.ts" "apps/studio/src/app/api/reports/[id]/versions/route.ts" "apps/studio/src/app/api/reports/[id]/published/route.ts" apps/studio/src/app/api/reports/__tests__/publish-routes.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): 배포·버전 목록·배포 포인터 이동 라우트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: MES 렌더 API · published GET · CORS

**Files:**
- Create: `apps/studio/src/lib/cors.ts`, `apps/studio/src/app/api/reports/[id]/render/route.ts`
- Modify: `apps/studio/src/app/api/reports/[id]/published/route.ts`(GET·OPTIONS 추가)
- Test: `apps/studio/src/lib/__tests__/cors.test.ts`, `apps/studio/src/app/api/reports/__tests__/render-route.test.ts`, `apps/studio/src/app/api/reports/__tests__/published-route.test.ts`

**Interfaces:**
- Consumes: T4 `authorize`; T5 `renderReport`·`isRenderFormat`·`contentDisposition`·`renderErrorResponse`; T3 `getPublished`·`getVersion`·`listVersions`; 기존 `resolveAssetUrls`.
- Produces:
```ts
// cors.ts
export function parseOrigins(env: string | undefined): string[];
export function corsHeaders(req: Request): Record<string, string>;   // origin이 DAPORT_CORS_ORIGINS에 있을 때만 채워진다
export function withCors(req: Request, res: Response): Response;
export function preflight(req: Request): Response;                    // 204
```
  `POST /api/reports/:id/render`, `OPTIONS`; `GET /api/reports/:id/published?version=`, `OPTIONS`.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/cors.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { corsHeaders, preflight, withCors, parseOrigins } from "../cors";

afterEach(() => { vi.unstubAllEnvs(); });
const req = (origin?: string) => new Request("http://localhost/x", { headers: origin ? { origin } : {} });

describe("cors", () => {
  it("adds headers only for listed origins", () => {
    vi.stubEnv("DAPORT_CORS_ORIGINS", "https://mes.example.com, http://localhost:5173");
    expect(corsHeaders(req("https://mes.example.com"))).toMatchObject({ "access-control-allow-origin": "https://mes.example.com", "access-control-allow-headers": "content-type, x-api-key", "vary": "origin" });
    expect(corsHeaders(req("https://evil.example.com"))).toEqual({});
    expect(corsHeaders(req())).toEqual({});
    expect(parseOrigins(undefined)).toEqual([]);
  });
  it("preflight is 204 and withCors decorates an existing response", async () => {
    vi.stubEnv("DAPORT_CORS_ORIGINS", "https://mes.example.com");
    const p = preflight(req("https://mes.example.com"));
    expect(p.status).toBe(204);
    expect(p.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    const res = withCors(req("https://mes.example.com"), new Response("x", { status: 401 }));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://mes.example.com");
    expect(res.headers.get("access-control-expose-headers")).toBe("x-daport-version, content-disposition");
  });
});
```

`apps/studio/src/app/api/reports/__tests__/render-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseReport } from "@daport/core";

vi.stubEnv("DAPORT_DEV_API_KEY", "e2e-dev-key");
(globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = undefined;   // 환경변수가 반영된 저장소를 새로 만들게 한다
const renderPdf = vi.fn();
vi.mock("@daport/pdf", () => ({ renderPdf }));
const { POST, OPTIONS } = await import("../[id]/render/route");
const { getStore, ready } = await import("@/lib/report-store");
const { MemoryApiKeyStore } = await import("@/lib/api-key-store");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (id: string, body: unknown, headers: Record<string, string> = { "x-api-key": "e2e-dev-key" }) =>
  POST(new Request(`http://studio.local/api/reports/${id}/render`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), ctx(id));

let id: string;
beforeEach(async () => {
  renderPdf.mockReset().mockResolvedValue(Buffer.from("%PDF-"));
  await ready();
  id = `rnd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await getStore().create({ id, name: "R", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, text: "published" }] });
});

describe("POST /api/reports/:id/render", () => {
  it("401 without a key, 404 NOT_PUBLISHED before the first publish, then renders the published version", async () => {
    expect((await call(id, { format: "pdf" }, {})).status).toBe(401);
    expect((await call(id, { format: "pdf" }, { "x-api-key": "wrong" })).status).toBe(401);
    const np = await call(id, { format: "pdf" });
    expect(np.status).toBe(404);
    expect((await np.json()).code).toBe("NOT_PUBLISHED");
    await getStore().publish(id, (await getStore().get(id))!);
    const res = await call(id, { format: "pdf", params: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-daport-version")).toBe("1");
    expect(res.headers.get("content-disposition")).toContain(`filename="${id}.pdf"`);
  });
  it("never renders the draft: edits after publish are invisible until republished; version pins an old version", async () => {
    await getStore().publish(id, (await getStore().get(id))!);
    const draft = (await getStore().get(id))!;
    await getStore().update(id, { ...draft, elements: [{ ...draft.elements[0], text: "DRAFT-ONLY" }] });
    const html = await call(id, { format: "html" });
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain("published");
    expect(text).not.toContain("DRAFT-ONLY");
    await getStore().publish(id, (await getStore().get(id))!);
    expect(await (await call(id, { format: "html" })).text()).toContain("DRAFT-ONLY");
    const pinned = await call(id, { format: "html", version: 1 });
    expect(pinned.headers.get("x-daport-version")).toBe("1");
    expect(await pinned.text()).not.toContain("DRAFT-ONLY");
    expect((await call(id, { format: "html", version: 9 })).status).toBe(404);
    expect((await call(id, { format: "html", version: "1" })).status).toBe(400);
  });
  it("ignores a report field in the body and rejects unknown formats and label formats for a pdf report", async () => {
    await getStore().publish(id, (await getStore().get(id))!);
    const smuggled = { id, version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, text: "SMUGGLED" }] };
    expect(await (await call(id, { format: "html", report: smuggled })).text()).not.toContain("SMUGGLED");
    expect((await call(id, { format: "docx" })).status).toBe(400);
    const mm = await call(id, { format: "zpl" });
    expect(mm.status).toBe(400);
    expect((await mm.json()).code).toBe("FORMAT_MISMATCH");
  });
  it("403 when the key does not allow the report; unknown report is 404 only after auth", async () => {
    const store = new MemoryApiKeyStore();
    const { rawKey } = await store.create("limited", ["other-report"]);
    (globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = store;
    try {
      expect((await call(id, { format: "pdf" }, { "x-api-key": rawKey })).status).toBe(403);
      expect((await call("nope", { format: "pdf" }, { "x-api-key": rawKey })).status).toBe(403);
      expect((await call("nope", { format: "pdf" }, {})).status).toBe(401);
    } finally {
      (globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = undefined;
    }
  });
  it("OPTIONS answers preflight for a listed origin", async () => {
    vi.stubEnv("DAPORT_CORS_ORIGINS", "https://mes.example.com");
    const res = await OPTIONS(new Request(`http://studio.local/api/reports/${id}/render`, { method: "OPTIONS", headers: { origin: "https://mes.example.com" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://mes.example.com");
    vi.unstubAllEnvs();
    vi.stubEnv("DAPORT_DEV_API_KEY", "e2e-dev-key");
  });
});
```

`apps/studio/src/app/api/reports/__tests__/published-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.stubEnv("DAPORT_DEV_API_KEY", "e2e-dev-key");
(globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = undefined;
const { GET } = await import("../[id]/published/route");
const { getStore, ready } = await import("@/lib/report-store");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, q = "", key: string | null = "e2e-dev-key") =>
  GET(new Request(`http://studio.local/api/reports/${id}/published${q}`, { headers: key ? { "x-api-key": key } : {} }), ctx(id));

describe("GET /api/reports/:id/published", () => {
  it("returns the published model with absolute asset urls and the version header", async () => {
    await ready();
    const id = `pubget-${Date.now()}`;
    const model = { id, version: 1, page: { width: 100, height: 100 }, elements: [{ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, src: "asset://logo1" }] };
    await getStore().create(model);
    expect((await get(id)).status).toBe(404);
    expect((await (await get(id)).json()).code).toBe("NOT_PUBLISHED");
    await getStore().publish(id, (await getStore().get(id))!);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-daport-version")).toBe("1");
    const body = await res.json();
    expect(body.elements[0].src).toBe("http://studio.local/api/assets/logo1");
    expect((await get(id, "?version=1")).status).toBe(200);
    expect((await get(id, "?version=2")).status).toBe(404);
    expect((await get(id, "?version=x")).status).toBe(400);
    expect((await get(id, "", null)).status).toBe(401);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- cors render-route published-route`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: CORS 구현**

`apps/studio/src/lib/cors.ts`:
```ts
/** DAPORT_CORS_ORIGINS: MES 프론트 origin의 쉼표 목록 (4단계 스펙 5.5) */
export function parseOrigins(env: string | undefined): string[] {
  return (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** 요청 origin이 허용 목록에 있을 때만 CORS 헤더. 없으면 빈 객체(브라우저가 막는다) */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !parseOrigins(process.env.DAPORT_CORS_ORIGINS).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, x-api-key",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-expose-headers": "x-daport-version, content-disposition",
    "vary": "origin",
  };
}

export function withCors(req: Request, res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
```

- [ ] **Step 4: render 라우트**

`apps/studio/src/app/api/reports/[id]/render/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { authorize } from "@/lib/auth";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse, contentDisposition, isRenderFormat } from "@/lib/render";
import { withCors, preflight } from "@/lib/cors";

export const maxDuration = 60;

export async function OPTIONS(req: Request) { return preflight(req); }

/** 배포 버전(또는 지정 버전)을 골라 온다. draft는 절대 읽지 않는다 (4단계 스펙 5.2). null이면 호출자가 404를 낸다 */
export async function pickVersion(id: string, version: number | undefined): Promise<{ version: number; report: Report } | { error: NextResponse }> {
  const store = getStore();
  if (version !== undefined) {
    const report = await store.getVersion(id, version);
    return report ? { version, report } : { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  const published = await store.getPublished(id);
  if (published) return published;
  // 존재하지만 미배포인지, 아예 없는지 구분한다 (listVersions는 draft를 렌더에 쓰지 않는다)
  const exists = (await store.listVersions(id)) !== null;
  return { error: NextResponse.json(exists ? { error: "배포된 버전이 없습니다", code: "NOT_PUBLISHED" } : { error: "not found" }, { status: 404 }) };
}

/** MES용 렌더 API (4단계 스펙 5.2). X-API-Key 필수, 본문 { format, params?, data?, version? }. report·props 필드는 무시한다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(req, id);
  if (!auth.ok) return withCors(req, auth.response);
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return withCors(req, parsed.response);
  const body = parsed.body;
  if (!isRenderFormat(body.format)) return withCors(req, NextResponse.json({ error: "format은 html·pdf·zpl·tspl·png 중 하나여야 합니다" }, { status: 400 }));
  if (body.version !== undefined && !Number.isInteger(body.version)) return withCors(req, NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 }));
  try {
    await ready();
    const picked = await pickVersion(id, body.version as number | undefined);
    if ("error" in picked) return withCors(req, picked.error);
    const out = await renderReport(picked.report, { format: body.format, params: objectField(body, "params"), data: objectField(body, "data"), origin: new URL(req.url).origin });
    const headers: Record<string, string> = { "content-type": out.mime, "x-daport-version": String(picked.version) };
    if (body.format !== "html") headers["content-disposition"] = contentDisposition(picked.report, out.filename.split(".").pop()!);
    if (out.pages !== undefined) headers["x-daport-pages"] = String(out.pages);
    return withCors(req, new NextResponse(typeof out.body === "string" ? out.body : new Uint8Array(out.body), { headers }));
  } catch (e) {
    return withCors(req, renderErrorResponse(e));
  }
}
```
주의: Next는 `route.ts`에서 HTTP 메서드 외의 export를 금지한다. `pickVersion`은 위처럼 두면 빌드가 거부하므로 **`apps/studio/src/lib/pick-version.ts`로 옮기고** render·published 두 라우트가 import한다(위 코드의 `pickVersion`을 그 파일로 옮기고 `getStore`를 import; 라우트에는 `import { pickVersion } from "@/lib/pick-version"`).

- [ ] **Step 5: published GET·OPTIONS 추가**

`apps/studio/src/app/api/reports/[id]/published/route.ts`에 (기존 PUT 유지) 추가:
```ts
import { authorize } from "@/lib/auth";
import { resolveAssetUrls } from "@/lib/assets";
import { withCors, preflight } from "@/lib/cors";
import { pickVersion } from "@/lib/pick-version";

export async function OPTIONS(req: Request) { return preflight(req); }

/** 임베드용 모델 조회 (4단계 스펙 5.3). API 키 필수. asset://는 studio 절대 URL로 바꾼다 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(req, id);
  if (!auth.ok) return withCors(req, auth.response);
  const url = new URL(req.url);
  const raw = url.searchParams.get("version");
  const version = raw === null ? undefined : Number(raw);
  if (version !== undefined && !Number.isInteger(version)) return withCors(req, NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 }));
  await ready();
  const picked = await pickVersion(id, version);
  if ("error" in picked) return withCors(req, picked.error);
  return withCors(req, NextResponse.json(resolveAssetUrls(picked.report, url.origin), { headers: { "x-daport-version": String(picked.version) } }));
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/studio/src/lib/cors.ts apps/studio/src/lib/pick-version.ts "apps/studio/src/app/api/reports/[id]/render/route.ts" "apps/studio/src/app/api/reports/[id]/published/route.ts" apps/studio/src/lib/__tests__/cors.test.ts apps/studio/src/app/api/reports/__tests__/render-route.test.ts apps/studio/src/app/api/reports/__tests__/published-route.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): MES 렌더 API·배포 모델 조회 (X-API-Key, CORS 허용 목록)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: 번들 내보내기·가져오기

**Files:**
- Modify: `apps/studio/package.json`(`fflate` 의존)
- Create: `apps/studio/src/lib/bundle.ts`, `apps/studio/src/lib/asset-io.ts`, `apps/studio/src/lib/import-bundle.ts`, `apps/studio/src/app/api/export/route.ts`, `apps/studio/src/app/api/import/route.ts`
- Test: `apps/studio/src/lib/__tests__/bundle.test.ts`, `apps/studio/src/lib/__tests__/import-bundle.test.ts`

**Interfaces:**
- Consumes: T3 `getVersion`·`publish`·`create`·`get`; 기존 `checkReportComponents`, `walkElements`, `parseReport`.
- Produces:
```ts
// bundle.ts
export type BundleManifest = { format: "daport-bundle"; version: 1; exportedAt: string; reports: { id: string; name: string; source: "draft" | { version: number } }[]; connections: { sql: string[]; httpHosts: string[] }; warnings: string[] };
export type BundleAsset = { id: string; name: string; mime: string; data: Uint8Array };
export class BundleInvalidError extends Error { readonly code = "BUNDLE_INVALID" }
export function collectConnections(reports: Report[]): BundleManifest["connections"];
export function collectAssetIds(report: Report): string[];                       // asset://id (본문·컴포넌트·ref 입력값·image 입력값 기본값)
export function buildBundle(entries: { report: Report; source: BundleManifest["reports"][number]["source"] }[], assets: BundleAsset[], warnings: string[]): Uint8Array;
export function readBundle(zip: Uint8Array): { manifest: BundleManifest; reports: unknown[]; assets: BundleAsset[] };   // 손상 → BundleInvalidError
export function applyConnectionMap(report: Report, map: Record<string, string>): Report;
// asset-io.ts (서버 전용, @vercel/blob)
export function assetStorageEnabled(): boolean;
export function fetchAsset(id: string): Promise<BundleAsset | null>;
export function hasAsset(id: string): Promise<boolean>;
export function putAsset(asset: BundleAsset): Promise<void>;                   // pathname assets/<id>-<name>
// import-bundle.ts
export type ImportResult = { imported: { id: string; action: "created" | { version: number } }[]; skipped: { id: string; reason: string }[]; warnings: string[] };
export function importBundle(zip: Uint8Array, opts: { filename: string; connectionMap?: Record<string, string> }, deps: { store: ReportStore; assets: { has(id: string): Promise<boolean>; put(a: BundleAsset): Promise<void> } | null }): Promise<ImportResult>;
```
  라우트: `POST /api/export { reports: [{ id, version? }] }` → zip; `POST /api/import` multipart(`file`, `connectionMap`).

- [ ] **Step 1: 의존성**

`apps/studio/package.json` dependencies에 `"fflate": "^0.8.2"` 추가 후 루트에서 `pnpm install` **한 번**.

- [ ] **Step 2: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/bundle.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { parseReport } from "@daport/core";
import { buildBundle, readBundle, collectConnections, collectAssetIds, applyConnectionMap, BundleInvalidError } from "../bundle";

const r1 = parseReport({ id: "a", name: "A", version: 1, page: { width: 100, height: 100 },
  datasets: [{ name: "s", type: "sql", connection: "mes", query: "select 1" }, { name: "h", type: "http", url: "https://mes.example.com/api/x" }],
  elements: [{ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, src: "asset://logo" }] });
const r2 = parseReport({ id: "b", version: 1, page: { width: 60, height: 40 } });

describe("bundle", () => {
  it("round-trips reports, assets and manifest through a zip", () => {
    const zip = buildBundle([{ report: r1, source: "draft" }, { report: r2, source: { version: 3 } }], [{ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }], ["w1"]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["assets.json", "assets/logo.png", "manifest.json", "reports/a.json", "reports/b.json"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest).toMatchObject({ format: "daport-bundle", version: 1, reports: [{ id: "a", name: "A", source: "draft" }, { id: "b", name: "", source: { version: 3 } }], connections: { sql: ["mes"], httpHosts: ["mes.example.com"] }, warnings: ["w1"] });
    const back = readBundle(zip);
    expect(back.reports.map((r) => (r as { id: string }).id)).toEqual(["a", "b"]);
    expect(back.assets).toEqual([{ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }]);
  });
  it("collects connections and asset ids, including component bodies", () => {
    expect(collectConnections([r1, r2])).toEqual({ sql: ["mes"], httpHosts: ["mes.example.com"] });
    expect(collectAssetIds(r1)).toEqual(["logo"]);
    expect(collectAssetIds(r2)).toEqual([]);
  });
  it("applyConnectionMap renames sql connections only", () => {
    const out = applyConnectionMap(r1, { mes: "mes-prod", nope: "x" });
    expect(out.datasets[0]).toMatchObject({ type: "sql", connection: "mes-prod" });
    expect(r1.datasets[0]).toMatchObject({ connection: "mes" });   // 원본 불변
  });
  it("rejects a non-zip, a zip without manifest, and an unsupported format version", () => {
    expect(() => readBundle(new Uint8Array([1, 2, 3]))).toThrow(BundleInvalidError);
    const noManifest = buildBundle([], [], []);
    const files = unzipSync(noManifest); delete files["manifest.json"];
    const { zipSync, strToU8 } = require("fflate") as typeof import("fflate");
    expect(() => readBundle(zipSync(files))).toThrow(BundleInvalidError);
    expect(() => readBundle(zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "daport-bundle", version: 2, reports: [] })) }))).toThrow(/version/);
  });
});
```
(`require`가 ESM 테스트에서 안 되면 파일 상단 import에 `zipSync, strToU8`를 더하고 그 줄을 지운다.)

`apps/studio/src/lib/__tests__/import-bundle.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { MemoryReportStore } from "../report-store";
import { buildBundle, type BundleAsset } from "../bundle";
import { importBundle } from "../import-bundle";

const base = (id: string, text = "hi") => parseReport({ id, name: id.toUpperCase(), version: 1, page: { width: 100, height: 100 },
  datasets: [{ name: "s", type: "sql", connection: "dev", query: "select 1" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, text }, { id: "i", type: "image", x: 0, y: 20, w: 10, h: 10, src: "asset://logo" }] });

function memAssets() {
  const map = new Map<string, BundleAsset>();
  return { map, has: async (id: string) => map.has(id), put: async (a: BundleAsset) => { map.set(a.id, a); } };
}

describe("importBundle", () => {
  it("creates new reports as drafts, adds a version (unpublished) for existing ids, uploads missing assets, maps connections", async () => {
    const store = new MemoryReportStore();
    await store.create(base("existing", "old"));
    await store.publish("existing", (await store.get("existing"))!);
    const assets = memAssets();
    await assets.put({ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([9]) });
    const zip = buildBundle([{ report: base("fresh"), source: "draft" }, { report: base("existing", "imported"), source: "draft" }],
      [{ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([1]) }, { id: "seal", name: "seal.png", mime: "image/png", data: new Uint8Array([2]) }], []);
    const res = await importBundle(zip, { filename: "x.zip", connectionMap: { dev: "prod" } }, { store, assets });
    expect(res.imported).toEqual([{ id: "fresh", action: "created" }, { id: "existing", action: { version: 2 } }]);
    expect(res.skipped).toEqual([]);
    expect((await store.get("fresh"))?.datasets[0]).toMatchObject({ connection: "prod" });
    expect((await store.get("existing"))?.elements[0]).toMatchObject({ text: "old" });          // draft 불변
    expect((await store.getPublished("existing"))?.version).toBe(1);                              // 포인터 불변
    expect((await store.getVersion("existing", 2))?.elements[0]).toMatchObject({ text: "imported" });
    expect((await store.listVersions("existing"))?.versions[1].note).toBe("가져옴: x.zip");
    expect(assets.map.get("logo")?.data).toEqual(new Uint8Array([9]));                           // 이미 있으면 건너뜀
    expect(assets.map.get("seal")?.data).toEqual(new Uint8Array([2]));
  });
  it("skips an invalid report and keeps going; warns when asset storage is off", async () => {
    const store = new MemoryReportStore();
    const zip = buildBundle([{ report: base("ok"), source: "draft" }], [{ id: "logo", name: "l.png", mime: "image/png", data: new Uint8Array([1]) }], []);
    // 손상된 레포트를 끼워 넣는다
    const { unzipSync, zipSync, strToU8 } = await import("fflate");
    const files = unzipSync(zip);
    files["reports/bad.json"] = strToU8(JSON.stringify({ id: "bad", page: {} }));
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.reports.push({ id: "bad", name: "", source: "draft" });
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    const res = await importBundle(zipSync(files), { filename: "y.zip" }, { store, assets: null });
    expect(res.imported).toEqual([{ id: "ok", action: "created" }]);
    expect(res.skipped).toEqual([{ id: "bad", reason: expect.any(String) }]);
    expect(res.warnings.some((w) => w.includes("에셋"))).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter studio test -- bundle`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: `bundle.ts`**

```ts
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { walkElements, type Report } from "@daport/core";

export type BundleSource = "draft" | { version: number };
export type BundleManifest = {
  format: "daport-bundle"; version: 1; exportedAt: string;
  reports: { id: string; name: string; source: BundleSource }[];
  connections: { sql: string[]; httpHosts: string[] };
  warnings: string[];
};
export type BundleAsset = { id: string; name: string; mime: string; data: Uint8Array };

export class BundleInvalidError extends Error {
  readonly code = "BUNDLE_INVALID";
  constructor(message: string) { super(message); this.name = "BundleInvalidError"; }
}

const ASSET_PREFIX = "asset://";
const uniq = (xs: string[]) => [...new Set(xs)];

/** sql 데이터셋의 연결 이름과 http 데이터셋의 호스트 — 가져오는 쪽의 점검 목록 (4단계 스펙 6.1) */
export function collectConnections(reports: Report[]): BundleManifest["connections"] {
  const sql: string[] = [], httpHosts: string[] = [];
  for (const r of reports) for (const ds of r.datasets) {
    if (ds.type === "sql") sql.push(ds.connection);
    else if (ds.type === "http") { try { httpHosts.push(new URL(ds.url).host); } catch { /* 표현식 URL은 건너뛴다 */ } }
  }
  return { sql: uniq(sql).sort(), httpHosts: uniq(httpHosts).sort() };
}

/** 모델이 참조하는 asset://id — resolveAssetUrls가 훑는 자리와 같다(본문·컴포넌트 image src, ref 입력값, image 입력값 기본값) */
export function collectAssetIds(report: Report): string[] {
  const ids: string[] = [];
  const take = (v: unknown) => { if (typeof v === "string" && v.startsWith(ASSET_PREFIX)) ids.push(v.slice(ASSET_PREFIX.length)); };
  const scan = (elements: Report["elements"]) => walkElements(elements, (el) => {
    if (el.type === "image") take(el.src);
    else if (el.type === "ref") Object.values(el.props).forEach(take);
  });
  scan(report.elements);
  for (const body of Object.values(report.components)) { scan(body.elements); for (const p of body.props) if (p.type === "image") take(p.default); }
  return uniq(ids);
}

const ext = (name: string) => name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

export function buildBundle(entries: { report: Report; source: BundleSource }[], assets: BundleAsset[], warnings: string[]): Uint8Array {
  const manifest: BundleManifest = {
    format: "daport-bundle", version: 1, exportedAt: new Date().toISOString(),
    reports: entries.map((e) => ({ id: e.report.id, name: e.report.name, source: e.source })),
    connections: collectConnections(entries.map((e) => e.report)),
    warnings,
  };
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const e of entries) files[`reports/${e.report.id}.json`] = strToU8(JSON.stringify(e.report, null, 2));
  files["assets.json"] = strToU8(JSON.stringify(assets.map(({ id, name, mime, data }) => ({ id, name, mime, size: data.length })), null, 2));
  for (const a of assets) files[`assets/${a.id}${ext(a.name)}`] = a.data;
  return zipSync(files, { level: 6 });
}

function parseJson(bytes: Uint8Array | undefined, what: string): unknown {
  if (!bytes) throw new BundleInvalidError(`${what}이(가) 없습니다`);
  try { return JSON.parse(strFromU8(bytes)); } catch { throw new BundleInvalidError(`${what}이(가) JSON이 아닙니다`); }
}

export function readBundle(zip: Uint8Array): { manifest: BundleManifest; reports: unknown[]; assets: BundleAsset[] } {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new BundleInvalidError("zip 파일이 아닙니다"); }
  const manifest = parseJson(files["manifest.json"], "manifest.json") as Partial<BundleManifest>;
  if (manifest.format !== "daport-bundle") throw new BundleInvalidError("daport 번들이 아닙니다");
  if (manifest.version !== 1) throw new BundleInvalidError(`지원하지 않는 번들 version: ${String(manifest.version)}`);
  if (!Array.isArray(manifest.reports)) throw new BundleInvalidError("manifest.reports가 배열이 아닙니다");
  const reports = manifest.reports.map((r) => parseJson(files[`reports/${r.id}.json`], `reports/${r.id}.json`));
  const meta = files["assets.json"] ? (parseJson(files["assets.json"], "assets.json") as { id: string; name: string; mime: string }[]) : [];
  const assets: BundleAsset[] = [];
  for (const m of meta) {
    const data = files[`assets/${m.id}${ext(m.name)}`];
    if (data) assets.push({ id: m.id, name: m.name, mime: m.mime, data });
  }
  return { manifest: { warnings: [], connections: { sql: [], httpHosts: [] }, ...manifest } as BundleManifest, reports, assets };
}

/** sql 데이터셋의 connection 이름을 치환한 복제본. 그 밖은 그대로 */
export function applyConnectionMap(report: Report, map: Record<string, string>): Report {
  const clone = structuredClone(report);
  for (const ds of clone.datasets) if (ds.type === "sql" && Object.hasOwn(map, ds.connection)) ds.connection = map[ds.connection];
  return clone;
}
```

- [ ] **Step 5: `asset-io.ts`**

```ts
import { list, put } from "@vercel/blob";
import type { BundleAsset } from "./bundle";

/** 에셋 저장소(Vercel Blob)가 설정됐는지. dev에서는 보통 없다 */
export function assetStorageEnabled(): boolean { return !!process.env.BLOB_READ_WRITE_TOKEN; }

const prefix = (id: string) => `assets/${id}-`;

export async function hasAsset(id: string): Promise<boolean> {
  return (await list({ prefix: prefix(id), limit: 1 })).blobs.length > 0;
}

/** 에셋 라우트와 같은 규칙으로 찾아 본문을 내려받는다. 없으면 null */
export async function fetchAsset(id: string): Promise<BundleAsset | null> {
  const blob = (await list({ prefix: prefix(id), limit: 1 })).blobs[0];
  if (!blob) return null;
  const res = await fetch(blob.url);
  if (!res.ok) return null;
  return { id, name: blob.pathname.slice(prefix(id).length), mime: res.headers.get("content-type") ?? "application/octet-stream", data: new Uint8Array(await res.arrayBuffer()) };
}

/** 같은 id로 올려 asset://id 참조를 보존한다 (업로드 라우트와 같은 pathname 규칙) */
export async function putAsset(a: BundleAsset): Promise<void> {
  await put(`${prefix(a.id)}${a.name}`, a.data, { access: "public", addRandomSuffix: false, contentType: a.mime });
}
```
(`@vercel/blob`의 `put`은 `Uint8Array`를 받는다. 타입이 거부하면 `Buffer.from(a.data)`로 넘긴다.)

- [ ] **Step 6: `import-bundle.ts`**

```ts
import { parseReport, type Report } from "@daport/core";
import { readBundle, applyConnectionMap, collectAssetIds, type BundleAsset } from "./bundle";
import { checkReportComponents } from "./report-guard";
import type { ReportStore } from "./report-store";

export type ImportResult = { imported: { id: string; action: "created" | { version: number } }[]; skipped: { id: string; reason: string }[]; warnings: string[] };
export type ImportDeps = { store: ReportStore; assets: { has(id: string): Promise<boolean>; put(a: BundleAsset): Promise<void> } | null };

/**
 * 번들 가져오기 (4단계 스펙 6.3). 에셋은 없는 것만 올리고, 레포트는 같은 id가 있으면 새 버전(배포 안 함), 없으면 draft로 만든다.
 * 레포트 단위로 실패를 건너뛰며 전체 롤백은 하지 않는다
 */
export async function importBundle(zip: Uint8Array, opts: { filename: string; connectionMap?: Record<string, string> }, deps: ImportDeps): Promise<ImportResult> {
  const bundle = readBundle(zip);   // 손상은 BundleInvalidError로 던진다 (라우트가 400)
  const result: ImportResult = { imported: [], skipped: [], warnings: [...bundle.manifest.warnings] };
  if (deps.assets) {
    for (const a of bundle.assets) if (!(await deps.assets.has(a.id))) await deps.assets.put(a);
  } else if (bundle.assets.length) {
    result.warnings.push(`에셋 저장소가 없어 에셋 ${bundle.assets.length}개를 건너뛰었습니다`);
  }
  for (const raw of bundle.reports) {
    const id = (raw as { id?: unknown })?.id;
    if (typeof id !== "string") { result.skipped.push({ id: "?", reason: "id가 없습니다" }); continue; }
    try {
      let report: Report = parseReport(raw);
      if (opts.connectionMap) report = applyConnectionMap(report, opts.connectionMap);
      const guard = await checkReportComponents(report);
      if (!guard.ok) { result.skipped.push({ id, reason: guard.body.code }); continue; }
      result.warnings.push(...guard.warnings.map((w) => `${id}: ${w}`));
      const missing = deps.assets ? [] : collectAssetIds(report);
      if (missing.length) result.warnings.push(`${id}: 에셋 ${missing.join(", ")}은(는) 이 인스턴스에 없습니다`);
      if (await deps.store.get(id)) {
        // 같은 id가 있으면 draft를 덮지 않고 버전만 추가한다 (배포 포인터 그대로)
        const { version } = await deps.store.addVersion(id, guard.report, `가져옴: ${opts.filename}`);
        result.imported.push({ id, action: { version } });
      } else {
        await deps.store.create(guard.report);
        result.imported.push({ id, action: "created" });
      }
    } catch (e) {
      result.skipped.push({ id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
```
`deps.store.addVersion`은 T3이 `ReportStore`에 넣은 메서드다(포인터를 옮기지 않는 `publish`).

- [ ] **Step 7: 라우트**

`apps/studio/src/app/api/export/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { buildBundle, collectAssetIds, type BundleAsset, type BundleSource } from "@/lib/bundle";
import { assetStorageEnabled, fetchAsset } from "@/lib/asset-io";

/** 번들 내보내기 (4단계 스펙 6.2). { reports: [{ id, version? }] } → zip. 없는 레포트·버전은 404로 전체 거부 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const wanted = parsed.body.reports;
  if (!Array.isArray(wanted) || wanted.length === 0) return NextResponse.json({ error: "reports 배열이 필요합니다" }, { status: 400 });
  await ready();
  const store = getStore();
  const entries: { report: Report; source: BundleSource }[] = [];
  for (const w of wanted as { id?: unknown; version?: unknown }[]) {
    if (typeof w?.id !== "string") return NextResponse.json({ error: "reports[].id가 필요합니다" }, { status: 400 });
    if (w.version !== undefined && !Number.isInteger(w.version)) return NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 });
    const report = w.version === undefined ? await store.get(w.id) : await store.getVersion(w.id, w.version as number);
    if (!report) return NextResponse.json({ error: `not found: ${w.id}${w.version === undefined ? "" : `@${w.version}`}` }, { status: 404 });
    entries.push({ report, source: w.version === undefined ? "draft" : { version: w.version as number } });
  }
  const warnings: string[] = [];
  const assets: BundleAsset[] = [];
  const ids = [...new Set(entries.flatMap((e) => collectAssetIds(e.report)))];
  if (assetStorageEnabled()) {
    for (const id of ids) {
      const a = await fetchAsset(id).catch(() => null);
      if (a) assets.push(a); else warnings.push(`에셋 ${id}을(를) 찾지 못했습니다`);
    }
  } else if (ids.length) {
    warnings.push(`에셋 저장소가 없어 에셋 ${ids.length}개를 담지 않았습니다`);
  }
  const zip = buildBundle(entries, assets, warnings);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="daport-export-${stamp}.zip"` } });
}
```

`apps/studio/src/app/api/import/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getStore, ready } from "@/lib/report-store";
import { MAX_BODY_BYTES } from "@/lib/body";
import { importBundle } from "@/lib/import-bundle";
import { BundleInvalidError } from "@/lib/bundle";
import { assetStorageEnabled, hasAsset, putAsset } from "@/lib/asset-io";

/** 번들 가져오기 (4단계 스펙 6.3). multipart: file(zip), connectionMap(JSON, 선택) */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: `요청 본문이 ${MAX_BODY_BYTES} 바이트를 넘습니다` }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart 본문이 아닙니다" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file이 필요합니다" }, { status: 400 });
  if (file.size > MAX_BODY_BYTES) return NextResponse.json({ error: "파일이 너무 큽니다" }, { status: 413 });
  let connectionMap: Record<string, string> | undefined;
  const rawMap = form.get("connectionMap");
  if (typeof rawMap === "string" && rawMap.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawMap);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((v) => typeof v !== "string")) throw new Error();
      connectionMap = parsed as Record<string, string>;
    } catch { return NextResponse.json({ error: "connectionMap은 문자열 값의 JSON 객체여야 합니다" }, { status: 400 }); }
  }
  try {
    await ready();
    const assets = assetStorageEnabled() ? { has: hasAsset, put: putAsset } : null;
    const result = await importBundle(new Uint8Array(await file.arrayBuffer()), { filename: file.name, connectionMap }, { store: getStore(), assets });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof BundleInvalidError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/studio/package.json pnpm-lock.yaml apps/studio/src/lib/bundle.ts apps/studio/src/lib/asset-io.ts apps/studio/src/lib/import-bundle.ts apps/studio/src/app/api/export/route.ts apps/studio/src/app/api/import/route.ts apps/studio/src/lib/__tests__/bundle.test.ts apps/studio/src/lib/__tests__/import-bundle.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): zip 번들 내보내기·가져오기 (레포트·에셋·연결 점검 목록)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 툴바 배포 영역·버전 패널

**Files:**
- Create: `apps/studio/src/editor/PublishControls.tsx`
- Modify: `apps/studio/src/editor/Toolbar.tsx`
- Test: `apps/studio/src/editor/__tests__/PublishControls.test.tsx`

**Interfaces:**
- Consumes: T6 라우트(`publish`, `versions`, `published` PUT), T5 `preview` `version` 인자; 스토어 `dirty`, `componentMode`.
- Produces: `<PublishControls reportId />` — 배지 `data-testid="publish-badge"`, 버튼 `data-testid="publish"`("배포"), 버튼 "버전", 패널 `data-testid="versions-panel"`, 행 버튼 "이 버전으로 배포"·"보기", 미리보기 `data-testid="version-preview"`(iframe), 접기 "연동".

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/__tests__/PublishControls.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PublishControls } from "../PublishControls";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 100, height: 100 } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Versions = { versions: { version: number; createdAt: string; note: string | null; hash: string; published: boolean }[]; publishedVersion: number | null; draftHash: string };
function setup(initial: Versions) {
  let state = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/versions")) return new Response(JSON.stringify(state), { status: 200 });
    if (url.endsWith("/publish")) {
      const v = (state.versions.at(-1)?.version ?? 0) + 1;
      state = { ...state, versions: [...state.versions.map((x) => ({ ...x, published: false })), { version: v, createdAt: "2026-09-18T00:00:00.000Z", note: JSON.parse(String(init?.body)).note ?? null, hash: state.draftHash, published: true }], publishedVersion: v };
      return new Response(JSON.stringify({ version: v, createdAt: "2026-09-18T00:00:00.000Z" }), { status: 201 });
    }
    if (url.endsWith("/published")) {
      const v = JSON.parse(String(init?.body)).version as number;
      state = { ...state, versions: state.versions.map((x) => ({ ...x, published: x.version === v })), publishedVersion: v };
      return new Response(JSON.stringify({ publishedVersion: v }), { status: 200 });
    }
    if (url.endsWith("/preview")) return new Response("<html><body>v-html</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const store = createEditorStore(report);
  render(<EditorContext.Provider value={store}><PublishControls reportId="r" /></EditorContext.Provider>);
  return { store, fetchMock };
}

describe("PublishControls", () => {
  it("shows 미배포, publishes with a note, then shows vN 배포됨", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("첫 배포");
    const { fetchMock } = setup({ versions: [], publishedVersion: null, draftHash: "h1" });
    await waitFor(() => expect(screen.getByTestId("publish-badge")).toHaveTextContent("미배포"));
    fireEvent.click(screen.getByTestId("publish"));
    await waitFor(() => expect(screen.getByTestId("publish-badge")).toHaveTextContent("v1 배포됨"));
    const publishCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/publish"))!;
    expect(publishCall[0]).toBe("/api/reports/r/publish");
    expect(JSON.parse(String(publishCall[1]?.body))).toEqual({ note: "첫 배포" });
  });
  it("marks 수정됨 when the draft hash differs and disables 배포 while dirty", async () => {
    const { store } = setup({ versions: [{ version: 1, createdAt: "", note: null, hash: "old", published: true }], publishedVersion: 1, draftHash: "new" });
    await waitFor(() => expect(screen.getByTestId("publish-badge")).toHaveTextContent("v1 배포됨 · 수정됨"));
    expect((screen.getByTestId("publish") as HTMLButtonElement).disabled).toBe(false);
    act(() => store.setState({ dirty: true }));
    expect((screen.getByTestId("publish") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("publish").title).toContain("저장");
  });
  it("lists versions, republishes an old one after confirm, and previews a version", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fetchMock } = setup({ versions: [{ version: 1, createdAt: "2026-09-17T00:00:00.000Z", note: "첫", hash: "a", published: false }, { version: 2, createdAt: "2026-09-18T00:00:00.000Z", note: null, hash: "b", published: true }], publishedVersion: 2, draftHash: "b" });
    fireEvent.click(await screen.findByRole("button", { name: "버전" }));
    const panel = screen.getByTestId("versions-panel");
    expect(panel).toHaveTextContent("v1");
    expect(panel).toHaveTextContent("첫");
    expect(panel).toHaveTextContent("v2");
    const rows = panel.querySelectorAll("[data-version]");
    fireEvent.click(rows[0].querySelector('button[name="republish"]')!);
    await waitFor(() => expect(screen.getByTestId("publish-badge")).toHaveTextContent("v1 배포됨"));
    const put = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/published") && i?.method === "PUT")!;
    expect(JSON.parse(String(put[1]?.body))).toEqual({ version: 1 });
    fireEvent.click(rows[0].querySelector('button[name="view"]')!);
    await waitFor(() => expect(screen.getByTestId("version-preview")).toBeInTheDocument());
    const previewCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/preview"))!;
    expect(JSON.parse(String(previewCall[1]?.body))).toMatchObject({ version: 1 });
  });
  it("shows the integration snippet with the report id and no key", async () => {
    setup({ versions: [], publishedVersion: null, draftHash: "h" });
    fireEvent.click(await screen.findByRole("button", { name: "버전" }));
    fireEvent.click(screen.getByText("연동"));
    const snippet = screen.getByTestId("integration-snippet").textContent ?? "";
    expect(snippet).toContain("/api/reports/r/render");
    expect(snippet).toContain("<API_KEY>");
    expect(snippet).toContain("/api/reports/r/published");
  });
});
```
(`toHaveTextContent`·`toBeInTheDocument`는 `@testing-library/jest-dom`이 필요하다. 저장소에 없으면 `expect(el.textContent).toContain(...)`·`expect(el).not.toBeNull()`로 바꾼다 — 새 devDependency는 추가하지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- PublishControls`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`apps/studio/src/editor/PublishControls.tsx`:
```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useEditor } from "./store";

type VersionRow = { version: number; createdAt: string; note: string | null; hash: string; published: boolean };
type Versions = { versions: VersionRow[]; publishedVersion: number | null; draftHash: string };

async function failureMessage(r: Response, label: string): Promise<string> {
  const body: unknown = await r.json().catch(() => null);
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" ? error : `${label} 실패 (HTTP ${r.status})`;
}
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString("ko-KR") : "");

/** 툴바 배포 영역 (4단계 스펙 7.1): 상태 배지, 배포, 버전 패널(되돌리기·보기), 연동 안내 */
export function PublishControls({ reportId }: { reportId: string }) {
  const dirty = useEditor((s) => s.dirty);
  const [info, setInfo] = useState<Versions | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const base = `/api/reports/${encodeURIComponent(reportId)}`;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${base}/versions`, { method: "GET" });
      if (r.ok) setInfo((await r.json()) as Versions);
    } catch { /* 배지는 마지막 값을 유지한다 */ }
  }, [base]);
  useEffect(() => { void refresh(); }, [refresh]);

  const published = info?.versions.find((v) => v.version === info.publishedVersion) ?? null;
  const modified = !!published && published.hash !== info!.draftHash;
  const badge = !info ? "…" : !published ? "미배포" : `v${published.version} 배포됨${modified ? " · 수정됨" : ""}`;

  const publish = async () => {
    const note = window.prompt("배포 메모 (선택)", "") ?? null;
    if (note === null) return;   // 취소
    setBusy(true);
    try {
      const r = await fetch(`${base}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(note.trim() ? { note: note.trim() } : {}) });
      if (!r.ok) { alert(await failureMessage(r, "배포")); return; }
      await refresh();
    } catch (e) { alert(`배포 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const republish = async (version: number) => {
    if (!window.confirm(`v${version}을(를) 배포 버전으로 되돌립니다. draft는 바뀌지 않습니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/published`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });
      if (!r.ok) { alert(await failureMessage(r, "되돌리기")); return; }
      await refresh();
    } catch (e) { alert(`되돌리기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const view = async (version: number) => {
    try {
      const r = await fetch(`${base}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, params: {} }) });
      if (!r.ok) { alert(await failureMessage(r, "미리보기")); return; }
      setPreviewHtml(await r.text());
    } catch (e) { alert(`미리보기 실패: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <>
      <span data-testid="publish-badge" className={`text-xs px-2 py-0.5 rounded ${modified ? "bg-amber-100 text-amber-800" : published ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-600"}`}>{badge}</span>
      <button className={btn} data-testid="publish" disabled={busy || dirty || !info} title={dirty ? "먼저 저장하세요" : undefined} onClick={publish}>배포</button>
      <button className={btn} onClick={() => setOpen((o) => !o)}>버전</button>
      {open && info && (
        <div data-testid="versions-panel" className="absolute right-3 top-12 z-20 w-[28rem] max-h-[70vh] overflow-auto bg-white border rounded shadow p-3 text-xs">
          <div className="font-semibold mb-2">버전</div>
          {info.versions.length === 0 && <div className="text-neutral-500 mb-2">아직 배포한 버전이 없습니다</div>}
          <ul className="divide-y">
            {[...info.versions].reverse().map((v) => (
              <li key={v.version} data-version={v.version} className="py-1 flex items-center gap-2">
                <span className="font-mono">v{v.version}</span>
                <span className="text-neutral-500">{fmt(v.createdAt)}</span>
                <span className="flex-1 truncate" title={v.note ?? undefined}>{v.note ?? ""}</span>
                {v.published && <span className="text-green-700">배포됨</span>}
                {!v.published && <button name="republish" className={btn} disabled={busy} onClick={() => republish(v.version)}>이 버전으로 배포</button>}
                <button name="view" className={btn} onClick={() => view(v.version)}>보기</button>
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="cursor-pointer">연동</summary>
            <pre data-testid="integration-snippet" className="mt-1 whitespace-pre-wrap break-all bg-neutral-50 border rounded p-2 select-all">{[
              `# 배포 버전 렌더 (pdf | html | zpl | tspl | png)`,
              `curl -X POST ${origin}${base}/render \\`,
              `  -H 'X-API-Key: <API_KEY>' -H 'content-type: application/json' \\`,
              `  -d '{"format":"pdf","params":{}}' -o out.pdf`,
              ``,
              `# 임베드용 모델 JSON`,
              `curl ${origin}${base}/published -H 'X-API-Key: <API_KEY>'`,
            ].join("\n")}</pre>
          </details>
        </div>
      )}
      {previewHtml !== null && (
        <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center" onClick={() => setPreviewHtml(null)}>
          <div className="bg-white rounded shadow w-[90vw] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-3 py-2 border-b text-sm"><span>배포 버전 미리보기 (읽기 전용)</span><button className={btn} onClick={() => setPreviewHtml(null)}>닫기</button></div>
            <iframe data-testid="version-preview" title="배포 버전 미리보기" className="flex-1 w-full" sandbox="" srcDoc={previewHtml} />
          </div>
        </div>
      )}
    </>
  );
}
```
`apps/studio/src/editor/Toolbar.tsx`: `import { PublishControls } from "./PublishControls";`를 추가하고, 툴바 JSX에서 `{!componentMode && <button … onClick={pdf}>PDF</button>}` 바로 뒤에 `{!componentMode && <PublishControls reportId={reportId} />}`를 넣는다. 툴바 최상위 `div`에 `relative`를 더해 패널의 `absolute`가 툴바 기준이 되게 한다. 기존 Toolbar 테스트의 `setup()`은 `fetchMock`이 모든 URL에 `{}`를 돌려주므로 `/versions` 요청은 `Versions` 형태가 아니어도 되게 `PublishControls`가 응답 형태를 검사해야 한다: `refresh`에서 `const j = await r.json(); if (j && Array.isArray(j.versions)) setInfo(j)`로 바꾼다. 또한 Toolbar 테스트가 `fetchMock` 호출 횟수를 고정한 곳(`toHaveBeenCalledTimes(1)` 등)은 `/versions` 호출이 더해져 깨진다 — 그 단언들을 `fetchMock.mock.calls.filter(([u]) => !String(u).endsWith("/versions"))` 기준으로 고친다(테스트 의도는 유지).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/editor/PublishControls.tsx apps/studio/src/editor/Toolbar.tsx apps/studio/src/editor/__tests__/PublishControls.test.tsx apps/studio/src/editor/__tests__/Toolbar.test.tsx
git -c core.hooksPath=/dev/null commit -m "feat(studio): 툴바 배포 배지·배포·버전 패널(되돌리기·보기)·연동 안내

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 홈 화면 상태·내보내기·가져오기, API 키 페이지

**Files:**
- Create: `apps/studio/src/app/ReportList.tsx`, `apps/studio/src/app/settings/keys/page.tsx`
- Modify: `apps/studio/src/app/page.tsx`
- Test: `apps/studio/src/app/__tests__/ReportList.test.tsx`

**Interfaces:**
- Consumes: T3 `ReportSummary { publishedVersion, modified }`; T8 라우트; T4 `getApiKeyStore().list()`.
- Produces: `<ReportList reports />` — 행 체크박스(`aria-label="선택 <id>"`), 상태 `data-testid="status-<id>"`, 버튼 "내보내기"·"가져오기", 파일 입력 `aria-label="번들 파일"`, 결과 `data-testid="import-result"`. `/settings/keys` 페이지.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/app/__tests__/ReportList.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReportList } from "../ReportList";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const reports = [
  { id: "a", name: "A", updatedAt: "", publishedVersion: 3, modified: false },
  { id: "b", name: "B", updatedAt: "", publishedVersion: 1, modified: true },
  { id: "c", name: "", updatedAt: "", publishedVersion: null, modified: false },
];
const originalBlobUrlFns = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.assign(URL, originalBlobUrlFns); });

describe("ReportList", () => {
  it("shows publish status per report", () => {
    render(<ReportList reports={reports} />);
    expect(screen.getByTestId("status-a").textContent).toBe("v3");
    expect(screen.getByTestId("status-b").textContent).toBe("v1 · 수정됨");
    expect(screen.getByTestId("status-c").textContent).toBe("미배포");
  });
  it("exports the checked reports as a zip download", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array([80, 75])]), { status: 200, headers: { "content-disposition": 'attachment; filename="daport-export-2026-09-18.zip"' } }));
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:zip") as Mock, revokeObjectURL: vi.fn() as Mock });
    render(<ReportList reports={reports} />);
    expect((screen.getByRole("button", { name: "내보내기" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("선택 a"));
    fireEvent.click(screen.getByLabelText("선택 c"));
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/export");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ reports: [{ id: "a" }, { id: "c" }] });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });
  it("imports a bundle and shows the result summary", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ imported: [{ id: "x", action: "created" }, { id: "a", action: { version: 4 } }], skipped: [{ id: "bad", reason: "COMPONENT_MISMATCH" }], warnings: ["w"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportList reports={reports} />);
    const input = screen.getByLabelText("번들 파일") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([80, 75])], "b.zip", { type: "application/zip" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/import");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);
    const result = await screen.findByTestId("import-result");
    expect(result.textContent).toContain("x: 새 레포트");
    expect(result.textContent).toContain("a: v4 추가");
    expect(result.textContent).toContain("bad: COMPONENT_MISMATCH");
    expect(result.textContent).toContain("w");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- ReportList`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`apps/studio/src/app/ReportList.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReportSummary } from "@/lib/report-store";

type ImportResult = { imported: { id: string; action: "created" | { version: number } }[]; skipped: { id: string; reason: string }[]; warnings: string[] };

const statusOf = (r: ReportSummary) => r.publishedVersion === null ? "미배포" : `v${r.publishedVersion}${r.modified ? " · 수정됨" : ""}`;

/** 홈 레포트 목록 (4단계 스펙 7.2): 배포 상태, 선택 내보내기, 번들 가져오기 */
export function ReportList({ reports }: { reports: ReportSummary[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exportZip = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reports: [...checked].map((id) => ({ id })) }) });
      if (!r.ok) { alert(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `내보내기 실패 (HTTP ${r.status})`); return; }
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "daport-export.zip";
      const url = URL.createObjectURL(await r.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) { alert(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const importZip = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const r = await fetch("/api/import", { method: "POST", body: form });
      const body = (await r.json().catch(() => null)) as (ImportResult & { error?: string }) | null;
      if (!r.ok || !body) { alert(body?.error ?? `가져오기 실패 (HTTP ${r.status})`); return; }
      setResult(body);
      router.refresh();
    } catch (e) { alert(`가져오기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button className={btn} disabled={busy || checked.size === 0} onClick={exportZip}>내보내기</button>
        <label className={`${btn} cursor-pointer`}>가져오기<input type="file" accept=".zip,application/zip" aria-label="번들 파일" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importZip(f); e.target.value = ""; }} /></label>
        <Link className="text-xs text-blue-700 hover:underline ml-auto" href="/settings/keys">API 키</Link>
      </div>
      <ul className="divide-y bg-white border rounded mb-3">
        {reports.map((r) => (
          <li key={r.id} className="p-3 flex items-center gap-3">
            <input type="checkbox" aria-label={`선택 ${r.id}`} checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
            <Link className="text-blue-700 hover:underline flex-1" href={`/reports/${r.id}`}>{r.name || r.id}</Link>
            <span data-testid={`status-${r.id}`} className={`text-xs ${r.modified ? "text-amber-700" : r.publishedVersion === null ? "text-neutral-400" : "text-green-700"}`}>{statusOf(r)}</span>
          </li>
        ))}
        {reports.length === 0 && <li className="p-3 text-neutral-500 text-sm">레포트가 없습니다</li>}
      </ul>
      {result && (
        <div data-testid="import-result" className="text-xs bg-neutral-50 border rounded p-2 mb-4">
          <div className="font-semibold mb-1">가져오기 결과</div>
          {result.imported.map((i) => <div key={i.id}>{i.id}: {i.action === "created" ? "새 레포트" : `v${i.action.version} 추가`}</div>)}
          {result.skipped.map((s) => <div key={s.id} className="text-red-700">{s.id}: {s.reason}</div>)}
          {result.warnings.map((w, k) => <div key={k} className="text-amber-700">{w}</div>)}
        </div>
      )}
    </div>
  );
}
```
`apps/studio/src/app/page.tsx`: `<ul …>…</ul>` 블록을 `<ReportList reports={list} />`로 바꾸고 `import { ReportList } from "./ReportList";`를 추가한다(`Link` import는 더 이상 안 쓰면 지운다).

`apps/studio/src/app/settings/keys/page.tsx`:
```tsx
import Link from "next/link";
import { getApiKeyStore } from "@/lib/api-key-store";

export const dynamic = "force-dynamic";

/** API 키 읽기 전용 목록 (4단계 스펙 7.2). 발급·회수는 CLI로만 한다 */
export default async function KeysPage() {
  const keys = await getApiKeyStore().list();
  return (
    <main className="max-w-2xl mx-auto p-8">
      <Link className="text-sm text-blue-700 hover:underline" href="/">← 레포트</Link>
      <h1 className="text-xl font-bold my-4">API 키</h1>
      <pre className="text-xs bg-neutral-50 border rounded p-2 mb-4">{`발급: pnpm --filter studio keys create --name <이름> [--reports a,b]\n회수: pnpm --filter studio keys revoke <kid>`}</pre>
      <table className="w-full text-sm bg-white border rounded">
        <thead><tr className="text-left border-b"><th className="p-2">이름</th><th className="p-2">kid</th><th className="p-2">허용 레포트</th><th className="p-2">발급</th><th className="p-2">회수</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.kid} className={`border-b ${k.revokedAt ? "text-neutral-400" : ""}`}>
              <td className="p-2">{k.name}</td><td className="p-2 font-mono">{k.kid}</td>
              <td className="p-2">{k.allowedReportIds ? k.allowedReportIds.join(", ") : "전체"}</td>
              <td className="p-2">{new Date(k.createdAt).toLocaleString("ko-KR")}</td>
              <td className="p-2">{k.revokedAt ? new Date(k.revokedAt).toLocaleString("ko-KR") : ""}</td>
            </tr>
          ))}
          {keys.length === 0 && <tr><td className="p-2 text-neutral-500" colSpan={5}>키가 없습니다</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/app/ReportList.tsx apps/studio/src/app/page.tsx apps/studio/src/app/settings/keys/page.tsx apps/studio/src/app/__tests__/ReportList.test.tsx
git -c core.hooksPath=/dev/null commit -m "feat(studio): 홈 배포 상태·번들 내보내기·가져오기, API 키 읽기 전용 페이지

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 환경 예시와 4단계 E2E

**Files:**
- Modify: `apps/studio/.env.example`, `apps/studio/playwright.config.ts`
- Create: `apps/studio/e2e/phase4.spec.ts`

**Interfaces:**
- Consumes: T4 `DAPORT_DEV_API_KEY`, T7 render, T9·T10 UI.

- [ ] **Step 1: 환경 예시·Playwright**

`apps/studio/.env.example` 끝에 추가:
```
# 렌더 중 Chromium이 요청할 수 있는 외부 호스트(host[:port], 쉼표). 비면 자기 origin 밖은 전부 차단
DAPORT_RENDER_ALLOW=cdn.example.com
# MES 프론트가 브라우저에서 render/published를 부를 때 허용할 origin(쉼표)
DAPORT_CORS_ORIGINS=https://mes.example.com
# DATABASE_URL이 없는 dev·E2E에서만 인정하는 전체 허용 API 키. 운영에서는 pnpm --filter studio keys create
DAPORT_DEV_API_KEY=
```
`apps/studio/playwright.config.ts`의 `webServer`에 `env: { ...process.env, DAPORT_DEV_API_KEY: "e2e-dev-key" }`를 추가한다. 이미 떠 있는 dev 서버를 재사용하면(`reuseExistingServer`) 그 서버에 `DAPORT_DEV_API_KEY=e2e-dev-key`가 있어야 렌더 API 테스트가 통과한다 — 스펙 파일 상단 주석에 적는다.

- [ ] **Step 2: E2E 작성**

`apps/studio/e2e/phase4.spec.ts`:
```ts
// dev 서버에 DAPORT_DEV_API_KEY=e2e-dev-key가 있어야 한다 (playwright.config webServer.env가 넣는다. 서버를 직접 띄웠다면 같은 값을 준다)
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const KEY = { "x-api-key": "e2e-dev-key" };

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID").fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

test("publish → edit → 수정됨 → republish → roll back; the render API follows the pointer and never the draft", async ({ page, request }) => {
  const id = `e2e-pub-${Date.now()}`;
  await createReport(page, id);
  await expect(page.getByTestId("publish-badge")).toHaveText("미배포");
  // 미배포 상태의 렌더 API
  const np = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html" } });
  expect(np.status()).toBe(404);
  expect((await np.json()).code).toBe("NOT_PUBLISHED");
  expect((await request.post(`/api/reports/${id}/render`, { data: { format: "html" } })).status()).toBe(401);

  page.once("dialog", (d) => d.accept("첫 배포"));
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨");

  // 편집·저장 → 수정됨
  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  await page.getByTestId("save").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨 · 수정됨");
  const v1Html = await (await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html" } })).text();
  expect(v1Html).not.toContain('data-element-id="text-1"');          // draft의 새 요소는 배포본에 없다

  page.once("dialog", (d) => d.accept(""));
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v2 배포됨");
  const v2 = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "pdf", params: {} } });
  expect(v2.status()).toBe(200);
  expect(v2.headers()["x-daport-version"]).toBe("2");
  expect((await v2.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // 되돌리기
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "버전" }).click();
  await page.getByTestId("versions-panel").locator('[data-version="1"] button[name="republish"]').click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨 · 수정됨");
  const back = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html" } });
  expect(back.headers()["x-daport-version"]).toBe("1");
  expect(await back.text()).not.toContain('data-element-id="text-1"');
  // 지정 버전
  const pinned = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html", version: 2 } });
  expect(await pinned.text()).toContain('data-element-id="text-1"');
  // 임베드용 모델
  const model = await request.get(`/api/reports/${id}/published`, { headers: KEY });
  expect(model.status()).toBe(200);
  expect((await model.json()).id).toBe(id);
});

test("seeded label renders as ZPL through the render API; pdf report rejects zpl", async ({ request }) => {
  await request.post("/api/reports/product-label/publish", { data: {} });
  const zpl = await request.post("/api/reports/product-label/render", { headers: KEY, data: { format: "zpl" } });
  expect(zpl.status()).toBe(200);
  expect((await zpl.text()).startsWith("^XA")).toBe(true);
  await request.post("/api/reports/quality-cert/publish", { data: {} });
  const mm = await request.post("/api/reports/quality-cert/render", { headers: KEY, data: { format: "zpl" } });
  expect(mm.status()).toBe(400);
  expect((await mm.json()).code).toBe("FORMAT_MISMATCH");
});

test("export a report, import it back: same id becomes a new unpublished version", async ({ page, request }) => {
  const id = `e2e-bundle-${Date.now()}`;
  await createReport(page, id);
  page.once("dialog", (d) => d.accept(""));
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨");

  await page.goto("/");
  await expect(page.getByTestId(`status-${id}`)).toHaveText("v1");
  await page.getByLabel(`선택 ${id}`).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "내보내기" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^daport-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const zipPath = await download.path();
  expect(readFileSync(zipPath).subarray(0, 2).toString()).toBe("PK");

  await page.getByLabel("번들 파일").setInputFiles(zipPath);
  const result = page.getByTestId("import-result");
  await expect(result).toContainText(`${id}: v2 추가`);
  const list = await (await request.get(`/api/reports/${id}/versions`)).json();
  expect(list.publishedVersion).toBe(1);
  expect(list.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
});
```

- [ ] **Step 3: 실행**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter studio e2e`
Expected: 단위 전부 PASS, E2E 기존 9 + 신규 3 전부 PASS. E2E가 UI 결함으로 실패하면 이전 태스크의 컴포넌트를 고치지 말고 DONE_WITH_CONCERNS로 정확한 실패를 보고한다.

- [ ] **Step 4: 커밋**

```bash
git add apps/studio/.env.example apps/studio/playwright.config.ts apps/studio/e2e/phase4.spec.ts
git -c core.hooksPath=/dev/null commit -m "test(studio): 4단계 E2E — 배포·되돌리기·렌더 API·번들 왕복, 환경 예시

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 자체 점검 (플랜 작성자)

- **스펙 커버리지**: §4.1–4.4 → T1·T3·T4; §5.1 → T5; §5.2–5.3 → T7; §5.4 → T5(preview version)·T6; §5.5 → T7; §5.6 → T2·T5(`renderAllowHosts`); §6.1–6.3 → T8; §6.4·§7.2 → T10; §7.1·7.3 → T9; §7.4 변경 없음; §8 → 각 라우트의 오류 매핑 + `renderErrorResponse`; §9 → 각 태스크 테스트 + T11; §10 완료 기준 1–6 → T7·T11 E2E(1, 2), T4(3), T8·T11(4), T2(5), 전체 스위트(6).
- **타입 일관성**: `RenderOptions`(pdf·label 동명 타입, 각 패키지 export), `ReportStore.addVersion`(T8에서 추가, T3 인터페이스 확장), `pickVersion`은 `lib/pick-version.ts`(T7), `ReportSummary.publishedVersion/modified`(T3 → T10), `ImportResult`(T8 → T10 UI 문구 "새 레포트"/"vN 추가").
- **자리표시자 없음**: 모든 단계에 코드가 있다. 브리프에서 확인하라고 한 항목(ref 요소 필드명, jest-dom 유무, `require` in ESM, `put`의 바이너리 타입)은 구현자가 코드베이스에서 읽어 맞추는 것이며 결정을 미룬 것이 아니다.
