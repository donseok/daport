import { describe, it, expect } from "vitest";
import { toMm, mmToPx, mmToPt } from "../units";

describe("units", () => {
  it("converts pt and px to mm", () => {
    expect(toMm(72, "pt")).toBeCloseTo(25.4, 5);
    expect(toMm(96, "px")).toBeCloseTo(25.4, 5);
    expect(toMm(10, "mm")).toBe(10);
  });
  it("converts mm to px at 96dpi and to pt", () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 5);
    expect(mmToPt(25.4)).toBeCloseTo(72, 5);
  });
});
