import { describe, it, expect, vi } from "vitest";
import * as measure from "../text/measure";
import { createMeasureCache } from "../text/cache";
import { LayoutLimitError, MAX_PAGES } from "../layout/errors";

describe("createMeasureCache", () => {
  it("returns wrapText's result and calls wrapText once per distinct (text,size,bold,width)", () => {
    const spy = vi.spyOn(measure, "wrapText");
    const c = createMeasureCache();
    const a = c.wrap("가나다 라마바", 10, false, 20);
    expect(a).toEqual(measure.wrapText("가나다 라마바", 10, false, 20));
    c.wrap("가나다 라마바", 10, false, 20);
    c.wrap("가나다 라마바", 10, true, 20);
    c.wrap("가나다 라마바", 10, false, 21);
    expect(spy.mock.calls.length).toBe(4);   // 위 직접 호출 1 + 캐시 미스 3
    spy.mockRestore();
  });
  it("does not share entries between caches", () => {
    const spy = vi.spyOn(measure, "wrapText");
    createMeasureCache().wrap("x", 10, false, 10);
    createMeasureCache().wrap("x", 10, false, 10);
    expect(spy.mock.calls.length).toBe(2);
    spy.mockRestore();
  });
});

describe("LayoutLimitError", () => {
  it("has code LAYOUT_LIMIT and a default limit of 2000 pages", () => {
    const e = new LayoutLimitError(2001);
    expect(e.code).toBe("LAYOUT_LIMIT");
    expect(e.message).toContain("2001");
    expect(e).toBeInstanceOf(Error);
    expect(MAX_PAGES).toBe(2000);
  });
});
