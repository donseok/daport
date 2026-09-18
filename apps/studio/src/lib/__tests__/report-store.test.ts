import { describe, it, expect, afterEach, vi } from "vitest";
import { MemoryReportStore, NotFoundError } from "../report-store";
import { reportHash, parseReport } from "@daport/core";

const input = { id: "a", name: "A", version: 1, page: { width: 100, height: 100 } };

afterEach(() => { vi.useRealTimers(); });

describe("MemoryReportStore", () => {
  it("creates, gets, lists, updates", async () => {
    const s = new MemoryReportStore();
    await s.create(input);
    expect((await s.get("a"))?.name).toBe("A");
    expect(await s.list()).toHaveLength(1);
    await s.update("a", { ...input, name: "B" });
    expect((await s.get("a"))?.name).toBe("B");
  });
  it("rejects duplicate and missing", async () => {
    const s = new MemoryReportStore();
    await s.create(input);
    await expect(s.create(input)).rejects.toThrow(/exists/);
    await expect(s.update("zz", input)).rejects.toThrow(/not found/);
  });
  it("rejects invalid report", async () => {
    await expect(new MemoryReportStore().create({ id: "x" } as any)).rejects.toThrow();
  });
  it("throws NotFoundError for a missing id", async () => {
    await expect(new MemoryReportStore().update("zz", input)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("list() reports the time of the last write as updatedAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = "2026-09-16T00:00:00.000Z";
    const t1 = "2026-09-16T00:00:01.000Z";
    const s = new MemoryReportStore();
    vi.setSystemTime(new Date(t0));
    await s.create(input);
    vi.setSystemTime(new Date(t1));
    expect((await s.list())[0].updatedAt).toBe(t0); // unchanged by the clock alone
    await s.update("a", { ...input, name: "B" });
    expect((await s.list())[0].updatedAt).toBe(t1); // moves on update()
  });
});

describe("getStore", () => {
  it("shares one store across separately loaded module instances (Next bundles pages and route handlers apart)", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const a = (await import("../report-store")).getStore();
    vi.resetModules();
    const b = (await import("../report-store")).getStore();
    expect(b).toBe(a);
  });
  it("seeds the in-memory store with the quality-cert fixture; ready() resolves once it is in", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const mod = await import("../report-store");
    const store = mod.getStore();
    await mod.ready();
    expect((await store.get("quality-cert"))?.name).toBe("품질보증서");
    expect((await store.list()).map((r) => r.id)).toContain("quality-cert");
  });
  it("seeds all seven example fixtures, including inspection-cert's repeat source", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    delete (globalThis as any).__daportReportStore;
    delete (globalThis as any).__daportSeeded;
    const mod = await import("../report-store");
    const store = mod.getStore();
    await mod.ready();
    const cert = await store.get("inspection-cert");
    expect(cert?.repeat?.source).toBe("lots");
    const ids = (await store.list()).map((r) => r.id);
    expect(ids).toHaveLength(7);
    expect(ids).toEqual(expect.arrayContaining(["coil-tag", "product-label"]));
  });
  it("does not wedge ready() forever when one fixture fails to seed — the other fixtures still land", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    delete (globalThis as any).__daportReportStore;
    delete (globalThis as any).__daportSeeded;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("../report-store");
    const createSpy = vi.spyOn(mod.MemoryReportStore.prototype, "create").mockRejectedValueOnce(new Error("boom"));
    const store = mod.getStore();
    await expect(mod.ready()).resolves.toBeUndefined();
    // 첫 번째(quality-cert) 시드만 실패시켰으므로 나머지 네 개는 정상적으로 들어온다
    expect((await store.list()).map((r) => r.id)).toEqual(expect.arrayContaining(["inspection-cert", "invoice", "shipping-order", "badge-sheet"]));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("seed failed: quality-cert"), "boom");
    createSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("MemoryReportStore versions", () => {
  const draft = { id: "v", name: "V", version: 1, page: { width: 100, height: 100 } };
  async function withReport() { const s = new MemoryReportStore(); await s.create(draft); return s; }

  it("publish stores an immutable version N+1 and moves the pointer", async () => {
    const s = await withReport();
    const v1 = await s.publish("v", parseReport(draft), "첫 배포");
    expect(v1.version).toBe(1);
    await s.update("v", { ...draft, name: "V2" });
    const v2 = await s.publish("v", parseReport({ ...draft, name: "V2" }));
    expect(v2.version).toBe(2);
    expect((await s.getPublished("v"))?.version).toBe(2);
    expect((await s.getVersion("v", 1))?.name).toBe("V");
    expect((await s.getVersion("v", 3))).toBeNull();
    const list = await s.listVersions("v");
    expect(list?.versions.map((x) => [x.version, x.published, x.note])).toEqual([[1, false, "첫 배포"], [2, true, null]]);
    expect(list?.publishedVersion).toBe(2);
  });
  it("setPublished moves only the pointer; draft and versions stay", async () => {
    const s = await withReport();
    await s.publish("v", parseReport(draft));
    await s.update("v", { ...draft, name: "V2" });
    await s.publish("v", parseReport({ ...draft, name: "V2" }));
    await s.setPublished("v", 1);
    expect((await s.getPublished("v"))?.report.name).toBe("V");
    expect((await s.get("v"))?.name).toBe("V2");
    expect((await s.listVersions("v"))?.versions).toHaveLength(2);
    await expect(s.setPublished("v", 9)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.setPublished("zz", 1)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("reports hashes: draftHash matches reportHash(draft), version hash matches its model", async () => {
    const s = await withReport();
    await s.publish("v", parseReport(draft));
    const list = await s.listVersions("v");
    expect(list?.draftHash).toBe(reportHash(parseReport(draft)));
    expect(list?.versions[0].hash).toBe(reportHash(parseReport(draft)));
    expect((await s.list())[0]).toMatchObject({ publishedVersion: 1, modified: false });
    await s.update("v", { ...draft, name: "V2" });
    expect((await s.list())[0]).toMatchObject({ publishedVersion: 1, modified: true });
  });
  it("getPublished is null before the first publish and listVersions is null for an unknown id", async () => {
    const s = await withReport();
    expect(await s.getPublished("v")).toBeNull();
    expect((await s.list())[0]).toMatchObject({ publishedVersion: null, modified: false });
    expect(await s.listVersions("zz")).toBeNull();
    await expect(s.publish("zz", parseReport(draft))).rejects.toBeInstanceOf(NotFoundError);
  });
  it("addVersion adds a version without moving the pointer", async () => {
    const s = await withReport();
    await s.publish("v", parseReport(draft));
    const added = await s.addVersion("v", parseReport({ ...draft, name: "imported" }), "가져옴: x.zip");
    expect(added.version).toBe(2);
    expect((await s.getPublished("v"))?.version).toBe(1);
    expect((await s.listVersions("v"))?.versions[1]).toMatchObject({ version: 2, published: false, note: "가져옴: x.zip" });
    await expect(s.addVersion("zz", parseReport(draft))).rejects.toBeInstanceOf(NotFoundError);
  });
  it("versions are immutable copies", async () => {
    const s = await withReport();
    const model = parseReport(draft);
    await s.publish("v", model);
    model.name = "mutated";
    expect((await s.getVersion("v", 1))?.name).toBe("V");
  });
});
