import { NextResponse } from "next/server";
import { parseReport, type ReportInput } from "@daport/core";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { checkReportComponents, WARNINGS_HEADER } from "@/lib/report-guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  await ready();
  const r = await getStore().get((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx) {
  // 2단계에서 sample.data가 레포트 안으로 들어와 본문이 가장 커질 수 있는 라우트다 (Finding 4)
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    await ready();
    const id = (await params).id;
    // URL id가 본문 id보다 우선한다(저장소 update와 같은 규칙). 스키마 오류는 던져 400, 검사는 검증된 모델에만 한다 (스펙 6.3)
    const guard = await checkReportComponents(parseReport({ ...parsed.body, id }));
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    const res = NextResponse.json(await getStore().update(id, guard.report as ReportInput));
    if (guard.warnings.length) res.headers.set(WARNINGS_HEADER, JSON.stringify(guard.warnings));
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
