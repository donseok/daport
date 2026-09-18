import { NextResponse } from "next/server";
import { envSecrets } from "@daport/datasource";
import { getConnectionStore } from "@/lib/connection-store";
import { findAllConnectionUsage } from "@/lib/connection-usage";

/** 연결 목록 (4b 스펙 7.1). 비밀값은 설정 여부만. usedBy는 레포트 전체를 한 번만 훑어 모든 연결을 한꺼번에 계산한다 */
export async function GET() {
  const secrets = envSecrets();
  const [list, usage] = await Promise.all([getConnectionStore().list(), findAllConnectionUsage()]);
  return NextResponse.json(list.map((c) => ({ ...c, secretConfigured: !!secrets(c.secretRef), usedBy: usage[c.name] ?? [] })));
}
