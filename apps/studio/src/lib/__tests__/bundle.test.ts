// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { parseReport } from "@daport/core";
import { buildBundle, readBundle, collectConnections, collectAssetIds, applyConnectionMap, BundleInvalidError } from "../bundle";

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
});
