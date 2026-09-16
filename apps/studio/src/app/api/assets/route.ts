import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  const id = crypto.randomUUID();
  const blob = await put(`assets/${id}-${file.name}`, file, { access: "public", addRandomSuffix: false });
  return NextResponse.json({ id, url: blob.url, name: file.name }, { status: 201 });
}

export async function GET() {
  const { blobs } = await list({ prefix: "assets/" });
  return NextResponse.json(blobs.map((b) => ({ url: b.url, name: b.pathname.replace(/^assets\//, "") })));
}
