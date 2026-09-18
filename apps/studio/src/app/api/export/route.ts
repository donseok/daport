import { NextResponse } from "next/server";
import type { Report } from "@daport/core";
import { getStore, ready } from "@/lib/report-store";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { buildBundle, collectAssetIds, type BundleAsset, type BundleSource } from "@/lib/bundle";
import { assetStorageEnabled, fetchAsset } from "@/lib/asset-io";

/** 번들 내보내기 (4단계 스펙 6.2). { reports: [{ id, version? }] } → zip. 없는 레포트·버전은 404로 전체 거부 */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const wanted = parsed.body.reports;
  if (!Array.isArray(wanted) || wanted.length === 0) return NextResponse.json({ error: "reports 배열이 필요합니다" }, { status: 400 });
  await ready();
  const store = getStore();
  const entries: { report: Report; source: BundleSource }[] = [];
  for (const w of wanted as { id?: unknown; version?: unknown }[]) {
    if (typeof w?.id !== "string") return NextResponse.json({ error: "reports[].id가 필요합니다" }, { status: 400 });
    if (w.version !== undefined && !Number.isInteger(w.version)) return NextResponse.json({ error: "version은 정수여야 합니다" }, { status: 400 });
    const report = w.version === undefined ? await store.get(w.id) : await store.getVersion(w.id, w.version as number);
    if (!report) return NextResponse.json({ error: `not found: ${w.id}${w.version === undefined ? "" : `@${w.version}`}` }, { status: 404 });
    entries.push({ report, source: w.version === undefined ? "draft" : { version: w.version as number } });
  }
  const warnings: string[] = [];
  const assets: BundleAsset[] = [];
  const ids = [...new Set(entries.flatMap((e) => collectAssetIds(e.report)))];
  if (assetStorageEnabled()) {
    for (const id of ids) {
      const a = await fetchAsset(id).catch(() => null);
      if (a) assets.push(a); else warnings.push(`에셋 ${id}을(를) 찾지 못했습니다`);
    }
  } else if (ids.length) {
    warnings.push(`에셋 저장소가 없어 에셋 ${ids.length}개를 담지 않았습니다`);
  }
  const zip = buildBundle(entries, assets, warnings);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="daport-export-${stamp}.zip"` } });
}
