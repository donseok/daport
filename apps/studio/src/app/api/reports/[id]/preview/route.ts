import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { renderToHtml, LayoutLimitError } from "@daport/renderer";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  try {
    await ready();
    const report = body.report ? parseReport(body.report) : await getStore().get(id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    const origin = new URL(req.url).origin;
    // 요청 data가 있으면 그 데이터셋은 실행하지 않는다 (편집 중 미리보기는 sample.data를 보낸다)
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    const props = propsField(body);
    const html = renderToHtml(resolveAssetUrls(report, origin), props ? { ...context, props } : context, { fontBaseUrl: `${origin}/fonts` });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    if (e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
