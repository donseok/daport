// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { parseComponentBody } from "@daport/core";
import { POST as createReport } from "../route";
import { GET as getReport, PUT as updateReport } from "../[id]/route";
import { getComponentStore } from "@/lib/component-store";

const base = "http://localhost/api/reports";
const headers = { "content-type": "application/json" };
const post = (body: unknown) => createReport(new Request(base, { method: "POST", headers, body: JSON.stringify(body) }));
const put = (id: string, body: unknown) => updateReport(new Request(`${base}/${id}`, { method: "PUT", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const get = async (id: string) => getReport(new Request(`${base}/${id}`), { params: Promise.resolve({ id }) });

const rawBody = { name: "헤더", w: 40, h: 8, props: [],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 8, value: "HEADER" }] };
const changedBody = { ...rawBody, elements: [{ ...rawBody.elements[0], value: "HEADER!" }] };
const ref = (id: string, version: number) => ({ id, type: "ref", ref: "sg-hdr", version, x: 5, y: 5, w: 40, h: 8 });
const report = (id: string, components: Record<string, unknown>, elements: unknown[]) =>
  ({ id, name: id, version: 1, page: { width: 100, height: 100 }, components, elements });

beforeAll(async () => {
  delete process.env.DATABASE_URL;   // 메모리 레포트·컴포넌트 저장소
  await getComponentStore().create("sg-hdr", parseComponentBody(rawBody));   // sg-hdr@1만 라이브러리에 있다
});

describe("POST /api/reports component guard", () => {
  it("saves a matching component, prunes unused entries from the response and the stored report, and sends no warnings header", async () => {
    const res = await post(report("sg-ok", { "sg-hdr@1": rawBody, "sg-hdr@9": changedBody }, [ref("h", 1)]));
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Daport-Warnings")).toBeNull();
    expect(Object.keys((await res.json()).components)).toEqual(["sg-hdr@1"]);
    expect(Object.keys((await (await get("sg-ok")).json()).components)).toEqual(["sg-hdr@1"]);
  });

  it("returns 409 COMPONENT_MISMATCH and does not save when the embedded body differs from the library", async () => {
    const res = await post(report("sg-bad", { "sg-hdr@1": changedBody }, [ref("h", 1)]));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "component sg-hdr@1 differs from the library", code: "COMPONENT_MISMATCH" });
    expect((await get("sg-bad")).status).toBe(404);
  });

  it("saves a version that is not in the library, keeps it in the body and lists it in the warnings header", async () => {
    const res = await post(report("sg-warn", { "sg-hdr@2": changedBody }, [ref("h", 2)]));
    expect(res.status).toBe(201);
    expect(JSON.parse(res.headers.get("X-Daport-Warnings")!)).toEqual(["component sg-hdr@2 is not in the library"]);
    expect(Object.keys((await res.json()).components)).toEqual(["sg-hdr@2"]);
  });

  it("keeps schema errors as 400, not 409, and never reaches the guard for them", async () => {
    const missing = await post(report("sg-schema", {}, [ref("h", 1)]));   // 품은 내용 없는 ref
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBeUndefined();
    const badSize = await post(report("sg-schema", { "sg-hdr@1": changedBody }, [{ ...ref("h", 1), w: 41 }]));   // 크기 불일치가 해시보다 먼저
    expect(badSize.status).toBe(400);
  });
});

describe("PUT /api/reports/:id component guard", () => {
  beforeAll(async () => {
    expect((await post(report("sg-put", {}, []))).status).toBe(201);
  });

  it("returns 409 and leaves the stored report untouched when the embedded body differs", async () => {
    const res = await put("sg-put", report("sg-put", { "sg-hdr@1": changedBody }, [ref("h", 1)]));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("COMPONENT_MISMATCH");
    const stored = await (await get("sg-put")).json();
    expect(stored.elements).toEqual([]);
    expect(stored.components).toEqual({});
  });

  it("saves with a warnings header for a version missing from the library", async () => {
    const res = await put("sg-put", report("sg-put", { "sg-hdr@3": rawBody }, [ref("h", 3)]));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.headers.get("X-Daport-Warnings")!)).toEqual(["component sg-hdr@3 is not in the library"]);
  });

  it("saves a matching component with unused entries pruned and no warnings header, using the URL id", async () => {
    const res = await put("sg-put", { ...report("other-id", { "sg-hdr@1": rawBody, "sg-hdr@3": rawBody }, [ref("h", 1)]) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Daport-Warnings")).toBeNull();
    const body = await res.json();
    expect(body.id).toBe("sg-put");
    expect(Object.keys(body.components)).toEqual(["sg-hdr@1"]);
    expect(Object.keys((await (await get("sg-put")).json()).components)).toEqual(["sg-hdr@1"]);
  });

  it("still returns 404 for a missing id and 400 for a schema error", async () => {
    expect((await put("sg-nope", report("sg-nope", {}, []))).status).toBe(404);
    expect((await put("sg-put", report("sg-put", {}, [ref("h", 1)]))).status).toBe(400);
  });
});
