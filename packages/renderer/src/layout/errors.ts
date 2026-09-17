export const MAX_PAGES = 2000;

/** 전체 페이지 수가 상한을 넘었다. 라우트는 400 { code: "LAYOUT_LIMIT" }로 바꾼다 */
export class LayoutLimitError extends Error {
  readonly code = "LAYOUT_LIMIT";
  constructor(pages: number, limit: number = MAX_PAGES) {
    super(`layout produced ${pages} pages, more than the limit of ${limit}`);
    this.name = "LayoutLimitError";
  }
}

/**
 * 흐름 요소의 이어지는 페이지 영역에 남은 어떤 조각도 들어갈 수 없다(머리행·페이지 소계 예약 뒤 가용 높이가 가장 작은 조각보다 작다).
 * 그대로 두면 조각마다 잘린 페이지를 하나씩 만들므로, 레이아웃은 그 요소를 #ERR 한 칸으로 바꾼다(fail 모드에서는 던진다)
 */
export class RegionTooSmallError extends Error {
  readonly code = "REGION_TOO_SMALL";
  constructor(available: number, needed: number) {
    super(`continuation region too small: ${available.toFixed(1)}mm available, smallest block needs ${needed.toFixed(1)}mm`);
    this.name = "RegionTooSmallError";
  }
}
