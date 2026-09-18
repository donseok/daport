// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { findAllConnectionUsage, findConnectionUsage } from "../connection-usage";
import { getStore, ready } from "../report-store";

const mkReport = (id: string, connection: string | null) => ({
  id,
  version: 1,
  page: { width: 10, height: 10 },
  datasets: connection ? [{ name: "d", type: "sql" as const, connection, query: "SELECT 1 FROM DUAL" }] : [],
});

describe("findAllConnectionUsage", () => {
  it("walks the report store once and buckets report ids by sql connection name", async () => {
    await ready();
    const store = getStore();
    const stamp = Date.now();
    const ids = [`cu-a-${stamp}`, `cu-b-${stamp}`, `cu-c-${stamp}`, `cu-none-${stamp}`];
    await store.create(mkReport(ids[0], "conn-1"));
    await store.create(mkReport(ids[1], "conn-2"));
    await store.create(mkReport(ids[2], "conn-3"));
    await store.create(mkReport(ids[3], null));

    const getSpy = vi.spyOn(store, "get");
    const total = (await store.list()).length;

    const all = await findAllConnectionUsage();

    // 저장소 전체를 한 번만 훑는다: 레포트 개수만큼만 get()이 불린다 (연결 개수와 무관하게)
    expect(getSpy).toHaveBeenCalledTimes(total);
    expect(all["conn-1"]).toContain(ids[0]);
    expect(all["conn-2"]).toContain(ids[1]);
    expect(all["conn-3"]).toContain(ids[2]);
    expect(Object.values(all).flat()).not.toContain(ids[3]);

    getSpy.mockRestore();
  });

  it("findConnectionUsage still returns per-name results built on the same single-pass scan", async () => {
    await ready();
    const store = getStore();
    const stamp = Date.now();
    const id = `cu-single-${stamp}`;
    await store.create(mkReport(id, "conn-single"));
    expect(await findConnectionUsage("conn-single")).toContain(id);
    expect(await findConnectionUsage("conn-nonexistent")).toEqual([]);
  });
});
