import { describe, it, expect, afterEach, vi } from "vitest";
import { MemoryReportStore, NotFoundError } from "../report-store";

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
  it("seeds all five example fixtures, including inspection-cert's repeat source", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    delete (globalThis as any).__daportReportStore;
    delete (globalThis as any).__daportSeeded;
    const mod = await import("../report-store");
    const store = mod.getStore();
    await mod.ready();
    const cert = await store.get("inspection-cert");
    expect(cert?.repeat?.source).toBe("lots");
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
