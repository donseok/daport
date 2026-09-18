import { NextResponse } from "next/server";
import { getStore, ready, NotFoundError } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { authorize } from "@/lib/auth";
import { resolveAssetUrls } from "@/lib/assets";
import { withCors, preflight } from "@/lib/cors";
import { pickVersion } from "@/lib/pick-version";

export async function OPTIONS(req: Request) { return preflight(req); }

/** 임베드용 모델 조회 (4단계 스펙 5.3). API 키 필수. asset://는 studio 절대 URL로 바꾼다 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(req, id);
  if (!auth.ok) return withCors(req, auth.response);
  const url = new URL(req.url);
  const raw = url.searchParams.get("version");
  // 빈 문자열(?version=)은 "버전 미지정"으로 본다. Number("")는 0이라, 그대로 두면 없는 버전 0을 찾아 404가 난다
  const version = raw === null || raw.trim() === "" ? undefined : Number(raw);
  if (version !== undefined && !Number.isInteger(version)) return withCors(req, NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 }));
  try {
    await ready();
    const picked = await pickVersion(id, version);
    if ("error" in picked) return withCors(req, picked.error);
    return withCors(req, NextResponse.json(resolveAssetUrls(picked.report, url.origin), { headers: { "x-daport-version": String(picked.version), "cache-control": "no-store" } }));
  } catch (e) {
    // 저장소가 던지면 withCors 없이 Next 기본 500이 나가, MES 프론트는 원인 대신 CORS 오류를 본다. 여기서 감싸 막는다
    console.error("[published]", e);
    return withCors(req, NextResponse.json({ error: "조회에 실패했습니다" }, { status: 500 }));
  }
}

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
