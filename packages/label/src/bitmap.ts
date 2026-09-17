import { PNG } from "pngjs";

/** 1비트 비트맵. 행마다 ceil(width/8)바이트, MSB가 왼쪽 픽셀, 1 = 검정, 남는 비트는 0 */
export type Bitmap = { width: number; height: number; bits: Uint8Array };

export const pxOf = (mm: number, dpi: number): number => Math.round((mm * dpi) / 25.4);
export const rowBytes = (width: number): number => Math.ceil(width / 8);

/** 회색조(0..255, 행 우선) → 임계값 미만이면 검정 */
export function packGray(gray: Uint8Array, width: number, height: number, threshold: number): Bitmap {
  const rb = rowBytes(width);
  const bits = new Uint8Array(rb * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) bits[y * rb + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, height, bits };
}

/** RGBA → 회색조. 투명은 흰 배경 위에 합성한다 */
export function rgbaToGray(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    out[i] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

/** 검정 0, 흰 255의 회색 PNG (미리보기·테스트용) */
export function bitmapToPng(bitmap: Bitmap): Buffer {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  const rb = rowBytes(bitmap.width);
  for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
    const black = (bitmap.bits[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1;
    const v = black ? 0 : 255, i = (y * bitmap.width + x) * 4;
    png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
