import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { BrowserContext } from "playwright";

// turbopackIgnore: Next 서버 번들이 .otf를 모듈로 끌어들이지 않고 런타임에 Node가 경로만 해석하게 한다
const fontsDir = dirname(createRequire(import.meta.url).resolve(/* turbopackIgnore: true */ "@daport/renderer/fonts/Pretendard-Regular.otf"));
/** setContent 문서(about:blank)는 file:// 폰트를 CORS로 거부하므로 가상 오리진에서 라우트로 서빙한다 */
export const fontBaseUrl = "http://fonts.daport.local";
const fontCache = new Map<string, Promise<Buffer>>();

function readFont(name: string): Promise<Buffer> {
  let p = fontCache.get(name);
  if (!p) {
    p = readFile(join(fontsDir, name));
    p.catch(() => fontCache.delete(name));     // 실패한 읽기는 캐시하지 않는다
    fontCache.set(name, p);
  }
  return p;
}

export async function serveFonts(ctx: BrowserContext): Promise<void> {
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
