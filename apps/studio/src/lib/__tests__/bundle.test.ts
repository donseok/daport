// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { parseReport } from "@daport/core";
import { buildBundle, readBundle, collectConnections, collectAssetIds, applyConnectionMap, BundleInvalidError, MAX_ENTRY_BYTES } from "../bundle";
import { MAX_ASSET_BYTES } from "../asset-io";

const r1 = parseReport({ id: "a", name: "A", version: 1, page: { width: 100, height: 100 },
  datasets: [{ name: "s", type: "sql", connection: "mes", query: "select 1" }, { name: "h", type: "http", url: "https://mes.example.com/api/x" }],
  elements: [{ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, src: "asset://logo" }] });
const r2 = parseReport({ id: "b", version: 1, page: { width: 60, height: 40 } });

describe("bundle", () => {
  it("round-trips reports, assets and manifest through a zip", () => {
    const zip = buildBundle([{ report: r1, source: "draft" }, { report: r2, source: { version: 3 } }], [{ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }], ["w1"]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["assets.json", "assets/logo.png", "manifest.json", "reports/a.json", "reports/b.json"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest).toMatchObject({ format: "daport-bundle", version: 1, reports: [{ id: "a", name: "A", source: "draft" }, { id: "b", name: "", source: { version: 3 } }], connections: { sql: ["mes"], httpHosts: ["mes.example.com"] }, warnings: ["w1"] });
    const back = readBundle(zip);
    expect(back.reports.map((r) => (r as { id: string }).id)).toEqual(["a", "b"]);
    expect(back.assets).toEqual([{ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }]);
  });
  it("collects connections and asset ids, including component bodies", () => {
    expect(collectConnections([r1, r2])).toEqual({ sql: ["mes"], httpHosts: ["mes.example.com"] });
    expect(collectAssetIds(r1)).toEqual(["logo"]);
    expect(collectAssetIds(r2)).toEqual([]);
  });
  it("applyConnectionMap renames sql connections only", () => {
    const out = applyConnectionMap(r1, { mes: "mes-prod", nope: "x" });
    expect(out.datasets[0]).toMatchObject({ type: "sql", connection: "mes-prod" });
    expect(r1.datasets[0]).toMatchObject({ connection: "mes" });   // 원본 불변
  });
  it("rejects a non-zip, a zip without manifest, and an unsupported format version", () => {
    expect(() => readBundle(new Uint8Array([1, 2, 3]))).toThrow(BundleInvalidError);
    const noManifest = buildBundle([], [], []);
    const files = unzipSync(noManifest); delete files["manifest.json"];
    expect(() => readBundle(zipSync(files))).toThrow(BundleInvalidError);
    expect(() => readBundle(zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "daport-bundle", version: 2, reports: [] })) }))).toThrow(/version/);
  });
  it("rejects a bundle whose entry inflates past the per-entry size cap (zip-bomb guard)", () => {
    // 0으로 채운 버퍼는 압축률이 극단적으로 높아 zip 자체는 몇 KB지만 해제하면 상한을 넘는다
    const files = {
      "manifest.json": strToU8(JSON.stringify({ format: "daport-bundle", version: 1, reports: [] })),
      "assets/bomb.bin": new Uint8Array(MAX_ENTRY_BYTES + 1),
    };
    const zip = zipSync(files, { level: 9 });
    expect(() => readBundle(zip)).toThrow(BundleInvalidError);
  });
  it("drops assets.json entries that fail id/name/mime/size validation, warning instead of throwing (I2)", () => {
    const manifest = { format: "daport-bundle", version: 1, reports: [] };
    const bad = [
      { id: "bad id", name: "ok.png", mime: "image/png" },              // id 형식 위반
      { id: "n2", name: "../evil.png", mime: "image/png" },             // name 경로 이탈
      { id: "n3", name: "ok.png", mime: "text/html" },                  // mime 미허용
      { id: "n4", name: "ok.png", mime: "image/png" },                  // 크기 초과
    ];
    const files: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "assets.json": strToU8(JSON.stringify(bad)),
      "assets/bad id.png": new Uint8Array([1]),
      "assets/n2.png": new Uint8Array([1]),
      "assets/n3.png": new Uint8Array([1]),
      "assets/n4.png": new Uint8Array(MAX_ASSET_BYTES + 1),
    };
    const { manifest: out, assets } = readBundle(zipSync(files));
    expect(assets).toEqual([]);
    expect(out.warnings).toHaveLength(4);
    for (const id of ["bad id", "n2", "n3", "n4"]) expect(out.warnings.some((w) => w.includes(id))).toBe(true);
  });
  it("treats a non-array assets.json as empty, a non-array manifest.warnings as empty, and rejects a report entry without an id (I3)", () => {
    const withBadAssets = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "daport-bundle", version: 1, reports: [] })), "assets.json": strToU8(JSON.stringify({ oops: true })) });
    expect(readBundle(withBadAssets).assets).toEqual([]);

    const withBadWarnings = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "daport-bundle", version: 1, reports: [], warnings: "not-an-array" })) });
    expect(readBundle(withBadWarnings).manifest.warnings).toEqual([]);

    const withBadReportId = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "daport-bundle", version: 1, reports: [{ name: "x", source: "draft" }] })) });
    expect(() => readBundle(withBadReportId)).toThrow(BundleInvalidError);
  });
});
