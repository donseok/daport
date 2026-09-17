import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdf as pdfToImg } from "pdf-to-img";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { parseReport } from "@daport/core";
import { layout } from "@daport/renderer";
import { renderPdf, renderHtmlScreenshot, closePool } from "../index";
import { fixtureContext } from "../../../renderer/src/__tests__/fixtures/context";
import inspection from "../../../renderer/src/__tests__/fixtures/inspection-cert.report.json";
import invoice from "../../../renderer/src/__tests__/fixtures/invoice.report.json";
import shipping from "../../../renderer/src/__tests__/fixtures/shipping-order.report.json";
import badges from "../../../renderer/src/__tests__/fixtures/badge-sheet.report.json";
import componentDemo from "../../../renderer/src/__tests__/fixtures/component-demo.report.json";

/**
 * ±1px 세로 정렬 오차를 허용하는 shiftTolerantDiffRatio로 측정한 기준선 (표 테두리의 래스터 서브픽셀 드리프트를 뺀 값):
 * badge-sheet 0.0003/0.0007, inspection-cert 2쪽 0.00108, invoice 2쪽 0.00143, shipping-order 1쪽 0.00693 — 예제
 * 4종은 이 값들 중 가장 큰 것의 약 1.4배를 예산으로 둔다. pdf.test.ts의 sparse 골든(0.001)과 달리, 밀집한 표가
 * 많은 실제 양식은 헤어라인 테두리의 AA 강도차와 텍스트 AA 노이즈가 위치 이동 없이도 누적되기 때문이다
 * (아래 lineRunStarts로 행 배치 자체는 별도로 검증한다)
 */
const MAX_DIFF_RATIO_DENSE = 0.01;

function crop(png: PNG, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
  return out;
}

/** pixelmatch가 다르다고 본 픽셀 중, 상대 래스터의 위·아래 1px 안에 같은 색이 있으면 래스터 정렬 오차로 보고 세지 않는다 (표 테두리의 서브픽셀 드리프트) */
function shiftTolerantDiffRatio(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  const mask = new Uint8Array(w * h * 4);
  pixelmatch(a, b, mask, w, h, { threshold: 0.2, diffColor: [255, 0, 0], diffColorAlt: [255, 0, 0], diffMask: true });
  const same = (img: Uint8Array, i: number, j: number) => Math.abs(img[i] - a[j]) <= 24 && Math.abs(img[i + 1] - a[j + 1]) <= 24 && Math.abs(img[i + 2] - a[j + 2]) <= 24;
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    if (mask[j + 3] === 0) continue;   // diffMask: 다른 픽셀만 불투명
    const up = y > 0 ? (((y - 1) * w + x) * 4) : -1, down = y < h - 1 ? (((y + 1) * w + x) * 4) : -1;
    const tolerated = (up >= 0 && same(b, up, j)) || (down >= 0 && same(b, down, j));
    if (!tolerated) n++;
  }
  return n / (w * h);
}

/**
 * x 열을 따라 내려가며 가로 선(표 테두리·카드 경계)이 시작되는 줄 수를 센다. x-20..x+20(41px≈10.8mm) 폭 전체가
 * 어두워야("선") 그 y를 인정한다 — 표 테두리·카드 경계는 30mm 이상 이어지지만 글자 획(굵은 제목 포함)은 길어야
 * 6mm 정도라 이 폭 전체를 채우지 못해 걸러진다. 래스터 AA 차이와 무관하게 행 배치가 같은지 본다
 */
function lineRunStarts(png: PNG, xPx: number): number {
  const isLine = (y: number) => {
    for (let dx = -20; dx <= 20; dx++) {
      const i = (y * png.width + (xPx + dx)) * 4;
      if ((png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3 >= 128) return false;
    }
    return true;
  };
  let runs = 0, prev = false;
  for (let y = 0; y < png.height; y++) {
    const dark = isLine(y);
    if (dark && !prev) runs++;
    prev = dark;
  }
  return runs;
}

afterAll(closePool);

describe("multi-page PDF", () => {
  it.each([["inspection-cert", inspection], ["invoice", invoice], ["shipping-order", shipping], ["badge-sheet", badges], ["component-demo", componentDemo]])(
    "%s: PDF page count equals layout page count and every page matches its HTML screenshot", async (_name, fixture) => {
      const report = parseReport(fixture);
      const data = fixtureContext(report);
      const expected = layout(report, data).length;
      const buf = await renderPdf(report, data);
      expect((await PDFDocument.load(buf)).getPageCount()).toBe(expected);
      const doc = await pdfToImg(buf, { scale: 96 / 72 });
      for (let p = 1; p <= expected; p++) {
        const pdfPng = PNG.sync.read(Buffer.from(await doc.getPage(p)));
        const htmlPng = PNG.sync.read(await renderHtmlScreenshot(report, data, { pageIndex: p - 1 }));
        const w = Math.min(htmlPng.width, pdfPng.width), h = Math.min(htmlPng.height, pdfPng.height);
        const htmlCrop = crop(htmlPng, w, h), pdfCrop = crop(pdfPng, w, h);
        const ratio = shiftTolerantDiffRatio(htmlCrop.data, pdfCrop.data, w, h);
        expect(ratio, `${_name} page ${p}`).toBeLessThan(MAX_DIFF_RATIO_DENSE);
        for (const f of [0.25, 0.5, 0.75]) {
          const x = Math.min(Math.max(Math.round(w * f), 20), w - 21);   // x±20이 크롭 안에 들어오도록 클램프
          expect(Math.abs(lineRunStarts(htmlCrop, x) - lineRunStarts(pdfCrop, x)), `${_name} page ${p} x=${x}`).toBeLessThanOrEqual(1);
        }
      }
    }, 120_000);
});
