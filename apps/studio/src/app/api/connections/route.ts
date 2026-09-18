import { NextResponse } from "next/server";
import { envSecrets } from "@daport/datasource";
import { getConnectionStore } from "@/lib/connection-store";
import { findConnectionUsage } from "@/lib/connection-usage";

/** 연결 목록 (4b 스펙 7.1). 비밀값은 설정 여부만 */
export async function GET() {
  const secrets = envSecrets();
  const list = await getConnectionStore().list();
  return NextResponse.json(await Promise.all(list.map(async (c) => ({ ...c, secretConfigured: !!secrets(c.secretRef), usedBy: await findConnectionUsage(c.name) }))));
}
