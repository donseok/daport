import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseComponentBody, type ComponentBody, type ReportInput } from "@daport/core";
import { getStore, ready, NotFoundError, MemoryReportStore } from "../report-store";
import { getComponentStore } from "../component-store";
import { findUsage, applyLatestToReports } from "../component-usage";

const text = (id: string, value: string) => ({ id, type: "text", x: 0, y: 0, w: 180, h: 10, value });
const titleProp = { name: "title", type: "string", default: "제목" };
const V1 = parseComponentBody({ name: "머리글", w: 180, h: 24, props: [titleProp], elements: [text("t", "{{ props.title }}")] });
// v2는 크기가 바뀌고 입력값 sub가 늘며, 페이지를 넘기는 표(overflow 기본값 continue)를 담는다 → 반복 영역 템플릿 안에서는 쓸 수 없다
const V2 = parseComponentBody({
  name: "머리글", w: 180, h: 30,
  props: [titleProp, { name: "sub", type: "string", default: "" }],
  elements: [text("t", "{{ props.title }}"), { id: "tbl", type: "table", x: 0, y: 10, w: 180, h: 20, source: "items", columns: [{ header: "품목", value: "{{ row.NAME }}", w: 180 }] }],
});
const SIGN = parseComponentBody({ name: "서명란", w: 60, h: 20, elements: [{ id: "box", type: "rect", x: 0, y: 0, w: 60, h: 20 }] });

const page = { width: 210, height: 297 };
const ref = (id: string, version: 1 | 2, props: Record<string, string | number | boolean> = {}) =>
  ({ id, type: "ref", ref: "hdr", version, x: 10, y: 10, w: 180, h: version === 1 ? 24 : 30, props });
const report = (id: string, elements: unknown[], components: Record<string, ComponentBody>) =>
  ({ id, name: id, version: 1, page, elements, components }) as ReportInput;

async function setup() {
  await ready();
  const lib = getComponentStore();
  await lib.create("hdr", V1);
  await lib.save("hdr", V2);
  await lib.create("sign", SIGN);
  const store = getStore();
  await store.create(report("uses-v1", [ref("h1", 1, { title: "A", legacy: "x" })], { "hdr@1": V1 }));
  await store.create(report("mixed", [
    ref("h1", 1),
    { id: "g", type: "group", x: 0, y: 50, w: 190, h: 40, children: [ref("h2", 2, { sub: "B" })] },
  ], { "hdr@1": V1, "hdr@2": V2 }));
  await store.create(report("on-latest", [ref("h1", 2)], { "hdr@2": V2 }));
  await store.create(report("in-template", [{
    id: "cards", type: "repeater", x: 10, y: 10, w: 180, h: 200, source: "{{ items }}",
    item: { w: 180, h: 24, children: [{ ...ref("h1", 1), x: 0, y: 0 }] },
  }], { "hdr@1": V1 }));
  await store.create(report("other", [{ id: "s", type: "ref", ref: "sign", version: 1, x: 0, y: 0, w: 60, h: 20 }], { "sign@1": SIGN }));
  return { lib, store };
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete (globalThis as any).__daportReportStore;
  delete (globalThis as any).__daportSeeded;
  delete (globalThis as any).__daportComponentStore;
  vi.restoreAllMocks();
});

describe("findUsage", () => {
  it("scans every stored report, including refs in groups and repeater templates, with distinct sorted versions", async () => {
    await setup();
    expect(await findUsage("hdr")).toEqual([
      { reportId: "uses-v1", versions: [1] },
      { reportId: "mixed", versions: [1, 2] },
      { reportId: "on-latest", versions: [2] },
      { reportId: "in-template", versions: [1] },
    ]);
    expect(await findUsage("sign")).toEqual([{ reportId: "other", versions: [1] }]);
    expect(await findUsage("unused")).toEqual([]);
  });
});

describe("applyLatestToReports", () => {
  it("upgrades refs to the latest version, updates size, drops undeclared props and old entries; skips reports that fail validation", async () => {
    const { store } = await setup();
    const before = { onLatest: await store.get("on-latest"), inTemplate: await store.get("in-template"), other: await store.get("other") };
    const res = await applyLatestToReports("hdr");
    expect(res.updated).toEqual(["uses-v1", "mixed"]);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0].reportId).toBe("in-template");
    expect(res.skipped[0].error).toEqual(expect.any(String));
    expect(res.skipped[0].error.length).toBeGreaterThan(0);

    const usesV1 = (await store.get("uses-v1"))!;
    expect(usesV1.elements[0]).toMatchObject({ type: "ref", ref: "hdr", version: 2, w: 180, h: 30, props: { title: "A" } });
    expect((usesV1.elements[0] as { props: Record<string, unknown> }).props).not.toHaveProperty("legacy");
    expect(Object.keys(usesV1.components)).toEqual(["hdr@2"]);
    expect(usesV1.components["hdr@2"]).toEqual(V2);

    const mixed = (await store.get("mixed"))!;
    expect(mixed.elements[0]).toMatchObject({ version: 2, h: 30 });
    expect((mixed.elements[1] as { children: unknown[] }).children[0]).toMatchObject({ version: 2, h: 30, props: { sub: "B" } });
    expect(Object.keys(mixed.components)).toEqual(["hdr@2"]);

    // 이미 최신인 레포트, 건너뛴 레포트, 다른 컴포넌트만 쓰는 레포트는 그대로다
    expect(await store.get("on-latest")).toEqual(before.onLatest);
    expect(await store.get("in-template")).toEqual(before.inTemplate);
    expect(await store.get("other")).toEqual(before.other);
  });

  it("is idempotent: a second run updates nothing and skips the same invalid report", async () => {
    await setup();
    await applyLatestToReports("hdr");
    const again = await applyLatestToReports("hdr");
    expect(again.updated).toEqual([]);
    expect(again.skipped.map((s) => s.reportId)).toEqual(["in-template"]);
  });

  it("records a store failure for one report as skipped and still applies the rest", async () => {
    await setup();
    vi.spyOn(MemoryReportStore.prototype, "update").mockRejectedValueOnce(new Error("boom"));
    const res = await applyLatestToReports("hdr");
    expect(res.skipped).toEqual(expect.arrayContaining([{ reportId: "uses-v1", error: "boom" }]));
    expect(res.updated).toEqual(["mixed"]);
    expect((await getStore().get("uses-v1"))!.components).toHaveProperty("hdr@1");
  });

  it("throws NotFoundError when the component is not in the library", async () => {
    await setup();
    await expect(applyLatestToReports("unused")).rejects.toBeInstanceOf(NotFoundError);
  });
});
