// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { DirectConnection } from "@daport/datasource";
import { MemoryConnectionStore } from "../connection-store";

const mes = { name: "mes", via: "direct" as const, host: "db", port: 1521, service: "ORCL", user: "rpt", secretRef: "MES_DB" };
describe("MemoryConnectionStore", () => {
  it("upserts, lists sorted by name, gets, deletes", async () => {
    const s = new MemoryConnectionStore();
    await s.upsert(mes);
    await s.upsert({ name: "factory", via: "agent", url: "https://a.local", secretRef: "AGENT" });
    expect((await s.list()).map((c) => c.name)).toEqual(["factory", "mes"]);
    await s.upsert({ ...mes, host: "db2" });
    expect(((await s.get("mes")) as DirectConnection | null)?.host).toBe("db2");
    expect(await s.delete("mes")).toBe(true);
    expect(await s.delete("mes")).toBe(false);
    expect(await s.get("mes")).toBeNull();
  });
  it("validates on upsert", async () => {
    await expect(new MemoryConnectionStore().upsert({ ...mes, secretRef: "bad" } as never)).rejects.toThrow();
  });
});
