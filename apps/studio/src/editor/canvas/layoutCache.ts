import type { Report } from "@daport/core";
import { layout } from "@daport/renderer/layout";
import type { Page } from "@daport/renderer";
import { sampleContext } from "@/lib/data";
import { resolveAssetUrls } from "@/lib/assets";

type Entry = { props: Record<string, unknown> | undefined; pages: Page[]; error?: string };
const cache = new WeakMap<Report, Entry>();

/** 상한 초과(LayoutLimitError) 등 layout()이 던지는 어떤 오류에도 쓰는 빈 페이지 1장 */
function blankPage(report: Report): Page {
  return { index: 0, width: report.page.width, height: report.page.height, items: [], copyIndex: 0, pageInCopy: 0 };
}

/**
 * 캔버스가 그리는 레이아웃. 스토어의 report 객체는 편집마다 새로 만들어지므로 객체를 키로 한 번만 계산해
 * 캔버스와 페이지 선택기가 같은 결과를 쓴다. 스펙 10: 디자이너는 표현식 오류를 요소마다 #ERR로 보인다.
 * props(컴포넌트 편집 화면의 샘플 입력값)는 참조로 비교한다 — 같은 report라도 props 객체가 바뀌면 다시 계산한다.
 *
 * 이 함수는 전체(total) 함수다 — layout()이 무엇을 던지든(예: 200행 샘플에 여러 페이지 표를 반복해 상한을 넘는
 * LayoutLimitError) 여기서 잡아 빈 페이지 1장을 돌려준다. Toolbar의 PageSelector는 EditorErrorBoundary 밖에
 * 있어(Toolbar.tsx), 여기서 던지면 편집기 전체가 언마운트되고 저장 안 한 편집을 모두 잃는다.
 */
export function layoutFor(report: Report, props?: Record<string, unknown>): Page[] {
  const hit = cache.get(report);
  if (hit && hit.props === props) return hit.pages;
  const entry: Entry = { props, pages: [] };
  try {
    entry.pages = layout({ ...resolveAssetUrls(report, ""), onExpressionError: "blank" }, sampleContext(report, props));
  } catch (e) {
    entry.pages = [blankPage(report)];
    entry.error = e instanceof Error ? e.message : String(e);
  }
  cache.set(report, entry);
  return entry.pages;
}

/** layoutFor가 캐시해 둔 오류 메시지. 정상 계산이거나 같은 props로 계산한 적이 없으면 undefined (Canvas가 빨간 배너로 보인다) */
export function layoutError(report: Report, props?: Record<string, unknown>): string | undefined {
  const hit = cache.get(report);
  return hit && hit.props === props ? hit.error : undefined;
}
