import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { renderReport, renderErrorResponse } from "@/lib/render";

const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** HTML 미리보기. body.version이 있으면 그 배포 버전을, 없으면 body.report 또는 draft를 그린다 (4단계 스펙 5.4) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  let report: Report | null;
  try {
    await ready();
    if (body.version !== undefined) {
      if (!Number.isInteger(body.version)) return NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 });
      report = await getStore().getVersion(id, body.version as number);
    } else {
      report = body.report ? parseReport(body.report) : await getStore().get(id);
    }
  } catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    // 요청 data가 있으면 그 데이터셋은 실행하지 않는다 (편집 중 미리보기는 sample.data를 보낸다)
    const out = await renderReport(report, { format: "html", params: objectField(body, "params"), data: objectField(body, "data"), props: propsField(body), origin: new URL(req.url).origin });
    return new NextResponse(out.body as string, { headers: { "content-type": out.mime } });
  } catch (e) {
    return renderErrorResponse(e);
  }
}
