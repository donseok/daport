import { NextResponse } from "next/server";
import type { ReportInput } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

export async function GET() { await ready(); return NextResponse.json(await getStore().list()); }

export async function POST(req: Request) {
  // 2단계에서 sample.data가 레포트 안으로 들어와 본문이 가장 커질 수 있는 라우트다 (Finding 4)
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    await ready();
    // getStore().create는 실제로 parseReport(unknown)에 넘길 뿐이라, 검증 전 본문은 형태를 확정할 수 없다
    const r = await getStore().create(parsed.body as ReportInput);
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
