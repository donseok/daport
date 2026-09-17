import { createRequire } from "node:module";
import { dirname } from "node:path";
// turbopackIgnore: Next 서버 번들이 .otf를 모듈로 끌어들이지 않고 런타임에 Node가 경로만 해석하게 한다
export const fontsDir = dirname(createRequire(import.meta.url).resolve(/* turbopackIgnore: true */ "@daport/renderer/fonts/Pretendard-Regular.otf"));
