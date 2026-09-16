import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Report, DataContext } from "@daport/core";
import { renderToHtml } from "@daport/renderer";
import { getBrowser } from "./pool";
export { closePool } from "./pool";

const fontsDir = resolve(dirname(createRequire(import.meta.url).resolve("@daport/renderer")), "../fonts");
/** setContent 문서(about:blank)는 file:// 폰트를 CORS로 거부하므로 가상 오리진에서 라우트로 서빙한다 */
const fontBaseUrl = "http://fonts.daport.local";
const fontCache = new Map<string, Promise<Buffer>>();

function readFont(name: string): Promise<Buffer> {
  let p = fontCache.get(name);
  if (!p) { p = readFile(join(fontsDir, name)); fontCache.set(name, p); }
  return p;
}

async function serveFonts(ctx: import("playwright").BrowserContext): Promise<void> {
  await ctx.route(`${fontBaseUrl}/**`, async (route) => {
    const name = basename(new URL(route.request().url()).pathname);
    try {
      const body = await readFont(name);
      await route.fulfill({ status: 200, body, headers: { "content-type": "font/otf", "access-control-allow-origin": "*" } });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}

async function withPage<T>(html: string, fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext();
  try {
    await serveFonts(ctx);
    const page = await ctx.newPage();
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
