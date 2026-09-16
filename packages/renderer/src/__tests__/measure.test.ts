import { describe, it, expect } from "vitest";
import { measureWidth, wrapText, lineHeightMm } from "../text/measure";

describe("measure", () => {
  it("hangul is wider than latin i", () => {
    expect(measureWidth("가", 10, false)).toBeGreaterThan(measureWidth("i", 10, false));
  });
  it("width scales with font size", () => {
    expect(measureWidth("ABC", 20, false)).toBeCloseTo(measureWidth("ABC", 10, false) * 2, 5);
  });
  it("line height in mm for 10pt * 1.3", () => {
    expect(lineHeightMm(10, 1.3)).toBeCloseTo((10 / 72) * 25.4 * 1.3, 5);
  });
  it("wraps by width and breaks on spaces", () => {
    const lines = wrapText("hello world foo", 10, false, measureWidth("hello world", 10, false) + 0.1);
    expect(lines).toEqual(["hello world", "foo"]);
  });
  it("wraps hangul per character when no spaces", () => {
    const w = measureWidth("가나", 10, false);
    expect(wrapText("가나다라", 10, false, w + 0.01)).toEqual(["가나", "다라"]);
  });
  it("respects explicit newlines and never returns empty for empty string", () => {
    expect(wrapText("a\nb", 10, false, 100)).toEqual(["a", "b"]);
    expect(wrapText("", 10, false, 100)).toEqual([""]);
  });
  it("bold is wider than regular", () => {
    expect(measureWidth("A", 10, true)).toBeGreaterThan(measureWidth("A", 10, false));
  });
  it("CJK ideograph gets the hangul width estimate", () => {
    expect(measureWidth("漢", 10, false)).toBe(measureWidth("가", 10, false));
  });
  it("unlisted BMP char falls back to 0.6 of the hangul width", () => {
    expect(measureWidth("ẞ", 10, false)).toBeCloseTo(measureWidth("가", 10, false) * 0.6, 5);
  });
  it("symbol missing from Pretendard (◎) is not measured at the .notdef width", () => {
    expect(measureWidth("◎", 10, false)).toBe(measureWidth("가", 10, false));
  });
  it("leading whitespace before an overflowing word does not yield an empty line", () => {
    const w = measureWidth("가나", 10, false);
    expect(wrapText("  가나다라", 10, false, w + 0.01)).toEqual(["가나", "다라"]);
    expect(wrapText("          x", 10, false, measureWidth("x", 10, false) + 0.01)).toEqual(["x"]);
  });
});
