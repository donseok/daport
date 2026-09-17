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
