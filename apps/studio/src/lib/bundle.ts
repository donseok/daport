import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { walkElements, type Report } from "@daport/core";

export type BundleSource = "draft" | { version: number };
export type BundleManifest = {
  format: "daport-bundle"; version: 1; exportedAt: string;
  reports: { id: string; name: string; source: BundleSource }[];
  connections: { sql: string[]; httpHosts: string[] };
  warnings: string[];
};
export type BundleAsset = { id: string; name: string; mime: string; data: Uint8Array };

export class BundleInvalidError extends Error {
  readonly code = "BUNDLE_INVALID";
  constructor(message: string) { super(message); this.name = "BundleInvalidError"; }
}

const ASSET_PREFIX = "asset://";
const uniq = (xs: string[]) => [...new Set(xs)];

/** sql 데이터셋의 연결 이름과 http 데이터셋의 호스트 — 가져오는 쪽의 점검 목록 (4단계 스펙 6.1) */
export function collectConnections(reports: Report[]): BundleManifest["connections"] {
  const sql: string[] = [], httpHosts: string[] = [];
  for (const r of reports) for (const ds of r.datasets) {
    if (ds.type === "sql") sql.push(ds.connection);
    else if (ds.type === "http") { try { httpHosts.push(new URL(ds.url).host); } catch { /* 표현식 URL은 건너뛴다 */ } }
  }
  return { sql: uniq(sql).sort(), httpHosts: uniq(httpHosts).sort() };
}

/** 모델이 참조하는 asset://id — resolveAssetUrls가 훑는 자리와 같다(본문·컴포넌트 image src, ref 입력값, image 입력값 기본값) */
export function collectAssetIds(report: Report): string[] {
  const ids: string[] = [];
  const take = (v: unknown) => { if (typeof v === "string" && v.startsWith(ASSET_PREFIX)) ids.push(v.slice(ASSET_PREFIX.length)); };
  const scan = (elements: Report["elements"]) => walkElements(elements, (el) => {
    if (el.type === "image") take(el.src);
    else if (el.type === "ref") Object.values(el.props).forEach(take);
  });
  scan(report.elements);
  for (const body of Object.values(report.components)) { scan(body.elements); for (const p of body.props) if (p.type === "image") take(p.default); }
  return uniq(ids);
}

const ext = (name: string) => name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

export function buildBundle(entries: { report: Report; source: BundleSource }[], assets: BundleAsset[], warnings: string[]): Uint8Array {
  const manifest: BundleManifest = {
    format: "daport-bundle", version: 1, exportedAt: new Date().toISOString(),
    reports: entries.map((e) => ({ id: e.report.id, name: e.report.name, source: e.source })),
    connections: collectConnections(entries.map((e) => e.report)),
    warnings,
  };
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const e of entries) files[`reports/${e.report.id}.json`] = strToU8(JSON.stringify(e.report, null, 2));
  files["assets.json"] = strToU8(JSON.stringify(assets.map(({ id, name, mime, data }) => ({ id, name, mime, size: data.length })), null, 2));
  for (const a of assets) files[`assets/${a.id}${ext(a.name)}`] = a.data;
  return zipSync(files, { level: 6 });
}

function parseJson(bytes: Uint8Array | undefined, what: string): unknown {
  if (!bytes) throw new BundleInvalidError(`${what}이(가) 없습니다`);
  try { return JSON.parse(strFromU8(bytes)); } catch { throw new BundleInvalidError(`${what}이(가) JSON이 아닙니다`); }
}

export function readBundle(zip: Uint8Array): { manifest: BundleManifest; reports: unknown[]; assets: BundleAsset[] } {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new BundleInvalidError("zip 파일이 아닙니다"); }
  const manifest = parseJson(files["manifest.json"], "manifest.json") as Partial<BundleManifest>;
  if (manifest.format !== "daport-bundle") throw new BundleInvalidError("daport 번들이 아닙니다");
  if (manifest.version !== 1) throw new BundleInvalidError(`지원하지 않는 번들 version: ${String(manifest.version)}`);
  if (!Array.isArray(manifest.reports)) throw new BundleInvalidError("manifest.reports가 배열이 아닙니다");
  const reports = manifest.reports.map((r) => parseJson(files[`reports/${r.id}.json`], `reports/${r.id}.json`));
  const meta = files["assets.json"] ? (parseJson(files["assets.json"], "assets.json") as { id: string; name: string; mime: string }[]) : [];
  const assets: BundleAsset[] = [];
  for (const m of meta) {
    const data = files[`assets/${m.id}${ext(m.name)}`];
    if (data) assets.push({ id: m.id, name: m.name, mime: m.mime, data });
  }
  return { manifest: { warnings: [], connections: { sql: [], httpHosts: [] }, ...manifest } as BundleManifest, reports, assets };
}

/** sql 데이터셋의 connection 이름을 치환한 복제본. 그 밖은 그대로 */
export function applyConnectionMap(report: Report, map: Record<string, string>): Report {
  const clone = structuredClone(report);
  for (const ds of clone.datasets) if (ds.type === "sql" && Object.hasOwn(map, ds.connection)) ds.connection = map[ds.connection];
  return clone;
}
