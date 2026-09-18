import { NextResponse } from "next/server";
import type { Report } from "@daport/core";
import { getStore } from "@/lib/report-store";

/** 배포 버전(또는 지정 버전)을 골라 온다. draft는 절대 읽지 않는다 (4단계 스펙 5.2). null이면 호출자가 404를 낸다 */
export async function pickVersion(id: string, version: number | undefined): Promise<{ version: number; report: Report } | { error: NextResponse }> {
  const store = getStore();
  if (version !== undefined) {
    const report = await store.getVersion(id, version);
    return report ? { version, report } : { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  const published = await store.getPublished(id);
  if (published) return published;
  // 존재하지만 미배포인지, 아예 없는지 구분한다 (listVersions는 draft를 렌더에 쓰지 않는다)
  const exists = (await store.listVersions(id)) !== null;
  return { error: NextResponse.json(exists ? { error: "배포된 버전이 없습니다", code: "NOT_PUBLISHED" } : { error: "not found" }, { status: 404 }) };
}
