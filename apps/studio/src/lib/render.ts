import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExpressionError, type Report, type DataContext } from "@daport/core";
import { renderToHtml, LayoutLimitError, BarcodeError } from "@daport/renderer";
import { renderPdf } from "@daport/pdf";
import { renderLabel, rasterizePages, bitmapToPng, LabelTooLargeError } from "@daport/label";
import { resolveAssetUrls } from "./assets";
import { runDatasets } from "./datasets";

export const RENDER_FORMATS = ["html", "pdf", "zpl", "tspl", "png"] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];
export const isRenderFormat = (v: unknown): v is RenderFormat => typeof v === "string" && (RENDER_FORMATS as readonly string[]).includes(v);

/** 요청 쪽 잘못 → 400. details는 응답 본문에 그대로 펼친다(datasetErrors 등) */
export class RenderRequestError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = "RenderRequestError"; }
}
/** 클라이언트가 요청을 취소했다 → 499 (표준은 아니지만 "클라이언트가 요청을 닫음"의 관례) */
export class RenderAbortedError extends Error { constructor() { super("request aborted"); this.name = "RenderAbortedError"; } }

export type RenderInput = { format: RenderFormat; params?: Record<string, unknown>; data?: Record<string, unknown>; props?: Record<string, unknown>; origin: string; signal?: AbortSignal };
export type RenderOutput = { body: Buffer | string; mime: string; filename: string; pages?: number };

/** 쉼표 목록 환경변수 → 호스트 배열 (공백·빈 항목 제거) */
export function parseHostList(env: string | undefined): string[] {
  return (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
/** 렌더 중 Chromium이 요청할 수 있는 호스트: 자기 origin(에셋·폰트) + DAPORT_RENDER_ALLOW (4단계 스펙 5.6). 목록이 비면 외부는 전부 차단 */
export function renderAllowHosts(origin: string): string[] {
  return [new URL(origin).host, ...parseHostList(process.env.DAPORT_RENDER_ALLOW)];
}

/** RFC 6266/5987: filename에는 ASCII 대체 이름, 한글 이름은 filename*에 UTF-8 퍼센트 인코딩으로 넣는다 */
export function contentDisposition(report: Report, ext: string): string {
  const ascii = `${report.id.replace(/[^\w.-]/g, "_")}.${ext}`;
  const utf8 = encodeURIComponent(`${report.name || report.id}.${ext}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const LABEL_FORMATS: ReadonlySet<RenderFormat> = new Set(["zpl", "tspl", "png"]);

/**
 * 모델 → 데이터셋 실행 → props → asset:// 변환 → 포맷별 출력 (4단계 스펙 5.1).
 * studio 내부 라우트(pdf·label·preview)와 MES용 render가 같은 경로를 쓴다
 */
export async function renderReport(report: Report, input: RenderInput): Promise<RenderOutput> {
  if (LABEL_FORMATS.has(input.format) && report.output.kind !== "label") throw new RenderRequestError("FORMAT_MISMATCH", "레포트의 출력 종류가 라벨이 아닙니다");
  let context: DataContext;
  try {
    const run = await runDatasets(report, { params: input.params, data: input.data });
    if (run.errors.length) throw new RenderRequestError("DATASET_FAILED", "데이터셋 실행 실패", { datasetErrors: run.errors });
    context = run.context;
  } catch (e) {
    if (e instanceof RenderRequestError) throw e;
    throw new RenderRequestError("BAD_REQUEST", e instanceof Error ? e.message : String(e));   // 필수 파라미터 누락 등
  }
  const data: DataContext = input.props ? { ...context, props: input.props } : context;
  const resolved = resolveAssetUrls(report, input.origin);
  const allowHosts = renderAllowHosts(input.origin);
  switch (input.format) {
    case "html":
      return { body: renderToHtml(resolved, data, { fontBaseUrl: `${input.origin}/fonts` }), mime: "text/html; charset=utf-8", filename: `${report.id}.html` };
    case "pdf":
      return { body: await renderPdf(resolved, data, { allowHosts }), mime: "application/pdf", filename: `${report.id}.pdf` };
    case "png": {
      if (report.output.kind !== "label") throw new RenderRequestError("FORMAT_MISMATCH", "레포트의 출력 종류가 라벨이 아닙니다");   // 타입 좁히기용, 위에서 이미 걸렀다
      if (input.signal?.aborted) throw new RenderAbortedError();   // 브라우저를 띄우기 전에 취소를 본다
      const [first] = await rasterizePages(resolved, data, report.output.label.dpi, report.output.label.threshold, { allowHosts });
      if (!first) throw new RenderRequestError("NO_PAGES", "라벨 페이지가 없습니다");
      if (input.signal?.aborted) throw new RenderAbortedError();   // 렌더 중 취소됐으면 인코딩은 건너뛴다
      return { body: bitmapToPng(first), mime: "image/png", filename: `${report.id}.png`, pages: 1 };
    }
    case "zpl":
    case "tspl": {
      if (report.output.kind !== "label") throw new RenderRequestError("FORMAT_MISMATCH", "레포트의 출력 종류가 라벨이 아닙니다");
      const withLanguage: Report = { ...resolved, output: { kind: "label", label: { ...report.output.label, language: input.format } } };
      const res = await renderLabel(withLanguage, data, { allowHosts });
      return { body: res.data, mime: res.mime, filename: res.filename, pages: res.pages };
    }
  }
}

/** 렌더 오류 → HTTP 응답. 스펙 8장: 요청 잘못 400(코드 유지), 취소 499, 그 밖은 500 */
export function renderErrorResponse(e: unknown): NextResponse {
  if (e instanceof RenderAbortedError) return new NextResponse(null, { status: 499 });
  if (e instanceof RenderRequestError) return NextResponse.json({ error: e.message, code: e.code, ...e.details }, { status: 400 });
  if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
  if (e instanceof ExpressionError || e instanceof BarcodeError || e instanceof ZodError) return NextResponse.json({ error: e.message }, { status: 400 });
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}
