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
});
