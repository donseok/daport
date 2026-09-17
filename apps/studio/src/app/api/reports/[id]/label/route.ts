import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, ExpressionError, type Report, type DataContext } from "@daport/core";
import { LayoutLimitError, BarcodeError } from "@daport/renderer";
import { renderLabel, rasterizePages, bitmapToPng, LabelTooLargeError } from "@daport/label";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";

export const maxDuration = 60;
const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** 라벨 명령 다운로드 또는 ?preview=png 첫 라벨 비트맵. 본문·데이터·오류 규칙은 pdf 라우트와 같다 (스펙 7.3, 8) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  let report: Report | null;
  try { await ready(); report = body.report ? parseReport(body.report) : await getStore().get(id); }
  catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (report.output.kind !== "label") return NextResponse.json({ error: "레포트의 출력 종류가 라벨이 아닙니다" }, { status: 400 });

  let data: DataContext;
  try {
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    const props = propsField(body);
    data = props ? { ...context, props } : context;
  } catch (e) { return fail(e, 400); }

  try {
    const origin = new URL(req.url).origin;
    const resolved = resolveAssetUrls(report, origin);
    if (new URL(req.url).searchParams.get("preview") === "png") {
      // 클라이언트는 디바운스 편집 중 이전 미리보기 요청을 AbortController로 취소한다.
      // 취소된 요청이면 브라우저를 띄우는 무거운 rasterizePages를 아예 시작하지 않는다.
      // (499는 표준 상태 코드는 아니지만 nginx 등에서 "클라이언트가 요청을 닫음"을 뜻하는 관례로 쓴다)
      if (req.signal.aborted) return new Response(null, { status: 499 });
      const pages = await rasterizePages(resolved, data, report.output.label.dpi, report.output.label.threshold);
      const [first] = pages;
      if (!first) return NextResponse.json({ error: "라벨 페이지가 없습니다" }, { status: 400 });
      // 렌더링 도중 취소됐다면 이미 끝난 rasterizePages 결과라도 PNG 인코딩은 건너뛴다
      if (req.signal.aborted) return new Response(null, { status: 499 });
      return new NextResponse(new Uint8Array(bitmapToPng(first)), { headers: { "content-type": "image/png" } });
    }
    const res = await renderLabel(resolved, data);
    return new NextResponse(new Uint8Array(res.data), { headers: { "content-type": res.mime, "content-disposition": `attachment; filename="${res.filename}"`, "x-daport-pages": String(res.pages) } });
  } catch (e) {
    if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, e instanceof ExpressionError || e instanceof BarcodeError ? 400 : 500);
  }
}
