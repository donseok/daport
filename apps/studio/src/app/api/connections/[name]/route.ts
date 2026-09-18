import { NextResponse } from "next/server";
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
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
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
