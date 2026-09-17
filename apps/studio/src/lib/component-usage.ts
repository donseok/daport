import { ReportSchema, refsTo, upgradeRefs, type Report } from "@daport/core";
import { getStore, ready, NotFoundError } from "./report-store";
import { getComponentStore } from "./component-store";

export type Usage = { reportId: string; versions: number[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 저장된 레포트를 list() 순서로 하나씩 읽는다. 이 단계에서는 사용처 색인이 없으므로 전체를 훑는다(스펙 6.2) */
async function* storedReports(): AsyncGenerator<Report> {
  await ready();
  const store = getStore();
  for (const s of await store.list()) {
    const r = await store.get(s.id);
    if (r) yield r;
  }
}

const versionsIn = (report: Report, componentId: string): number[] =>
  [...new Set(refsTo(report, componentId).map((ref) => ref.version))].sort((a, b) => a - b);

/** 이 컴포넌트를 참조하는 저장된 레포트와 각 레포트가 쓰는 버전들 */
export async function findUsage(componentId: string): Promise<Usage[]> {
  const out: Usage[] = [];
  for await (const r of storedReports()) {
    const versions = versionsIn(r, componentId);
    if (versions.length > 0) out.push({ reportId: r.id, versions });
  }
  return out;
}

/**
 * 저장된 모든 레포트에서 이 컴포넌트의 인스턴스를 라이브러리 최신 버전으로 올린다(스펙 7.2 규칙, core upgradeRefs).
 * 이미 모두 최신인 레포트는 건드리지 않는다. 검증·저장에 실패한 레포트는 skipped에 사유를 남기고 나머지를 계속한다
 */
export async function applyLatestToReports(componentId: string): Promise<{ updated: string[]; skipped: { reportId: string; error: string }[] }> {
  const detail = await getComponentStore().get(componentId);
  if (!detail) throw new NotFoundError(componentId);
  const { latestVersion } = detail.summary;
  const store = getStore();
  const updated: string[] = [];
  const skipped: { reportId: string; error: string }[] = [];
  for await (const r of storedReports()) {
    const versions = versionsIn(r, componentId);
    if (versions.length === 0 || versions.every((v) => v === latestVersion)) continue;
    try {
      const checked = ReportSchema.safeParse(upgradeRefs(r, componentId, latestVersion, detail.latest));
      if (!checked.success) {
        skipped.push({ reportId: r.id, error: checked.error.issues.map((i) => i.message).join("; ") });
        continue;
      }
      await store.update(r.id, checked.data);
      updated.push(r.id);
    } catch (e) {
      skipped.push({ reportId: r.id, error: message(e) });
    }
  }
  return { updated, skipped };
}
