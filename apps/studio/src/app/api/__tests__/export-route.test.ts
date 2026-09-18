// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { unzipSync, strFromU8 } from "fflate";

const fetchAsset = vi.fn();
vi.mock("@/lib/asset-io", () => ({ assetStorageEnabled: () => true, fetchAsset }));
const { POST } = await import("../export/route");
const { getStore, ready } = await import("@/lib/report-store");

const call = (body: unknown) =>
  POST(new Request("http://studio.local/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/export", () => {
  beforeEach(() => { fetchAsset.mockReset(); });

  it("zips the requested report; a missing asset is warned about in the manifest instead of failing the export", async () => {
    await ready();
    const id = `exp-${Date.now()}`;
    await getStore().create({ id, name: "E", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, src: "asset://missing-logo" }] });
    fetchAsset.mockResolvedValue(null);   // 저장소는 켜져 있지만 이 에셋은 없다
    const res = await call({ reports: [{ id }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toContain(`reports/${id}.json`);
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as { warnings: string[] };
    expect(manifest.warnings.some((w) => w.includes("missing-logo"))).toBe(true);
  });

  it("404s and rejects the whole export when any requested report or version is missing", async () => {
    const res = await call({ reports: [{ id: "no-such-report-xyz" }] });
    expect(res.status).toBe(404);
  });

  it("400s on an empty or invalid reports field", async () => {
    expect((await call({ reports: [] })).status).toBe(400);
    expect((await call({ reports: "nope" })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });
});
