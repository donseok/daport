import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import { IMAGE_TYPES, MAX_ASSET_BYTES } from "@/lib/asset-io";

const notConfigured = () => NextResponse.json({ error: "asset storage not configured" }, { status: 503 });

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return notConfigured();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_ASSET_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
  if (!IMAGE_TYPES.has(file.type)) return NextResponse.json({ error: "unsupported file type" }, { status: 415 });
  const id = crypto.randomUUID();
  const blob = await put(`assets/${id}-${file.name}`, file, { access: "public", addRandomSuffix: false, contentType: file.type });
  return NextResponse.json({ id, url: blob.url, name: file.name }, { status: 201 });
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return notConfigured();
  const { blobs } = await list({ prefix: "assets/" });
  return NextResponse.json(blobs.map((b) => ({ url: b.url, name: b.pathname.replace(/^assets\//, "") })));
}
