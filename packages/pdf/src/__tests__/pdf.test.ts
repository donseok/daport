import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdf as pdfToImg } from "pdf-to-img";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { parseReport, resolveData, type Report, type DataContext } from "@daport/core";
import { renderPdf, renderHtmlScreenshot, closePool } from "../index";
import qualityCert from "../../../renderer/src/__tests__/fixtures/quality-cert.report.json";

const mkReport = (w: number, h: number) => parseReport({ id: "t", version: 1, page: { width: w, height: h }, elements: [
  { id: "r", type: "rect", x: 2, y: 2, w: w - 4, h: h - 4, style: { stroke: "#000", strokeWidth: 0.5 } },
  { id: "t", type: "text", x: 5, y: 5, w: w - 10, h: 10, value: "품질 TEST 123", style: { fontSize: 12, bold: true } },
]});

/** 96dpi 반올림으로 두 래스터가 1px 어긋날 수 있어 공통 크기로 잘라 비교한다 */
function crop(png: PNG, w: number, h: number): Uint8Array {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
  return out.data;
}

/** PDF 첫 페이지(96dpi 래스터)와 HTML 스크린샷의 다른 픽셀 비율 */
async function rasterDiff(report: Report, data: DataContext): Promise<number> {
  const buf = await renderPdf(report, data);
  const doc = await pdfToImg(buf, { scale: 96 / 72 });   // 96dpi
  const pdfPng = PNG.sync.read(Buffer.from((await doc.getPage(1))));
  const htmlPng = PNG.sync.read(await renderHtmlScreenshot(report, data));
  expect(Math.abs(htmlPng.width - pdfPng.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(htmlPng.height - pdfPng.height)).toBeLessThanOrEqual(1);
  const w = Math.min(htmlPng.width, pdfPng.width), h = Math.min(htmlPng.height, pdfPng.height);
  const diff = pixelmatch(crop(htmlPng, w, h), crop(pdfPng, w, h), undefined, w, h, { threshold: 0.2 });
  return diff / (w * h);
}

afterAll(closePool);

describe("renderPdf", () => {
  it.each([[210, 297], [297, 210], [60, 40]])("produces %dx%dmm page", async (w, h) => {
    const buf = await renderPdf(mkReport(w, h), { params: {} });
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();      // pt
    expect(width / 72 * 25.4).toBeCloseTo(w, 0);
    expect(height / 72 * 25.4).toBeCloseTo(h, 0);
    // 폰트 서빙이 깨지면 시스템 폰트로 대체돼 픽셀 비교로는 못 잡으므로, 임베드된 서브셋 폰트 이름으로 확인한다
    expect(buf.includes("Pretendard")).toBe(true);
  }, 30_000);

  it("PDF raster matches HTML screenshot within tolerance", async () => {
    expect(await rasterDiff(mkReport(100, 60), { params: {} })).toBeLessThan(0.01);   // 1% 미만 차이
  }, 30_000);

  it("PDF raster of the quality certificate golden fixture matches its HTML screenshot", async () => {
    // 완료 기준 3은 합성 레포트가 아니라 실제 양식으로 확인한다 (asset:// 도장은 두 출력 모두 비어 같다)
    const report = parseReport(qualityCert);
    expect(await rasterDiff(report, await resolveData(report, { lotNo: "L2609-0142" }))).toBeLessThan(0.01);
  }, 30_000);
});
