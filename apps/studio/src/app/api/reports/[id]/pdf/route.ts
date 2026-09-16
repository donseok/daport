import { NextResponse } from "next/server";
import { resolveData, parseReport } from "@daport/core";
import { renderPdf } from "@daport/pdf";
import { getStore } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const report = body.report ? parseReport(body.report) : await getStore().get(id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    const origin = new URL(req.url).origin;
    const data = await resolveData(report, body.params ?? {});
    const pdf = await renderPdf(resolveAssetUrls(report, origin), data);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${encodeURIComponent(report.name || report.id)}.pdf"`,
    } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
