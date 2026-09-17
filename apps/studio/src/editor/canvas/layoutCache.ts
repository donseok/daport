import type { Report } from "@daport/core";
import { layout } from "@daport/renderer/layout";
import type { Page } from "@daport/renderer";
import { sampleContext } from "@/lib/data";
import { resolveAssetUrls } from "@/lib/assets";

const cache = new WeakMap<Report, Page[]>();

/**
 * 캔버스가 그리는 레이아웃. 스토어의 report 객체는 편집마다 새로 만들어지므로 객체를 키로 한 번만 계산해
 * 캔버스와 페이지 선택기가 같은 결과를 쓴다. 스펙 10: 디자이너는 표현식 오류를 요소마다 #ERR로 보인다
 */
export function layoutFor(report: Report): Page[] {
  let pages = cache.get(report);
  if (!pages) {
    pages = layout({ ...resolveAssetUrls(report, ""), onExpressionError: "blank" }, sampleContext(report));
    cache.set(report, pages);
  }
  return pages;
}
