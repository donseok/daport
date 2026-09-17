export const MAX_PAGES = 2000;

/** 전체 페이지 수가 상한을 넘었다. 라우트는 400 { code: "LAYOUT_LIMIT" }로 바꾼다 */
export class LayoutLimitError extends Error {
  readonly code = "LAYOUT_LIMIT";
  constructor(pages: number, limit: number = MAX_PAGES) {
    super(`layout produced ${pages} pages, more than the limit of ${limit}`);
    this.name = "LayoutLimitError";
  }
}
