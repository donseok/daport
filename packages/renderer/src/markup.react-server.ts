import { createRequire } from "node:module";
import type { ReactElement } from "react";

// Next.js App Route/RSC 번들(react-server 조건)은 react-dom/server를 빈 스텁으로 해석하고 정적 import 자체를 막는다.
// 그래서 여기서는 번들러를 거치지 않고 Node가 직접 require한 react-dom/server로 그린다.
const nodeRequire = createRequire(import.meta.url);

export function renderToStaticMarkup(element: ReactElement): string {
  const server = nodeRequire(/* turbopackIgnore: true */ "react-dom/server") as typeof import("react-dom/server");
  return server.renderToStaticMarkup(element);
}
