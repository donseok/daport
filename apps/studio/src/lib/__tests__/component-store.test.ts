import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { componentHash, parseComponentBody, type ComponentBody } from "@daport/core";
import { MemoryComponentStore } from "../component-store";
import { ConflictError } from "../preset-store";
import { NotFoundError } from "../report-store";

const text = (id: string, value: string) => ({ id, type: "text", x: 0, y: 0, w: 180, h: 10, value });
// 저장소가 기본값을 채운 파싱 결과를 저장·해시하는지 보려고 픽스처는 기본값을 비운 원본 입력으로 둔다
const V1 = { name: "머리글", w: 180, h: 24, props: [{ name: "title", type: "string", default: "제목" }], elements: [text("t", "{{ props.title }}")] } as ComponentBody;
const V2 = { ...V1, name: "머리글 넓게", h: 30, elements: [text("t", "{{ props.title }}"), text("sub", "부제")] } as ComponentBody;
const hashOf = (b: ComponentBody) => componentHash(parseComponentBody(b));

afterEach(() => { vi.useRealTimers(); });

describe("MemoryComponentStore", () => {
  let store: MemoryComponentStore;
  beforeEach(() => { store = new MemoryComponentStore(); });

  it("create stores version 1 of the parsed body and returns its hash", async () => {
    const res = await store.create("company-header", V1);
    expect(res).toEqual({ version: 1, hash: hashOf(V1) });
    const v = await store.getVersion("company-header", 1);
    expect(v).toEqual({ body: parseComponentBody(V1), hash: hashOf(V1) });
    expect(v!.body.elements[0]).toMatchObject({ flow: "once", style: expect.any(Object) });   // 기본값이 채워져 저장된다
  });

  it("fills props and elements defaults for a minimal body", async () => {
    const minimal = { name: "빈 상자", w: 10, h: 5 } as ComponentBody;
    const { hash } = await store.create("empty-box", minimal);
    const detail = await store.get("empty-box");
    expect(detail!.latest).toEqual({ name: "빈 상자", w: 10, h: 5, props: [], elements: [] });
    expect(hash).toBe(componentHash(detail!.latest));
  });

  it("rejects a duplicate id with ConflictError and keeps the first body", async () => {
    await store.create("company-header", V1);
    await expect(store.create("company-header", V2)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.get("company-header"))!.summary).toMatchObject({ name: "머리글", latestVersion: 1, h: 24 });
  });

  it("rejects an invalid id or an invalid body without storing anything", async () => {
    await expect(store.create("Bad_Id", V1)).rejects.toThrow(/component id/);
    await expect(store.create("-lead", V1)).rejects.toThrow(/component id/);
    const nested = { ...V1, elements: [{ id: "r", type: "ref", ref: "other", version: 1, x: 0, y: 0, w: 1, h: 1 }] } as ComponentBody;
    await expect(store.create("nested", nested)).rejects.toThrow();
    await expect(store.create("zero-width", { ...V1, w: 0 })).rejects.toThrow();
    const dupProps = { ...V1, props: [V1.props[0], V1.props[0]] } as ComponentBody;
    await expect(store.create("dup-props", dupProps)).rejects.toThrow();
    for (const id of ["Bad_Id", "-lead", "nested", "zero-width", "dup-props"]) expect(await store.get(id)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("save with changed content creates the next version and updates the summary; old versions stay readable", async () => {
    await store.create("company-header", V1);
    const res = await store.save("company-header", V2);
    expect(res).toEqual({ version: 2, hash: hashOf(V2), created: true });
    expect(res.hash).not.toBe(hashOf(V1));
    const detail = (await store.get("company-header"))!;
    expect(detail.summary).toMatchObject({ id: "company-header", name: "머리글 넓게", latestVersion: 2, w: 180, h: 30 });
    expect(detail.versions.map((v) => [v.version, v.hash])).toEqual([[1, hashOf(V1)], [2, hashOf(V2)]]);
    expect(detail.latest).toEqual(parseComponentBody(V2));
    expect((await store.getVersion("company-header", 1))!.body).toEqual(parseComponentBody(V1));
    expect((await store.getVersion("company-header", 2))!.hash).toBe(hashOf(V2));
  });

  it("save with the same content as the latest returns created:false and keeps the version, even with reordered keys or filled defaults", async () => {
    await store.create("company-header", V1);
    const reordered = { elements: V1.elements, props: V1.props, h: 24, w: 180, name: "머리글" } as ComponentBody;
    expect(await store.save("company-header", reordered)).toEqual({ version: 1, hash: hashOf(V1), created: false });
    expect(await store.save("company-header", parseComponentBody(V1))).toEqual({ version: 1, hash: hashOf(V1), created: false });
    const detail = (await store.get("company-header"))!;
    expect(detail.versions).toHaveLength(1);
    expect(detail.summary.latestVersion).toBe(1);
  });

  it("compares only with the latest version: saving v1's content again after v2 creates v3", async () => {
    await store.create("company-header", V1);
    await store.save("company-header", V2);
    expect(await store.save("company-header", V1)).toEqual({ version: 3, hash: hashOf(V1), created: true });
    expect((await store.get("company-header"))!.versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("save throws NotFoundError for an unknown id and rejects an invalid body without adding a version", async () => {
    await expect(store.save("nope", V1)).rejects.toBeInstanceOf(NotFoundError);
    await store.create("company-header", V1);
    await expect(store.save("company-header", { ...V1, h: -1 })).rejects.toThrow();
    expect((await store.get("company-header"))!.versions).toHaveLength(1);
  });

  it("getVersion and get return null for unknown ids or versions", async () => {
    await store.create("company-header", V1);
    expect(await store.getVersion("company-header", 2)).toBeNull();
    expect(await store.getVersion("company-header", 0)).toBeNull();
    expect(await store.getVersion("nope", 1)).toBeNull();
    expect(await store.get("nope")).toBeNull();
  });

  it("list returns summaries in creation order with the latest size", async () => {
    await store.create("company-header", V1);
    await store.create("sign-box", { name: "서명란", w: 60, h: 20 } as ComponentBody);
    await store.save("company-header", V2);
    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(["company-header", "sign-box"]);
    expect(list[0]).toMatchObject({ name: "머리글 넓게", latestVersion: 2, w: 180, h: 30 });
    expect(list[1]).toMatchObject({ name: "서명란", latestVersion: 1, w: 60, h: 20 });
    expect(typeof list[0].updatedAt).toBe("string");
  });

  it("delete removes the component and all of its versions; unknown ids throw NotFoundError", async () => {
    await store.create("company-header", V1);
    await store.save("company-header", V2);
    await store.delete("company-header");
    expect(await store.get("company-header")).toBeNull();
    expect(await store.getVersion("company-header", 1)).toBeNull();
    expect(await store.getVersion("company-header", 2)).toBeNull();
    expect(await store.list()).toEqual([]);
    await expect(store.delete("company-header")).rejects.toBeInstanceOf(NotFoundError);
    // 지운 뒤 같은 id로 다시 만들면 버전 1부터 시작한다
    expect((await store.create("company-header", V2)).version).toBe(1);
  });

  it("returns copies so callers cannot mutate stored (immutable) versions", async () => {
    await store.create("company-header", V1);
    const v = (await store.getVersion("company-header", 1))!;
    v.body.name = "바뀜";
    v.body.elements.length = 0;
    const d = (await store.get("company-header"))!;
    d.latest.w = 1;
    d.summary.name = "바뀜";
    const again = (await store.get("company-header"))!;
    expect(again.latest).toEqual(parseComponentBody(V1));
    expect(again.summary.name).toBe("머리글");
    expect(await store.save("company-header", V1)).toMatchObject({ created: false });
  });

  it("tracks createdAt per version and updatedAt only when a version is created", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = "2026-09-17T00:00:00.000Z", t1 = "2026-09-17T00:00:01.000Z", t2 = "2026-09-17T00:00:02.000Z";
    vi.setSystemTime(new Date(t0));
    await store.create("company-header", V1);
    vi.setSystemTime(new Date(t1));
    await store.save("company-header", V1);                        // 변경 없음
    expect((await store.get("company-header"))!.summary.updatedAt).toBe(t0);
    vi.setSystemTime(new Date(t2));
    await store.save("company-header", V2);
    const d = (await store.get("company-header"))!;
    expect(d.summary.updatedAt).toBe(t2);
    expect(d.versions.map((v) => v.createdAt)).toEqual([t0, t2]);
  });
});

describe("getComponentStore", () => {
  it("uses the memory store without DATABASE_URL and shares one instance across module reloads (Next bundles apart)", async () => {
    delete process.env.DATABASE_URL;
    delete (globalThis as any).__daportComponentStore;
    vi.resetModules();
    const modA = await import("../component-store");
    const a = modA.getComponentStore();
    expect(a).toBeInstanceOf(modA.MemoryComponentStore);
    vi.resetModules();
    const b = (await import("../component-store")).getComponentStore();
    expect(b).toBe(a);
    delete (globalThis as any).__daportComponentStore;
  });
});
