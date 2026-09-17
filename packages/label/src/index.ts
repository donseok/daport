import type { Report, DataContext } from "@daport/renderer";
import { rasterizePages, type RenderOptions } from "./raster";
import { encodeZpl, encodeTspl } from "./encode";
export * from "./bitmap";
export * from "./encode";
export * from "./raster";
export { closePool } from "@daport/browser";

export type LabelResult = { language: "zpl" | "tspl"; dpi: number; pages: number; data: Buffer; mime: "text/plain" | "application/octet-stream"; filename: string };

/** 라벨 레포트 → 프린터 명령 (스펙 6.3). output.kind가 label이 아니면 던진다 */
export async function renderLabel(report: Report, data: DataContext, opts: RenderOptions = {}): Promise<LabelResult> {
  if (report.output.kind !== "label") throw new Error("report output is not label");
  const { language, dpi, threshold, darkness, speed, copies } = report.output.label;
  const bitmaps = await rasterizePages(report, data, dpi, threshold, opts);
  const encodeOpts = { widthMm: report.page.width, heightMm: report.page.height, dpi, copies, darkness, speed };
  return language === "zpl"
    ? { language, dpi, pages: bitmaps.length, data: Buffer.from(encodeZpl(bitmaps, encodeOpts), "latin1"), mime: "text/plain", filename: `${report.id}.zpl` }
    : { language, dpi, pages: bitmaps.length, data: encodeTspl(bitmaps, encodeOpts), mime: "application/octet-stream", filename: `${report.id}.prn` };
}
