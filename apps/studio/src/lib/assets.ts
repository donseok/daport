import { walkElements, type Report } from "@daport/core";

/** asset://id를 studio의 /api/assets/id로 바꾼 복제본. 그룹·반복 영역 템플릿 자식까지 */
export function resolveAssetUrls(report: Report, baseUrl: string): Report {
  const clone = structuredClone(report);
  walkElements(clone.elements, (el) => {
    if (el.type === "image" && el.src.startsWith("asset://")) el.src = `${baseUrl}/api/assets/${el.src.slice("asset://".length)}`;
  });
  return clone;
}
