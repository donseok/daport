import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse, contentDisposition } from "@/lib/render";

export const maxDuration = 60;
const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** PDF 다운로드. 모델·데이터·오류 규칙은 lib/render.ts 한 곳에 있다 (스펙 10장, 4단계 스펙 5.1) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  let report: Report | null;
  try { await ready(); report = body.report ? parseReport(body.report) : await getStore().get(id); }
  catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const out = await renderReport(report, { format: "pdf", params: objectField(body, "params"), data: objectField(body, "data"), props: propsField(body), origin: new URL(req.url).origin });
    return new NextResponse(new Uint8Array(out.body as Buffer), { headers: { "content-type": out.mime, "content-disposition": contentDisposition(report, "pdf") } });
  } catch (e) {
    return renderErrorResponse(e);
  }
}
