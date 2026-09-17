/// <reference path="./bwip-js.d.ts" />
import bwipjs from "bwip-js";
import type { BarcodeFormat } from "@daport/core";

/** 값이 비었거나 형식에 맞지 않는다. 레이아웃은 ExpressionError처럼 요소 단위로 격리한다 */
export class BarcodeError extends Error {
  constructor(public format: string, public value: string, cause: unknown) {
    super(`Barcode error (${format}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "BarcodeError";
  }
}

export type BarcodeOptions = { showText: boolean; fontSize: number };

/** bwip-js 심볼 이름 */
const BCID: Record<BarcodeFormat, string> = { code128: "code128", ean13: "ean13", qr: "qrcode", code39: "code39", datamatrix: "datamatrix" };
export const BARCODE_2D: ReadonlySet<string> = new Set(["qr", "datamatrix"]);
// bwip-js toSVG는 루트에 width/height 없이 viewBox만 낸다("<svg viewBox=\"0 0 W H\" xmlns=...>") — 뗄 속성이 없으니 태그 바로 뒤에 끼워 넣는다
const ROOT_TAG_RE = /^<svg\b/;

/**
 * 바코드 SVG. 크기 속성을 떼고 상자에 맞춰 늘린다: 1D는 가로로 늘리고(preserveAspectRatio none), 2D는 정사각형으로 상자 안에 맞춘다.
 * bwip-js는 텍스트를 글리프 경로로 그리므로 값이 마크업으로 새지 않는다
 */
export function renderBarcode(format: BarcodeFormat, value: string, opts: BarcodeOptions): string {
  if (value === "") throw new BarcodeError(format, value, "empty value");
  const is2d = BARCODE_2D.has(format);
  let svg: string;
  try {
    svg = bwipjs.toSVG({
      bcid: BCID[format], text: value, scale: 2,
      // 1D 모듈 높이(mm 단위 bwip 기본). 상자에 맞춰 늘리므로 비율만 의미 있다. bwip-js는 height:undefined도 거부하므로 2D는 키 자체를 뺀다
      ...(is2d ? {} : { height: 10 }),
      includetext: !is2d && opts.showText, textxalign: "center", textsize: opts.fontSize,
    });
  } catch (e) {
    throw new BarcodeError(format, value, e);
  }
  const ratio = is2d ? 'preserveAspectRatio="xMidYMid meet"' : 'preserveAspectRatio="none"';
  if (!ROOT_TAG_RE.test(svg)) throw new BarcodeError(format, value, "unexpected svg root");   // bwip-js 출력이 svg로 시작하지 않으면 형식이 바뀐 것
  return svg.replace(ROOT_TAG_RE, `<svg width="100%" height="100%" ${ratio}`);
}
