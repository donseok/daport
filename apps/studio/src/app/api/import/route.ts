import { NextResponse } from "next/server";
import { getStore, ready } from "@/lib/report-store";
import { MAX_BODY_BYTES } from "@/lib/body";
import { importBundle } from "@/lib/import-bundle";
import { BundleInvalidError } from "@/lib/bundle";
import { assetStorageEnabled, hasAsset, putAsset } from "@/lib/asset-io";

/** 번들 가져오기 (4단계 스펙 6.3). multipart: file(zip), connectionMap(JSON, 선택) */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: `요청 본문이 ${MAX_BODY_BYTES} 바이트를 넘습니다` }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "multipart 본문이 아닙니다" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file이 필요합니다" }, { status: 400 });
  if (file.size > MAX_BODY_BYTES) return NextResponse.json({ error: "파일이 너무 큽니다" }, { status: 413 });
  let connectionMap: Record<string, string> | undefined;
  const rawMap = form.get("connectionMap");
  if (typeof rawMap === "string" && rawMap.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawMap);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((v) => typeof v !== "string")) throw new Error();
      connectionMap = parsed as Record<string, string>;
    } catch { return NextResponse.json({ error: "connectionMap은 문자열 값의 JSON 객체여야 합니다" }, { status: 400 }); }
  }
  try {
    await ready();
    const assets = assetStorageEnabled() ? { has: hasAsset, put: putAsset } : null;
    const result = await importBundle(new Uint8Array(await file.arrayBuffer()), { filename: file.name, connectionMap }, { store: getStore(), assets });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof BundleInvalidError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
