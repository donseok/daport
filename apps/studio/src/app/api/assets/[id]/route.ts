import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

// 캔버스·미리보기·PDF가 이미지마다 이 라우트를 부르므로, 저장소가 없거나 실패해도 스택 트레이스 500 대신 JSON으로 답한다
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "asset storage not configured" }, { status: 503 });
  const { id } = await params;
  let url: string | undefined;
  try {
    url = (await list({ prefix: `assets/${id}-` })).blobs[0]?.url;
  } catch (e) {
    return NextResponse.json({ error: `asset storage error: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  if (!url) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
