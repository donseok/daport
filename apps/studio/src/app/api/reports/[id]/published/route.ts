import { NextResponse } from "next/server";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

/** 배포 포인터 이동 (4단계 스펙 4.2). 새 버전을 만들지 않고 draft도 건드리지 않는다. studio 내부용(무인증) */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const version = parsed.body.version;
  if (!Number.isInteger(version)) return NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 });
  try {
    await ready();
    await getStore().setPublished(id, version as number);
    return NextResponse.json({ publishedVersion: version });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFoundError ? 404 : 500 });
  }
}
