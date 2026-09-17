import type { Report } from "@daport/core";
import { layout } from "@daport/renderer/layout";
import type { Page } from "@daport/renderer";
import { sampleContext } from "@/lib/data";
import { resolveAssetUrls } from "@/lib/assets";

const cache = new WeakMap<Report, Page[]>();
const errorCache = new WeakMap<Report, string>();

/** 상한 초과(LayoutLimitError) 등 layout()이 던지는 어떤 오류에도 쓰는 빈 페이지 1장 */
function blankPage(report: Report): Page {
  return { index: 0, width: report.page.width, height: report.page.height, items: [], copyIndex: 0, pageInCopy: 0 };
}

/**
 * 캔버스가 그리는 레이아웃. 스토어의 report 객체는 편집마다 새로 만들어지므로 객체를 키로 한 번만 계산해
 * 캔버스와 페이지 선택기가 같은 결과를 쓴다. 스펙 10: 디자이너는 표현식 오류를 요소마다 #ERR로 보인다.
 *
 * 이 함수는 전체(total) 함수다 — layout()이 무엇을 던지든(예: 200행 샘플에 여러 페이지 표를 반복해 상한을 넘는
 * LayoutLimitError) 여기서 잡아 빈 페이지 1장을 돌려준다. Toolbar의 PageSelector는 EditorErrorBoundary 밖에
 * 있어(Toolbar.tsx), 여기서 던지면 편집기 전체가 언마운트되고 저장 안 한 편집을 모두 잃는다.
 */
export function layoutFor(report: Report): Page[] {
  let pages = cache.get(report);
  if (!pages) {
    try {
      pages = layout({ ...resolveAssetUrls(report, ""), onExpressionError: "blank" }, sampleContext(report));
    } catch (e) {
      pages = [blankPage(report)];
      errorCache.set(report, e instanceof Error ? e.message : String(e));
    }
    cache.set(report, pages);
  }
  return pages;
}

/** layoutFor가 캐시해 둔 오류 메시지. 정상 계산이면 undefined (Canvas가 빨간 배너로 보인다) */
export function layoutError(report: Report): string | undefined {
  return errorCache.get(report);
}
