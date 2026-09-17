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
