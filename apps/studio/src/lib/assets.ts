import { walkElements, type Element, type Report } from "@daport/core";

const PREFIX = "asset://";

/** asset://id면 studio의 /api/assets/id로, 아니면 그대로 */
function resolved(value: string, baseUrl: string): string {
  return value.startsWith(PREFIX) ? `${baseUrl}/api/assets/${value.slice(PREFIX.length)}` : value;
}

/** 요소 트리 한 그루(그룹·반복 영역 템플릿 자식 포함)의 image src와 ref 입력값을 제자리에서 바꾼다 */
function resolveTree(elements: Element[], baseUrl: string): void {
  walkElements(elements, (el) => {
    if (el.type === "image") el.src = resolved(el.src, baseUrl);
    else if (el.type === "ref") {
      for (const [name, value] of Object.entries(el.props)) {
        if (typeof value === "string") el.props[name] = resolved(value, baseUrl);
      }
    }
  });
}

/**
 * asset://id를 studio의 /api/assets/id로 바꾼 복제본. 레포트 본문과 컴포넌트 내용의 image src,
 * ref 입력값과 image 입력값 기본값까지 훑는다(그룹·반복 영역 템플릿 자식 포함).
 * 표현식이 평가되어 나오는 asset://는 다루지 않는다(문서에 적힌 값만 바꾼다)
 */
export function resolveAssetUrls(report: Report, baseUrl: string): Report {
  const clone = structuredClone(report);
  resolveTree(clone.elements, baseUrl);
  for (const body of Object.values(clone.components)) {
    resolveTree(body.elements, baseUrl);
    for (const prop of body.props) if (prop.type === "image") prop.default = resolved(prop.default, baseUrl);
  }
  return clone;
}
