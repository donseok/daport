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

/** PDF 첫 페이지(96dpi 래스터)와 HTML 스크린샷 */
async function rasters(report: Report, data: DataContext): Promise<{ pdf: PNG; html: PNG }> {
  const buf = await renderPdf(report, data);
  const doc = await pdfToImg(buf, { scale: 96 / 72 });   // 96dpi
  return { pdf: PNG.sync.read(Buffer.from((await doc.getPage(1)))), html: PNG.sync.read(await renderHtmlScreenshot(report, data)) };
}

/** PDF 첫 페이지(96dpi 래스터)와 HTML 스크린샷의 다른 픽셀 비율 */
async function rasterDiff(report: Report, data: DataContext): Promise<number> {
  const { pdf: pdfPng, html: htmlPng } = await rasters(report, data);
  expect(Math.abs(htmlPng.width - pdfPng.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(htmlPng.height - pdfPng.height)).toBeLessThanOrEqual(1);
  const w = Math.min(htmlPng.width, pdfPng.width), h = Math.min(htmlPng.height, pdfPng.height);
  const diff = pixelmatch(crop(htmlPng, w, h), crop(pdfPng, w, h), undefined, w, h, { threshold: 0.2 });
  return diff / (w * h);
}

const px = (mm: number) => Math.round(mm / 25.4 * 96);
const luma = (png: PNG, x: number, y: number) => { const i = (y * png.width + x) * 4; return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; };
/** (x, y0..y1) mm 세로 구간에서 어두운(휘도 < 128) 픽셀 수. 가로선이 지나가면 선 두께만큼 나온다 */
const darkInColumn = (png: PNG, xMm: number, y0Mm: number, y1Mm: number) => {
  let n = 0; for (let y = px(y0Mm); y <= px(y1Mm); y++) if (luma(png, px(xMm), y) < 128) n++; return n;
};
const darkInRow = (png: PNG, yMm: number, x0Mm: number, x1Mm: number) => {
  let n = 0; for (let x = px(x0Mm); x <= px(x1Mm); x++) if (luma(png, x, px(yMm)) < 128) n++; return n;
};

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

  it("draws horizontal and vertical lines with a stroke width in mm in both PDF and HTML", async () => {
    // 높이 0인 가로선·폭 0인 세로선은 SVG 상자가 얇아 둘 다 그려지지 않아도 픽셀 비교로는 못 잡는다
    const report = parseReport({ id: "lines", version: 1, page: { width: 100, height: 60 }, elements: [
      { id: "h", type: "line", x: 10, y: 20, w: 80, h: 0, x2: 90, y2: 20, style: { stroke: "#000", strokeWidth: 2 } },
      { id: "thin", type: "line", x: 10, y: 45, w: 30, h: 0, x2: 40, y2: 45, style: { stroke: "#000", strokeWidth: 0.5 } },
      { id: "v", type: "line", x: 70, y: 30, w: 0, h: 25, x2: 70, y2: 55, style: { stroke: "#000", strokeWidth: 0.5 } },
    ]});
    const { pdf, html } = await rasters(report, { params: {} });
    for (const png of [pdf, html]) {
      const thick = darkInColumn(png, 50, 15, 25);          // 2mm ≈ 7.6px
      expect(thick).toBeGreaterThanOrEqual(6);
      expect(thick).toBeLessThanOrEqual(9);
      expect(darkInColumn(png, 25, 42, 48)).toBeGreaterThanOrEqual(1);   // 0.5mm ≈ 1.9px
      expect(darkInColumn(png, 25, 42, 48)).toBeLessThanOrEqual(3);
      expect(darkInRow(png, 42, 65, 75)).toBeGreaterThanOrEqual(1);
      expect(darkInRow(png, 42, 65, 75)).toBeLessThanOrEqual(3);
    }
  }, 30_000);

  it("PDF raster of the quality certificate golden fixture matches its HTML screenshot", async () => {
    // 완료 기준 3은 합성 레포트가 아니라 실제 양식으로 확인한다 (asset:// 도장은 두 출력 모두 비어 같다)
    const report = parseReport(qualityCert);
    expect(await rasterDiff(report, await resolveData(report, { lotNo: "L2609-0142" }))).toBeLessThan(0.01);
  }, 30_000);

  it("draws the quality certificate divider line (hr, y=44mm) in both PDF and HTML", async () => {
    const report = parseReport(qualityCert);
    const { pdf, html } = await rasters(report, await resolveData(report, { lotNo: "L2609-0142" }));
    for (const png of [pdf, html]) for (const x of [20, 100, 190]) expect(darkInColumn(png, x, 40, 48)).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
