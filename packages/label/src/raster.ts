import { PNG } from "pngjs";
import { renderToHtml, type Report, type DataContext } from "@daport/renderer";
import { withPage, fontBaseUrl, isBrowserCrash } from "@daport/browser";
import { fontsDir } from "./fonts-dir";
import { packGray, rgbaToGray, fitGray, pxOf, type Bitmap } from "./bitmap";

export const MAX_LABEL_PIXELS = 50_000_000;

/** allowHosts: 렌더 중 Chromium이 요청할 수 있는 호스트(포트 포함). 생략하면 제한하지 않는다 (4단계 스펙 5.6) */
export type RenderOptions = { allowHosts?: string[] };

/** 라벨 비트맵이 너무 크다 (메모리 보호). 라우트는 400 { code: "LABEL_TOO_LARGE" } */
export class LabelTooLargeError extends Error {
  readonly code = "LABEL_TOO_LARGE";
  constructor(pixels: number) { super(`label bitmap of ${pixels} pixels exceeds ${MAX_LABEL_PIXELS}`); this.name = "LabelTooLargeError"; }
}

/**
 * 같은 HTML을 목표 DPI로 스크린샷해 페이지마다 1비트 비트맵을 만든다 (스펙 6.2).
 * deviceScaleFactor = dpi/96으로 CSS 픽셀을 프린터 픽셀에 맞추고, 결과를 목표 크기로 맞춘다
 */
export async function rasterizePages(report: Report, data: DataContext, dpi: number, threshold: number, opts: RenderOptions = {}, attempt = 0): Promise<Bitmap[]> {
  const w = pxOf(report.page.width, dpi), h = pxOf(report.page.height, dpi);
  if (w * h > MAX_LABEL_PIXELS) throw new LabelTooLargeError(w * h);
  const html = renderToHtml(report, data, { fontBaseUrl });
  try {
    return await withPage(html, { fontsDir, deviceScaleFactor: dpi / 96, allowHosts: opts.allowHosts }, async (page) => {
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
    if (attempt === 0 && isBrowserCrash(e)) return rasterizePages(report, data, dpi, threshold, opts, 1);   // pdf와 같은 1회 재시도
    throw e;
  }
}
