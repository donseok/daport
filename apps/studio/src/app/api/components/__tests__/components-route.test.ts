// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { componentHash, parseComponentBody, type ReportInput } from "@daport/core";
import { GET as listComponents, POST as createComponent } from "../route";
import { GET as getComponent, PUT as saveComponent, DELETE as deleteComponent } from "../[id]/route";
import { GET as getVersion } from "../[id]/versions/[v]/route";
import { GET as getUsage } from "../[id]/usage/route";
import { POST as applyLatest } from "../[id]/apply-latest/route";
import { getStore, ready } from "@/lib/report-store";

const base = "http://localhost/api/components";
const headers = { "content-type": "application/json" };
const json = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => createComponent(new Request(base, { method: "POST", headers, body: json(body) }));
const get = (id: string) => getComponent(new Request(`${base}/${id}`), ctx(id));
const put = (id: string, body: unknown) => saveComponent(new Request(`${base}/${id}`, { method: "PUT", headers, body: json(body) }), ctx(id));
const del = (id: string) => deleteComponent(new Request(`${base}/${id}`, { method: "DELETE" }), ctx(id));
const version = (id: string, v: string) => getVersion(new Request(`${base}/${id}/versions/${v}`), { params: Promise.resolve({ id, v }) });
const usage = (id: string) => getUsage(new Request(`${base}/${id}/usage`), ctx(id));
const apply = (id: string) => applyLatest(new Request(`${base}/${id}/apply-latest`, { method: "POST" }), ctx(id));

const text = (id: string, value: string) => ({ id, type: "text", x: 0, y: 0, w: 180, h: 10, value });
const V1 = { name: "머리글", w: 180, h: 24, props: [{ name: "title", type: "string", default: "제목" }], elements: [text("t", "{{ props.title }}")] };
const V2 = {
  ...V1, h: 30,
  elements: [text("t", "{{ props.title }}"), { id: "tbl", type: "table", x: 0, y: 10, w: 180, h: 20, source: "items", columns: [{ header: "품목", value: "{{ row.NAME }}", w: 180 }] }],
};
const hash = (b: unknown) => componentHash(parseComponentBody(b));
const page = { width: 210, height: 297 };
const refTo = (id: string, v: 1 | 2) => ({ id, type: "ref", ref: "hdr", version: v, x: 10, y: 10, w: 180, h: v === 1 ? 24 : 30 });
const reportUsingV1 = (id: string, elements: unknown[] = [refTo("h", 1)]) =>
  ({ id, name: id, version: 1, page, elements, components: { "hdr@1": parseComponentBody(V1) } }) as ReportInput;

beforeEach(() => {
  delete process.env.DATABASE_URL;   // 메모리 저장소
  delete (globalThis as any).__daportReportStore;
  delete (globalThis as any).__daportSeeded;
  delete (globalThis as any).__daportComponentStore;
});

describe("GET/POST /api/components", () => {
  it("POST creates version 1 with 201 and the summary is listed", async () => {
    expect(await (await listComponents()).json()).toEqual([]);
    const res = await post({ id: "hdr", body: V1 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ version: 1, hash: hash(V1) });
    const list = await (await listComponents()).json();
    expect(list).toEqual([{ id: "hdr", name: "머리글", latestVersion: 1, w: 180, h: 24, updatedAt: expect.any(String) }]);
  });

  it("POST returns 409 for a duplicate id and 400 for invalid ids, bodies and JSON", async () => {
    await post({ id: "hdr", body: V1 });
    const dup = await post({ id: "hdr", body: V2 });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toContain("hdr");
    const nested = { ...V1, elements: [{ id: "r", type: "ref", ref: "other", version: 1, x: 0, y: 0, w: 1, h: 1 }] };
    for (const bad of [
      { id: "Bad", body: V1 }, { body: V1 }, { id: 5, body: V1 }, { id: "no-body" },
      { id: "nested", body: nested }, { id: "neg", body: { ...V1, h: -1 } }, "not json", "5",
    ]) {
      const res = await post(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(await (await listComponents()).json()).toHaveLength(1);
  });

  it("POST returns 413 for a body over the readJsonBody limit", async () => {
    const big = `{"id":"big","pad":"${"x".repeat(21 * 1024 * 1024)}"}`;
    expect((await post(big)).status).toBe(413);
  });
});

describe("GET/PUT /api/components/:id and versions", () => {
  it("GET returns the summary, version list and latest body; 404 for an unknown id", async () => {
    await post({ id: "hdr", body: V1 });
    const res = await get("hdr");
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.summary).toMatchObject({ id: "hdr", name: "머리글", latestVersion: 1, w: 180, h: 24 });
    expect(detail.versions).toEqual([{ version: 1, hash: hash(V1), createdAt: expect.any(String) }]);
    expect(detail.latest).toEqual(parseComponentBody(V1));
    expect((await get("nope")).status).toBe(404);
  });

  it("PUT returns created:false for unchanged content and the next version for changed content", async () => {
    await post({ id: "hdr", body: V1 });
    const same = await put("hdr", { body: V1 });
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ version: 1, hash: hash(V1), created: false });
    const changed = await put("hdr", { body: V2 });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ version: 2, hash: hash(V2), created: true });
    const detail = await (await get("hdr")).json();
    expect(detail.summary).toMatchObject({ latestVersion: 2, h: 30 });
    expect(detail.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  });

  it("PUT returns 404 for an unknown id and 400 for an invalid or missing body", async () => {
    expect((await put("nope", { body: V1 })).status).toBe(404);
    await post({ id: "hdr", body: V1 });
    expect((await put("hdr", { body: { ...V1, w: 0 } })).status).toBe(400);
    expect((await put("hdr", {})).status).toBe(400);
    expect((await put("hdr", "not json")).status).toBe(400);
    expect((await (await get("hdr")).json()).versions).toHaveLength(1);
  });

  it("GET versions/:v returns the immutable body and hash of that version; 404 otherwise", async () => {
    await post({ id: "hdr", body: V1 });
    await put("hdr", { body: V2 });
    const v1 = await version("hdr", "1");
    expect(v1.status).toBe(200);
    expect(await v1.json()).toEqual({ body: parseComponentBody(V1), hash: hash(V1) });
    expect(await (await version("hdr", "2")).json()).toEqual({ body: parseComponentBody(V2), hash: hash(V2) });
    for (const v of ["3", "0", "-1", "abc", "1.5", "01"]) expect((await version("hdr", v)).status, v).toBe(404);
    expect((await version("nope", "1")).status).toBe(404);
  });
});

describe("usage, apply-latest and DELETE", () => {
  it("GET usage lists stored reports that reference the component; 404 for an unknown component", async () => {
    await post({ id: "hdr", body: V1 });
    await post({ id: "unused", body: V1 });
    await ready();
    await getStore().create(reportUsingV1("r-hdr"));
    const res = await usage("hdr");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ reportId: "r-hdr", versions: [1] }]);
    expect(await (await usage("unused")).json()).toEqual([]);
    expect((await usage("nope")).status).toBe(404);
  });

  it("POST apply-latest upgrades using reports, reports skipped ones, and returns 404 for an unknown component", async () => {
    await post({ id: "hdr", body: V1 });
    await ready();
    const store = getStore();
    await store.create(reportUsingV1("r-hdr"));
    // v2는 넘기는 표를 담으므로 반복 영역 템플릿 안 인스턴스는 검증에 실패해 건너뛴다
    await store.create(reportUsingV1("r-template", [{
      id: "cards", type: "repeater", x: 10, y: 10, w: 180, h: 200, source: "{{ items }}",
      item: { w: 180, h: 24, children: [{ ...refTo("h", 1), x: 0, y: 0 }] },
    }]));
    await put("hdr", { body: V2 });

    const res = await apply("hdr");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toEqual(["r-hdr"]);
    expect(body.skipped).toEqual([{ reportId: "r-template", error: expect.any(String) }]);
    const upgraded = (await store.get("r-hdr"))!;
    expect(upgraded.elements[0]).toMatchObject({ ref: "hdr", version: 2, w: 180, h: 30 });
    expect(Object.keys(upgraded.components)).toEqual(["hdr@2"]);
    expect(Object.keys((await store.get("r-template"))!.components)).toEqual(["hdr@1"]);
    expect(await (await usage("hdr")).json()).toEqual([{ reportId: "r-hdr", versions: [2] }, { reportId: "r-template", versions: [1] }]);

    expect((await apply("nope")).status).toBe(404);
  });

  it("DELETE returns 409 with report ids while used, 204 once unused, and 404 for an unknown id", async () => {
    await post({ id: "hdr", body: V1 });
    await ready();
    await getStore().create(reportUsingV1("r-hdr"));
    await getStore().create(reportUsingV1("r-hdr-2"));
    const used = await del("hdr");
    expect(used.status).toBe(409);
    const usedBody = await used.json();
    expect(usedBody.reports).toEqual(["r-hdr", "r-hdr-2"]);
    expect(typeof usedBody.error).toBe("string");
    expect((await get("hdr")).status).toBe(200);   // 지워지지 않았다

    await post({ id: "free", body: V1 });
    const ok = await del("free");
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    expect((await get("free")).status).toBe(404);
    expect((await version("free", "1")).status).toBe(404);
    expect((await del("free")).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
  });
});
