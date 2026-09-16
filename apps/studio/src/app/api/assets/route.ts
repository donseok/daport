import { NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

const notConfigured = () => NextResponse.json({ error: "asset storage not configured" }, { status: 503 });
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return notConfigured();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
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
