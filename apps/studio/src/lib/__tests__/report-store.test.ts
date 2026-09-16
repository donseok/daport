import { describe, it, expect } from "vitest";
import { MemoryReportStore } from "../report-store";

const input = { id: "a", name: "A", version: 1, page: { width: 100, height: 100 } };

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
});
