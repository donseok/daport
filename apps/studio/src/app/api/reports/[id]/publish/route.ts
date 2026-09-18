import { NextResponse } from "next/server";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { checkReportComponents, WARNINGS_HEADER } from "@/lib/report-guard";

/** draft를 불변 버전으로 저장하고 배포 포인터를 옮긴다 (4단계 스펙 4.2, 5.4). 저장과 같은 컴포넌트 검사·정리를 거친다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const note = typeof parsed.body.note === "string" && parsed.body.note.trim() ? parsed.body.note.trim().slice(0, 500) : undefined;
  try {
    await ready();
    const draft = await getStore().get(id);
    if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
    const guard = await checkReportComponents(draft);
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    const res = NextResponse.json(await getStore().publish(id, guard.report, note), { status: 201 });
    if (guard.warnings.length) res.headers.set(WARNINGS_HEADER, JSON.stringify(guard.warnings));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFoundError ? 404 : 500 });
  }
}
