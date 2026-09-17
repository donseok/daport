import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, ExpressionError, type Report, type DataContext } from "@daport/core";
import { LayoutLimitError, BarcodeError } from "@daport/renderer";
import { renderLabel, rasterizePages, bitmapToPng, LabelTooLargeError } from "@daport/label";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
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
    data = context;
  } catch (e) { return fail(e, 400); }

  try {
    const origin = new URL(req.url).origin;
    const resolved = resolveAssetUrls(report, origin);
    if (new URL(req.url).searchParams.get("preview") === "png") {
      const [first] = await rasterizePages(resolved, data, report.output.label.dpi, report.output.label.threshold);
      return new NextResponse(new Uint8Array(bitmapToPng(first)), { headers: { "content-type": "image/png" } });
    }
    const res = await renderLabel(resolved, data);
    return new NextResponse(new Uint8Array(res.data), { headers: { "content-type": res.mime, "content-disposition": `attachment; filename="${res.filename}"`, "x-daport-pages": String(res.pages) } });
  } catch (e) {
    if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, e instanceof ExpressionError || e instanceof BarcodeError ? 400 : 500);
  }
}
