// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseReport, parseComponentBody } from "@daport/core";
import { MemoryReportStore } from "../report-store";
import { buildBundle, type BundleAsset } from "../bundle";
import { importBundle } from "../import-bundle";
import { getComponentStore } from "../component-store";

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
  it("skips a report whose embedded component body hash differs from the library (COMPONENT_MISMATCH) and creates nothing", async () => {
    delete process.env.DATABASE_URL;   // 메모리 컴포넌트 저장소
    const rawBody = { name: "헤더", w: 50, h: 10, props: [{ name: "title", type: "string", default: "T" }],
      elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "{{ props.title }}" }] };
    await getComponentStore().create("ib-hdr", parseComponentBody(rawBody));   // 라이브러리 v1
    const tampered = { ...rawBody, elements: [{ ...rawBody.elements[0], value: "변조됨" }] };
    const report = parseReport({ id: "mismatch", name: "M", version: 1, page: { width: 100, height: 100 },
      components: { "ib-hdr@1": tampered },
      elements: [{ id: "h1", type: "ref", ref: "ib-hdr", version: 1, x: 10, y: 10, w: 50, h: 10 }] });
    const store = new MemoryReportStore();
    const zip = buildBundle([{ report, source: "draft" }], [], []);
    const res = await importBundle(zip, { filename: "z.zip" }, { store, assets: null });
    expect(res.skipped).toEqual([{ id: "mismatch", reason: "COMPONENT_MISMATCH" }]);
    expect(res.imported).toEqual([]);
    expect(await store.get("mismatch")).toBeNull();
  });
  it("warns about connections missing on this instance", async () => {
    const store = new MemoryReportStore();
    const r = parseReport({ id: "c1", version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "l", type: "sql", connection: "nowhere", query: "SELECT 1 FROM DUAL" }] });
    const res = await importBundle(buildBundle([{ report: r, source: "draft" }], [], []), { filename: "c.zip" }, { store, assets: null });
    expect(res.imported).toEqual([{ id: "c1", action: "created" }]);
    expect(res.warnings).toContainEqual("c1: 연결 nowhere이(가) 이 인스턴스에 없습니다");
  });
});
