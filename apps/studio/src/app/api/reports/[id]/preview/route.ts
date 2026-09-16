import { NextResponse } from "next/server";
import { resolveData, parseReport } from "@daport/core";
import { renderToHtml } from "@daport/renderer";
import { getStore } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const report = body.report ? parseReport(body.report) : await getStore().get(id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    const origin = new URL(req.url).origin;
    const data = await resolveData(report, body.params ?? {});
    const html = renderToHtml(resolveAssetUrls(report, origin), data, { fontBaseUrl: `${origin}/fonts` });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
