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
