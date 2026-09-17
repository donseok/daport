// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { MemoryReportStore } from "../report-store";
import { buildBundle, type BundleAsset } from "../bundle";
import { importBundle } from "../import-bundle";

const base = (id: string, value = "hi") => parseReport({ id, name: id.toUpperCase(), version: 1, page: { width: 100, height: 100 },
  datasets: [{ name: "s", type: "sql", connection: "dev", query: "select 1" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value }, { id: "i", type: "image", x: 0, y: 20, w: 10, h: 10, src: "asset://logo" }] });

function memAssets() {
  const map = new Map<string, BundleAsset>();
  return { map, has: async (id: string) => map.has(id), put: async (a: BundleAsset) => { map.set(a.id, a); } };
}

describe("importBundle", () => {
  it("creates new reports as drafts, adds a version (unpublished) for existing ids, uploads missing assets, maps connections", async () => {
    const store = new MemoryReportStore();
    await store.create(base("existing", "old"));
    await store.publish("existing", (await store.get("existing"))!);
    const assets = memAssets();
    await assets.put({ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([9]) });
    const zip = buildBundle([{ report: base("fresh"), source: "draft" }, { report: base("existing", "imported"), source: "draft" }],
      [{ id: "logo", name: "logo.png", mime: "image/png", data: new Uint8Array([1]) }, { id: "seal", name: "seal.png", mime: "image/png", data: new Uint8Array([2]) }], []);
    const res = await importBundle(zip, { filename: "x.zip", connectionMap: { dev: "prod" } }, { store, assets });
    expect(res.imported).toEqual([{ id: "fresh", action: "created" }, { id: "existing", action: { version: 2 } }]);
    expect(res.skipped).toEqual([]);
    expect((await store.get("fresh"))?.datasets[0]).toMatchObject({ connection: "prod" });
    expect((await store.get("existing"))?.elements[0]).toMatchObject({ value: "old" });          // draft 불변
    expect((await store.getPublished("existing"))?.version).toBe(1);                              // 포인터 불변
    expect((await store.getVersion("existing", 2))?.elements[0]).toMatchObject({ value: "imported" });
    expect((await store.listVersions("existing"))?.versions[1].note).toBe("가져옴: x.zip");
    expect(assets.map.get("logo")?.data).toEqual(new Uint8Array([9]));                           // 이미 있으면 건너뜀
    expect(assets.map.get("seal")?.data).toEqual(new Uint8Array([2]));
  });
  it("skips an invalid report and keeps going; warns when asset storage is off", async () => {
    const store = new MemoryReportStore();
    const zip = buildBundle([{ report: base("ok"), source: "draft" }], [{ id: "logo", name: "l.png", mime: "image/png", data: new Uint8Array([1]) }], []);
    // 손상된 레포트를 끼워 넣는다
    const { unzipSync, zipSync, strToU8 } = await import("fflate");
    const files = unzipSync(zip);
    files["reports/bad.json"] = strToU8(JSON.stringify({ id: "bad", page: {} }));
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.reports.push({ id: "bad", name: "", source: "draft" });
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    const res = await importBundle(zipSync(files), { filename: "y.zip" }, { store, assets: null });
    expect(res.imported).toEqual([{ id: "ok", action: "created" }]);
    expect(res.skipped).toEqual([{ id: "bad", reason: expect.any(String) }]);
    expect(res.warnings.some((w) => w.includes("에셋"))).toBe(true);
  });
});
