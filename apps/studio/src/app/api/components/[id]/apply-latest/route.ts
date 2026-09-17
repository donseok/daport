import { NextResponse } from "next/server";
import { applyLatestToReports } from "@/lib/component-usage";
import { NotFoundError } from "@/lib/report-store";

type Ctx = { params: Promise<{ id: string }> };

// 요청 본문을 쓰지 않으므로 readJsonBody로 읽지 않는다(본문이 있어도 무시)
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    return NextResponse.json(await applyLatestToReports(id));
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: `component not found: ${id}` }, { status: 404 });
    throw e;
  }
}
