import { NextResponse } from "next/server";
import type { ComponentBody } from "@daport/core";
import { getComponentStore } from "@/lib/component-store";
import { ConflictError } from "@/lib/preset-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

export async function GET() { return NextResponse.json(await getComponentStore().list()); }

export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const { id, body } = parsed.body;
  if (typeof id !== "string") return NextResponse.json({ error: "id는 문자열이어야 합니다" }, { status: 400 });
  try {
    // 저장소가 parseComponentBody로 검증하므로 검증 전 본문의 형태는 여기서 확정하지 않는다
    return NextResponse.json(await getComponentStore().create(id, body as ComponentBody), { status: 201 });
  } catch (e) {
    if (e instanceof ConflictError) return NextResponse.json({ error: `component exists: ${id}` }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
