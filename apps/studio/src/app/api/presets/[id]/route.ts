import { NextResponse } from "next/server";
import { getPresetStore, ForbiddenError } from "@/lib/preset-store";
import { NotFoundError } from "@/lib/report-store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getPresetStore().delete((await params).id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const status = e instanceof ForbiddenError ? 403 : e instanceof NotFoundError ? 404 : 400;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
