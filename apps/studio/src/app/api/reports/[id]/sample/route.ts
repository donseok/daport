import { NextResponse } from "next/server";
import { parseReport, inferFields, type FieldNode } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, objectField, MAX_BODY_BYTES } from "@/lib/body";
import { runDatasets, SAMPLE_ROWS } from "@/lib/datasets";

// Next는 route.ts의 export를 HTTP 메서드·설정으로 제한하므로 상수는 lib/datasets.ts에 둔다

/** 샘플 가져오기 (스펙 7.5). 성공한 데이터셋만 data·fields에 담고, 실패는 errors로 돌려준다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  try {
    await ready();
    const report = body.report ? parseReport(body.report) : await getStore().get(id);
    if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { context, errors } = await runDatasets(report, { params: objectField(body, "params") });
    const data: Record<string, unknown[]> = {};
    const fields: Record<string, FieldNode[]> = {};
    for (const ds of report.datasets) {
      const rows = context[ds.name];
      if (!Array.isArray(rows)) continue;
      data[ds.name] = rows.slice(0, SAMPLE_ROWS);
      fields[ds.name] = inferFields(data[ds.name]);
    }
    return NextResponse.json({ data, fields, errors, capturedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
