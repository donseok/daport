import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPresetStore, ConflictError, ForbiddenError } from "../preset-store";
import { BUILTIN_PRESETS } from "../presets";
import { NotFoundError } from "../report-store";

describe("BUILTIN_PRESETS", () => {
  it("has the document sizes and the two label presets with label output", () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id);
    expect(ids).toEqual(["a4-portrait", "a4-landscape", "a3-portrait", "a3-landscape", "letter", "coil-tag-100x150", "product-label-60x40"]);
    expect(BUILTIN_PRESETS.every((p) => p.builtin)).toBe(true);
    const coil = BUILTIN_PRESETS.find((p) => p.id === "coil-tag-100x150")!;
    expect(coil.page).toMatchObject({ width: 100, height: 150 });
    expect(coil.output).toEqual({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } });
    expect(BUILTIN_PRESETS.find((p) => p.id === "a4-landscape")!.page).toMatchObject({ width: 297, height: 210 });
  });
});

describe("MemoryPresetStore", () => {
  let store: MemoryPresetStore;
  beforeEach(() => { store = new MemoryPresetStore(); });

  it("lists builtin presets first, then user presets", async () => {
    await store.create({ id: "my-tag", name: "내 Tag", page: { width: 80, height: 50 } });
    const list = await store.list();
    expect(list.slice(0, BUILTIN_PRESETS.length).map((p) => p.id)).toEqual(BUILTIN_PRESETS.map((p) => p.id));
    expect(list.at(-1)).toMatchObject({ id: "my-tag", builtin: false, output: { kind: "pdf" } });
    expect(await store.get("my-tag")).toMatchObject({ name: "내 Tag" });
    expect(await store.get("a4-portrait")).toMatchObject({ builtin: true });
  });
  it("rejects a builtin or duplicate id with ConflictError and forces builtin false", async () => {
    await expect(store.create({ id: "a4-portrait", name: "x", page: { width: 1, height: 1 } })).rejects.toThrow(ConflictError);
    await store.create({ id: "dup", name: "x", page: { width: 1, height: 1 }, builtin: true });
    expect((await store.get("dup"))!.builtin).toBe(false);
    await expect(store.create({ id: "dup", name: "y", page: { width: 1, height: 1 } })).rejects.toThrow(ConflictError);
  });
  it("deletes user presets, refuses builtin ones and reports missing ids", async () => {
    await store.create({ id: "gone", name: "x", page: { width: 1, height: 1 } });
    await store.delete("gone");
    expect(await store.get("gone")).toBeNull();
    await expect(store.delete("a4-portrait")).rejects.toThrow(ForbiddenError);
    await expect(store.delete("nope")).rejects.toThrow(NotFoundError);
  });
});
