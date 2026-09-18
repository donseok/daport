import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse, contentDisposition } from "@/lib/render";

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
  if (report.output.kind !== "label") return NextResponse.json({ error: "레포트의 출력 종류가 라벨이 아닙니다", code: "FORMAT_MISMATCH" }, { status: 400 });
  const preview = new URL(req.url).searchParams.get("preview") === "png";
  try {
    const out = await renderReport(report, {
      format: preview ? "png" : report.output.label.language,
      params: objectField(body, "params"), data: objectField(body, "data"), props: propsField(body), origin: new URL(req.url).origin, signal: req.signal,
    });
    if (preview) return new NextResponse(new Uint8Array(out.body as Buffer), { headers: { "content-type": out.mime } });
    return new NextResponse(new Uint8Array(out.body as Buffer), { headers: { "content-type": out.mime, "content-disposition": contentDisposition(report, out.filename.split(".").pop()!), "x-daport-pages": String(out.pages ?? 0) } });
  } catch (e) {
    return renderErrorResponse(e);
  }
}
