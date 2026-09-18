import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseReport, type Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, propsField, MAX_BODY_BYTES } from "@/lib/body";
import { parsePrinters, sendRaw } from "@/lib/printers";
import { renderReport, renderErrorResponse } from "@/lib/render";

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
    // renderReport를 거쳐야 studio의 Chromium 외부 요청 허용 목록(allowHosts, 스펙 5.6)이 다른 렌더 경로와 똑같이 적용된다
    const out = await renderReport(report, {
      format: report.output.label.language,
      params: objectField(body, "params"),
      data: objectField(body, "data"),
      props: propsField(body),
      origin: new URL(req.url).origin,
    });
    try {
      const bytes = await sendRaw(printer, out.body as Buffer);
      return NextResponse.json({ printer: printer.name, bytes, pages: out.pages });
    } catch (e) {
      // e.message는 printers.ts가 이미 프린터 이름만 담게 정제한다. 호스트·포트가 담긴 원본 오류는 cause로만 서버 로그에 남긴다
      console.error(`printer send failed: ${printer.name}`, e instanceof Error ? (e.cause ?? e) : e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e), printer: printer.name }, { status: 502 });
    }
  } catch (e) {
    return renderErrorResponse(e);
  }
}
