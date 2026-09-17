import { NextResponse } from "next/server";
import { parseReport, type ReportInput } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { checkReportComponents, WARNINGS_HEADER } from "@/lib/report-guard";

export async function GET() { await ready(); return NextResponse.json(await getStore().list()); }

export async function POST(req: Request) {
  // 2단계에서 sample.data가 레포트 안으로 들어와 본문이 가장 커질 수 있는 라우트다 (Finding 4)
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    await ready();
    // 스키마 오류(누락 참조·크기 불일치 포함)는 여기서 던져 400이 된다. 해시 검사는 검증된 모델에만 한다 (스펙 6.3)
    const guard = await checkReportComponents(parseReport(parsed.body));
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    // 저장소는 받은 값을 다시 parseReport한다. 검증된 모델이라 같은 결과가 나온다
    const r = await getStore().create(guard.report as ReportInput);
    const res = NextResponse.json(r, { status: 201 });
    if (guard.warnings.length) res.headers.set(WARNINGS_HEADER, JSON.stringify(guard.warnings));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
