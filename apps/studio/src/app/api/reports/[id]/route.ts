import { NextResponse } from "next/server";
import { getStore, NotFoundError } from "@/lib/report-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const r = await getStore().get((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    return NextResponse.json(await getStore().update((await params).id, await req.json()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: e instanceof NotFoundError ? 404 : 400 });
  }
}
