import { NextResponse } from "next/server";
import { getStore, ready } from "@/lib/report-store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ready();
  const list = await getStore().listVersions((await params).id);
  return list ? NextResponse.json(list) : NextResponse.json({ error: "not found" }, { status: 404 });
}
