import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, ExpressionError, type Report, type DataContext } from "@daport/core";
import { LayoutLimitError } from "@daport/renderer";
import { renderPdf } from "@daport/pdf";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";

export const maxDuration = 60;

const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** RFC 6266/5987: filename에는 ASCII 대체 이름, 한글 이름은 filename*에 UTF-8 퍼센트 인코딩으로 넣는다 */
function contentDisposition(report: Report): string {
  const ascii = `${report.id.replace(/[^\w.-]/g, "_")}.pdf`;
  const utf8 = encodeURIComponent(`${report.name || report.id}.pdf`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  // 스펙 10장: 모델 검증·파라미터·표현식·데이터셋·페이지 상한 오류는 요청 문제(400), 렌더 실패(Chromium 크래시 1회 재시도 후)는 500
  let report: Report | null;
  try {
    await ready();
    report = body.report ? parseReport(body.report) : await getStore().get(id);
  } catch (e) {
    return fail(e, e instanceof ZodError ? 400 : 500);
  }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

  let data: DataContext;
  try {
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    data = context;
  } catch (e) {
    return fail(e, 400);   // 필수 파라미터 누락
  }

  try {
    const origin = new URL(req.url).origin;
    const pdf = await renderPdf(resolveAssetUrls(report, origin), data);
    return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": contentDisposition(report) } });
  } catch (e) {
    if (e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, e instanceof ExpressionError ? 400 : 500);
  }
}
