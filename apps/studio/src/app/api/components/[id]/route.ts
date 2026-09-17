import { NextResponse } from "next/server";
import type { ComponentBody } from "@daport/core";
import { getComponentStore } from "@/lib/component-store";
import { findUsage } from "@/lib/component-usage";
import { ConflictError } from "@/lib/preset-store";
import { NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

type Ctx = { params: Promise<{ id: string }> };
const notFound = (id: string) => NextResponse.json({ error: `component not found: ${id}` }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const detail = await getComponentStore().get(id);
  return detail ? NextResponse.json(detail) : notFound(id);
}

export async function PUT(req: Request, { params }: Ctx) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { id } = await params;
  try {
    return NextResponse.json(await getComponentStore().save(id, parsed.body.body as ComponentBody));
  } catch (e) {
    if (e instanceof NotFoundError) return notFound(id);
    if (e instanceof ConflictError) return NextResponse.json({ error: `component ${id} was saved concurrently; reload and retry` }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const store = getComponentStore();
  if (!(await store.get(id))) return notFound(id);
  const usage = await findUsage(id);
  if (usage.length > 0) {
    return NextResponse.json({ error: `component ${id} is used by reports`, reports: usage.map((u) => u.reportId) }, { status: 409 });
  }
  try {
    await store.delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof NotFoundError) return notFound(id);   // 확인과 삭제 사이에 다른 요청이 지운 경우
    throw e;
  }
}
