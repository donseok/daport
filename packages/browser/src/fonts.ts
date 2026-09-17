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
