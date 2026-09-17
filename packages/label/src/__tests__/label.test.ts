import { describe, it, expect, afterAll } from "vitest";
import { PNG } from "pngjs";
import { pdf as pdfToImg } from "pdf-to-img";
import { parseReport } from "@daport/core";
import { renderPdf } from "@daport/pdf";
import { fixtureContext } from "../../../renderer/src/__tests__/fixtures/context";
import coilTag from "../../../renderer/src/__tests__/fixtures/coil-tag.report.json";
import productLabel from "../../../renderer/src/__tests__/fixtures/product-label.report.json";
import { rasterizePages, renderLabel, closePool, LabelTooLargeError, rgbaToGray, packGray, bitmapToPng, pxOf, type Bitmap } from "../index";

afterAll(closePool);

const bit = (bm: Bitmap, x: number, y: number) => (bm.bits[y * Math.ceil(bm.width / 8) + (x >> 3)] >> (7 - (x & 7))) & 1;

/**
 * 두 비트맵의 다른 픽셀 비율. 상대 비트맵의 상하좌우 1px 안에 같은 값이 있으면 래스터 정렬 오차로 보고 세지 않는다
 * (2단계 PDF 비교와 같은 생각: 글리프·선의 서브픽셀 위치는 래스터라이저마다 1px 다르다)
 */
function tolerantDiff(a: Bitmap, b: Bitmap): number {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = bit(a, x, y);
    if (v === bit(b, x, y)) continue;
    const near = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < w && yy < h && bit(b, xx, yy) === v; });
    if (!near) n++;
  }
  return n / (w * h);
}

/** PDF를 라벨 DPI로 래스터해 같은 임계값으로 이진화한다 (HTML 경로와 PDF 경로가 같은 배치인지 본다) */
async function pdfBitmaps(report: ReturnType<typeof parseReport>, data: Record<string, unknown>, dpi: number, threshold: number): Promise<Bitmap[]> {
  const doc = await pdfToImg(await renderPdf(report, data), { scale: dpi / 72 });
  const out: Bitmap[] = [];
  for await (const page of doc) {
    const png = PNG.sync.read(Buffer.from(page));
    out.push(packGray(rgbaToGray(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height), png.width, png.height, threshold));
  }
  return out;
}

const MAX_DIFF = 0.02;   // 측정 후 보고서에 실제 값을 적는다. 이 값을 넘으면 원인을 조사하고 예산을 올리지 않는다

describe("rasterizePages", () => {
  it("produces one bitmap per label at round(mm × dpi / 25.4) pixels", async () => {
    const report = parseReport(coilTag);
    const bms = await rasterizePages(report, fixtureContext(report), 203, 128);
    expect(bms).toHaveLength(3);
    expect(bms.every((b) => b.width === pxOf(100, 203) && b.height === pxOf(150, 203))).toBe(true);
    expect(bms[0].bits.some((b) => b !== 0)).toBe(true);
  }, 60_000);
  it.each([["coil-tag", coilTag], ["product-label", productLabel]])("%s: label bitmap matches the PDF rasterized at the same dpi", async (_n, fixture) => {
    const report = parseReport(fixture);
    const data = fixtureContext(report);
    const label = await rasterizePages(report, data, 203, 128);
    const pdf = await pdfBitmaps(report, data, 203, 128);
    expect(pdf).toHaveLength(label.length);
    label.forEach((bm, i) => {
      expect(Math.abs(bm.width - pdf[i].width)).toBeLessThanOrEqual(1);
      expect(Math.abs(bm.height - pdf[i].height)).toBeLessThanOrEqual(1);
      expect(tolerantDiff(bm, pdf[i]), `${_n} label ${i}`).toBeLessThan(MAX_DIFF);
    });
  }, 120_000);
  it("rejects a label bigger than MAX_LABEL_PIXELS before touching the browser", async () => {
    const huge = parseReport({ ...coilTag, page: { width: 2000, height: 2000 }, output: { kind: "label", label: { language: "zpl", dpi: 300 } } });
    await expect(rasterizePages(huge, fixtureContext(huge), 300, 128)).rejects.toThrow(LabelTooLargeError);
  });
});

describe("renderLabel", () => {
  it("encodes ZPL with one block per label and a .zpl filename", async () => {
    const report = parseReport(coilTag);
    const res = await renderLabel(report, fixtureContext(report));
    expect(res).toMatchObject({ language: "zpl", dpi: 203, pages: 3, mime: "text/plain", filename: "coil-tag.zpl" });
    const text = res.data.toString("latin1");
    expect(text.match(/\^XA/g)).toHaveLength(3);
    expect(text).toContain(`^PW${pxOf(100, 203)}`);
    expect(text).toContain("^GFA,");
  }, 60_000);
  it("encodes TSPL as a binary .prn starting with SIZE", async () => {
    const report = parseReport({ ...productLabel, output: { kind: "label", label: { language: "tspl", dpi: 203, copies: 2 } } });
    const res = await renderLabel(report, fixtureContext(report));
    expect(res).toMatchObject({ language: "tspl", pages: 2, mime: "application/octet-stream", filename: "product-label.prn" });
    expect(res.data.subarray(0, 18).toString("latin1")).toBe("SIZE 60 mm,40 mm\r\n");
    expect(res.data.toString("latin1")).toContain("PRINT 1,2\r\n");
  }, 60_000);
  it("throws for a pdf report", async () => {
    const report = parseReport({ ...productLabel, output: { kind: "pdf" } });
    await expect(renderLabel(report, fixtureContext(report))).rejects.toThrow(/not label/);
  });
  it("bitmapToPng of a label is a valid PNG of the label size", async () => {
    const report = parseReport(productLabel);
    const [bm] = await rasterizePages(report, fixtureContext(report), 203, 128);
    const png = PNG.sync.read(bitmapToPng(bm));
    expect([png.width, png.height]).toEqual([pxOf(60, 203), pxOf(40, 203)]);
  }, 60_000);
});
