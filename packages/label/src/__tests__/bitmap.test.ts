import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { rowBytes, packGray, rgbaToGray, bitmapToPng, pxOf, fitGray } from "../bitmap";

describe("bitmap", () => {
  it("pxOf rounds mm at the given dpi", () => {
    expect(pxOf(100, 203)).toBe(799);
    expect(pxOf(60, 203)).toBe(480);
    expect(pxOf(40, 300)).toBe(472);
  });
  it("rowBytes pads to whole bytes", () => {
    expect([rowBytes(1), rowBytes(8), rowBytes(9), rowBytes(16)]).toEqual([1, 1, 2, 2]);
  });
  it("packGray sets 1 for pixels darker than the threshold, MSB first, padding with 0", () => {
    // 9×2: 첫 행은 검정 8개 + 흰 1개, 둘째 행은 흰 8개 + 검정 1개
    const gray = new Uint8Array([...Array(8).fill(0), 255, ...Array(8).fill(255), 0]);
    const bm = packGray(gray, 9, 2, 128);
    expect(bm).toEqual({ width: 9, height: 2, bits: new Uint8Array([0xff, 0x00, 0x00, 0x80]) });
    expect(packGray(new Uint8Array([127, 128]), 2, 1, 128).bits).toEqual(new Uint8Array([0x80]));
  });
  it("rgbaToGray uses luma and composites alpha over white", () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
    expect(Array.from(rgbaToGray(rgba, 4, 1))).toEqual([0, 255, 76, 255]);
  });
  it("bitmapToPng round-trips black and white", () => {
    const png = PNG.sync.read(bitmapToPng({ width: 9, height: 2, bits: new Uint8Array([0xff, 0x00, 0x00, 0x80]) }));
    expect([png.width, png.height]).toEqual([9, 2]);
    expect([png.data[0], png.data[(8) * 4], png.data[(9 + 8) * 4]]).toEqual([0, 255, 0]);
  });
  it("fitGray crops or pads (white) a gray buffer to the target size", () => {
    const src = new Uint8Array([0, 0, 0, 0, 0, 0]);   // 3×2 전부 검정
    expect(Array.from(fitGray(src, 3, 2, 2, 3))).toEqual([0, 0, 0, 0, 255, 255]);   // 폭은 자르고 높이는 흰색으로 채움
    expect(Array.from(fitGray(src, 3, 2, 3, 2))).toEqual(Array.from(src));
  });
});
