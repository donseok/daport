import { NextResponse } from "next/server";
import { getComponentStore } from "@/lib/component-store";

type Ctx = { params: Promise<{ id: string; v: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, v } = await params;
  // 버전은 1부터의 정수다. 그 밖의 표기(0, 음수, 소수, 앞자리 0)는 있을 수 없는 버전이라 404
  const found = /^[1-9][0-9]*$/.test(v) ? await getComponentStore().getVersion(id, Number(v)) : null;
  return found ? NextResponse.json(found) : NextResponse.json({ error: `component version not found: ${id}@${v}` }, { status: 404 });
}
