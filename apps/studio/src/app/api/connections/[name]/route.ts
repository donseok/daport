import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { closeConnector } from "@daport/oracle";
import { getConnectionStore } from "@/lib/connection-store";
import { findConnectionUsage } from "@/lib/connection-usage";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

type Ctx = { params: Promise<{ name: string }> };

/** URL의 name이 본문 name보다 우선한다 (저장소 update와 같은 규칙). direct 풀은 설정이 바뀌었을 수 있어 닫는다 */
export async function PUT(req: Request, { params }: Ctx) {
  const { name } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    const store = getConnectionStore();
    await store.upsert({ ...parsed.body, name } as never);
    await closeConnector(name);
    return NextResponse.json(await store.get(name));
  } catch (e) {
    // zod 검증 실패는 issues를 그대로 돌려줘 어느 필드가 문제인지 알 수 있게 한다. 그 밖의 오류(예: DB 드라이버
    // 실패)는 원문 메시지에 연결 정보가 섞여 나올 수 있어 서버 로그에만 남기고 응답은 일반 메시지로 고정한다
    if (e instanceof ZodError) return NextResponse.json({ error: "입력값이 올바르지 않습니다", issues: e.issues }, { status: 400 });
    console.error(`connection upsert failed: ${name}`, e);
    return NextResponse.json({ error: "연결을 저장하지 못했습니다" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { name } = await params;
  const reports = await findConnectionUsage(name);
  if (reports.length) return NextResponse.json({ error: `연결 "${name}"을(를) 쓰는 레포트가 있습니다`, code: "CONNECTION_IN_USE", reports }, { status: 409 });
  if (!(await getConnectionStore().delete(name))) return NextResponse.json({ error: "not found" }, { status: 404 });
  await closeConnector(name);
  return new NextResponse(null, { status: 204 });
}
