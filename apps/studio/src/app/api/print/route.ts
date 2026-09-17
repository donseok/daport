import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { LayoutLimitError } from "@daport/renderer";
import { renderLabel, LabelTooLargeError } from "@daport/label";
import { getStore, ready } from "@/lib/report-store";
import { resolveAssetUrls } from "@/lib/assets";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets } from "@/lib/datasets";
import { parsePrinters, sendRaw } from "@/lib/printers";

export const maxDuration = 60;
const fail = (e: unknown, status: number) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

/** 라벨을 렌더해 허용 목록의 프린터로 raw TCP 전송 (스펙 7.3). 재시도 없음 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const printer = parsePrinters(process.env.DAPORT_PRINTERS).find((p) => p.name === body.printer);
  if (!printer) return NextResponse.json({ error: "허용 목록에 없는 프린터입니다" }, { status: 400 });
  let report: Report | null;
  try {
    await ready();
    report = body.report ? parseReport(body.report) : typeof body.reportId === "string" ? await getStore().get(body.reportId) : null;
  } catch (e) { return fail(e, e instanceof ZodError ? 400 : 500); }
  if (!report) return NextResponse.json({ error: "report 또는 reportId가 필요합니다" }, { status: 400 });
  if (report.output.kind !== "label") return NextResponse.json({ error: "레포트의 출력 종류가 라벨이 아닙니다" }, { status: 400 });
  try {
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params"), data: objectField(body, "data") });
    if (errors.length) return NextResponse.json({ error: "데이터셋 실행 실패", datasetErrors: errors }, { status: 400 });
    const props = propsField(body);
    const res = await renderLabel(resolveAssetUrls(report, new URL(req.url).origin), props ? { ...context, props } : context);
    try {
      const bytes = await sendRaw(printer, res.data);
      return NextResponse.json({ printer: printer.name, bytes, pages: res.pages });
    } catch (e) {
      // e.message는 printers.ts가 이미 프린터 이름만 담게 정제한다. 호스트·포트가 담긴 원본 오류는 cause로만 서버 로그에 남긴다
      console.error(`printer send failed: ${printer.name}`, e instanceof Error ? (e.cause ?? e) : e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), printer: printer.name }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof LabelTooLargeError || e instanceof LayoutLimitError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return fail(e, 500);
  }
}
