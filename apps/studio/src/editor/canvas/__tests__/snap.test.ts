import { describe, it, expect } from "vitest";
import { snapMm, pxToMm, mmToPxScaled } from "../snap";

describe("snap", () => {
  it("snaps to 0.5mm grid", () => {
    expect(snapMm(10.24)).toBe(10);
    expect(snapMm(10.26)).toBe(10.5);
    expect(snapMm(3.1, 1)).toBe(3);
  });
  it("converts px <-> mm with zoom", () => {
    expect(pxToMm(96, 1)).toBeCloseTo(25.4, 5);
    expect(pxToMm(192, 2)).toBeCloseTo(25.4, 5);
    expect(mmToPxScaled(25.4, 2)).toBeCloseTo(192, 5);
  });
});
