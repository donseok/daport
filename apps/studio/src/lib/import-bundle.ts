import { parseReport, type Report } from "@daport/core";
import { readBundle, applyConnectionMap, collectAssetIds, type BundleAsset } from "./bundle";
import { checkReportComponents } from "./report-guard";
import type { ReportStore } from "./report-store";

export type ImportResult = { imported: { id: string; action: "created" | { version: number } }[]; skipped: { id: string; reason: string }[]; warnings: string[] };
export type ImportDeps = { store: ReportStore; assets: { has(id: string): Promise<boolean>; put(a: BundleAsset): Promise<void> } | null };

/**
 * 번들 가져오기 (4단계 스펙 6.3). 에셋은 없는 것만 올리고, 레포트는 같은 id가 있으면 새 버전(배포 안 함), 없으면 draft로 만든다.
 * 레포트 단위로 실패를 건너뛰며 전체 롤백은 하지 않는다
 */
export async function importBundle(zip: Uint8Array, opts: { filename: string; connectionMap?: Record<string, string> }, deps: ImportDeps): Promise<ImportResult> {
  const bundle = readBundle(zip);   // 손상은 BundleInvalidError로 던진다 (라우트가 400)
  const result: ImportResult = { imported: [], skipped: [], warnings: [...bundle.manifest.warnings] };
  if (deps.assets) {
    for (const a of bundle.assets) if (!(await deps.assets.has(a.id))) await deps.assets.put(a);
  } else if (bundle.assets.length) {
    result.warnings.push(`에셋 저장소가 없어 에셋 ${bundle.assets.length}개를 건너뛰었습니다`);
  }
  for (const raw of bundle.reports) {
    const id = (raw as { id?: unknown })?.id;
    if (typeof id !== "string") { result.skipped.push({ id: "?", reason: "id가 없습니다" }); continue; }
    try {
      let report: Report = parseReport(raw);
      if (opts.connectionMap) report = applyConnectionMap(report, opts.connectionMap);
      const guard = await checkReportComponents(report);
      if (!guard.ok) { result.skipped.push({ id, reason: guard.body.code }); continue; }
      result.warnings.push(...guard.warnings.map((w) => `${id}: ${w}`));
      const missing = deps.assets ? [] : collectAssetIds(report);
      if (missing.length) result.warnings.push(`${id}: 에셋 ${missing.join(", ")}은(는) 이 인스턴스에 없습니다`);
      if (await deps.store.get(id)) {
        // 같은 id가 있으면 draft를 덮지 않고 버전만 추가한다 (배포 포인터 그대로)
        const { version } = await deps.store.addVersion(id, guard.report, `가져옴: ${opts.filename}`);
        result.imported.push({ id, action: { version } });
      } else {
        await deps.store.create(guard.report);
        result.imported.push({ id, action: "created" });
      }
    } catch (e) {
      result.skipped.push({ id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
