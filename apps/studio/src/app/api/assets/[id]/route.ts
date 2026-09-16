import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { blobs } = await list({ prefix: `assets/${id}-` });
  if (!blobs[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(blobs[0].url, 302);
}
