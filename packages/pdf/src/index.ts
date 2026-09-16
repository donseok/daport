import type { Page } from "playwright";
import { renderToHtml, type Report, type DataContext } from "@daport/renderer";
import { getBrowser } from "./pool";
import { fontBaseUrl, serveFonts } from "./fonts";
import { isBrowserCrash } from "./crash";
export { closePool } from "./pool";

/** 라우트 maxDuration(60초) 안에 크래시 재시도까지 두 번 시도가 들어가도록 문서 로드를 묶는다 (page.pdf에는 timeout 옵션이 없다) */
const SET_CONTENT_TIMEOUT_MS = 20_000;

async function withPage<T>(html: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const ctx = await b.newContext();
  try {
    await serveFonts(ctx);
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: SET_CONTENT_TIMEOUT_MS });
    await page.evaluate(() => document.fonts.ready);
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
    if (attempt === 0 && isBrowserCrash(e)) return renderPdf(report, data, 1);     // Chromium 크래시·끊김만 1회 재시도
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
