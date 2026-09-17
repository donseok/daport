import { NextResponse } from "next/server";
import type { ReportInput } from "@daport/core";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

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
    // getStore().update도 실제로 parseReport(unknown)에 넘길 뿐이라, 검증 전 본문은 형태를 확정할 수 없다
    return NextResponse.json(await getStore().update((await params).id, parsed.body as ReportInput));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
