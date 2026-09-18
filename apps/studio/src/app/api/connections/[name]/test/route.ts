import { NextResponse } from "next/server";
import { envSecrets, DatasetFailure } from "@daport/datasource";
import { connectorFor } from "@daport/oracle";
import { getConnectionStore } from "@/lib/connection-store";

/** 연결 테스트: ping (4b 스펙 7.1). 비밀값·호스트 문자열은 응답에 넣지 않는다(ping 오류 메시지는 커넥터가 이미 마스킹) */
export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const conn = await getConnectionStore().get(name);
  if (!conn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const secrets = envSecrets();
  if (!secrets(conn.secretRef)) return NextResponse.json({ error: `DAPORT_SECRET_${conn.secretRef} 환경변수가 없습니다`, code: "SECRET_MISSING" }, { status: 400 });
  const started = Date.now();
  try {
    await connectorFor(conn, secrets).ping();
    return NextResponse.json({ ok: true, elapsedMs: Date.now() - started });
  } catch (e) {
    const code = e instanceof DatasetFailure ? e.code : (e as { code?: string })?.code ?? "SQL_ERROR";
    return NextResponse.json({ ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } }, { status: 502 });
  }
}
