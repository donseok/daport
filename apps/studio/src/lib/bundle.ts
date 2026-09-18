import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { walkElements, type Report } from "@daport/core";
import { IMAGE_TYPES, MAX_ASSET_BYTES } from "./asset-io";

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

/** 압축 해제 후 항목 하나의 크기 상한. 20MB 업로드 상한 안에서도 극단적 압축비로 부풀릴 수 있어 별도로 막는다 */
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
/** 압축 해제 후 전체 항목 합계 상한 (압축 폭탄 방지) */
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/**
 * unzipSync를 감싸 압축 폭탄을 막는다. fflate의 filter는 central directory의 선언된 크기(originalSize)로
 * 판단하고, false를 돌려주면 그 항목은 실제로 압축 해제하지 않는다 — 그래서 필터 단계에서 걸러야 메모리를 아낀다.
 * 초과가 발견되면 filter 안에서 바로 던지지 않고 플래그만 세운다(그 항목만 건너뛰고 나머지 스캔은 계속하되
 * unzipSync가 끝난 뒤 한 번에 BundleInvalidError로 던져, 아래 catch가 "zip 파일이 아닙니다"로 덮어쓰지 않게 한다)
 */
function unzipGuarded(zip: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let oversized = false;
  const files = unzipSync(zip, {
    filter: (file) => {
      if (oversized) return false;
      if (file.originalSize > MAX_ENTRY_BYTES) { oversized = true; return false; }
      total += file.originalSize;
      if (total > MAX_TOTAL_BYTES) { oversized = true; return false; }
      return true;
    },
  });
  if (oversized) throw new BundleInvalidError(`번들 항목이 너무 큽니다 (개별 ${MAX_ENTRY_BYTES}바이트, 전체 ${MAX_TOTAL_BYTES}바이트 상한을 넘었습니다)`);
  return files;
}

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

/** 에셋 id: 업로드 라우트가 만드는 crypto.randomUUID() 형태를 포괄한다. name: 경로 이탈(`../`, 구분자) 방지 */
const ASSET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isSafeAssetName = (name: string) => typeof name === "string" && name.length > 0 && !/[/\\]/.test(name) && !name.includes("..");

export function readBundle(zip: Uint8Array): { manifest: BundleManifest; reports: unknown[]; assets: BundleAsset[] } {
  let files: Record<string, Uint8Array>;
  try { files = unzipGuarded(zip); }
  catch (e) { if (e instanceof BundleInvalidError) throw e; throw new BundleInvalidError("zip 파일이 아닙니다"); }
  const manifest = parseJson(files["manifest.json"], "manifest.json") as Partial<BundleManifest>;
  if (manifest.format !== "daport-bundle") throw new BundleInvalidError("daport 번들이 아닙니다");
  if (manifest.version !== 1) throw new BundleInvalidError(`지원하지 않는 번들 version: ${String(manifest.version)}`);
  if (!Array.isArray(manifest.reports)) throw new BundleInvalidError("manifest.reports가 배열이 아닙니다");
  for (const r of manifest.reports) if (typeof (r as { id?: unknown })?.id !== "string") throw new BundleInvalidError("manifest.reports 항목에 id가 없습니다");
  const reports = manifest.reports.map((r) => parseJson(files[`reports/${r.id}.json`], `reports/${r.id}.json`));
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings.filter((w): w is string => typeof w === "string") : [];
  const rawMeta = files["assets.json"] ? parseJson(files["assets.json"], "assets.json") : [];
  const meta = Array.isArray(rawMeta) ? (rawMeta as { id: string; name: string; mime: string; size?: number }[]) : [];
  const assets: BundleAsset[] = [];
  for (const m of meta) {
    const data = files[`assets/${m.id}${ext(m.name)}`];
    if (!data) continue;
    // 업로드 라우트보다 느슨한 검증으로 임의 mime을 공개 Blob에 쓰거나 경로를 이탈시키지 않도록, 못 미더운 항목은 담지 않고 경고만 남긴다
    if (!ASSET_ID_RE.test(m.id)) { warnings.push(`에셋 id가 올바르지 않아 건너뜁니다: ${JSON.stringify(m.id)}`); continue; }
    if (!isSafeAssetName(m.name)) { warnings.push(`에셋 이름이 올바르지 않아 건너뜁니다: ${m.id}`); continue; }
    if (!IMAGE_TYPES.has(m.mime)) { warnings.push(`에셋 ${m.id}의 형식(${m.mime})을 지원하지 않아 건너뜁니다`); continue; }
    if (data.length > MAX_ASSET_BYTES) { warnings.push(`에셋 ${m.id}이(가) 너무 커서 건너뜁니다 (${MAX_ASSET_BYTES}바이트 상한)`); continue; }
    assets.push({ id: m.id, name: m.name, mime: m.mime, data });
  }
  return { manifest: { ...manifest, warnings, connections: manifest.connections ?? { sql: [], httpHosts: [] } } as BundleManifest, reports, assets };
}

/** sql 데이터셋의 connection 이름을 치환한 복제본. 그 밖은 그대로 */
export function applyConnectionMap(report: Report, map: Record<string, string>): Report {
  const clone = structuredClone(report);
  for (const ds of clone.datasets) if (ds.type === "sql" && Object.hasOwn(map, ds.connection)) ds.connection = map[ds.connection];
  return clone;
}
