// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getStore, ready } from "@/lib/report-store";
import { POST as publish } from "../[id]/publish/route";
import { GET as versions } from "../[id]/versions/route";
import { PUT as setPublished } from "../[id]/published/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body?: unknown) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("publish / versions / published", () => {
  it("publishes the draft as v1, lists it, republishes as v2, and moves the pointer back", async () => {
    await ready();
    const id = `pub-${Date.now()}`;
    const base = { id, name: "P", version: 1, page: { width: 100, height: 100 } };
    await getStore().create(base);
    const r1 = await publish(json(`/api/reports/${id}/publish`, "POST", { note: "첫 배포" }), ctx(id));
    expect(r1.status).toBe(201);
    expect(await r1.json()).toMatchObject({ version: 1 });
    await getStore().update(id, { ...base, name: "P2" });
    const r2 = await publish(json(`/api/reports/${id}/publish`, "POST", {}), ctx(id));
    expect((await r2.json()).version).toBe(2);
    const list = await (await versions(json(`/api/reports/${id}/versions`, "GET"), ctx(id))).json();
    expect(list.versions.map((v: { version: number; published: boolean; note: string | null }) => [v.version, v.published, v.note])).toEqual([[1, false, "첫 배포"], [2, true, null]]);
    expect(list.publishedVersion).toBe(2);
    expect(typeof list.draftHash).toBe("string");
    const back = await setPublished(json(`/api/reports/${id}/published`, "PUT", { version: 1 }), ctx(id));
    expect(back.status).toBe(200);
    expect(await back.json()).toEqual({ publishedVersion: 1 });
    expect((await getStore().getPublished(id))?.report.name).toBe("P");
    expect((await getStore().get(id))?.name).toBe("P2");
  });
  it("404 for an unknown report or version, 400 for a non-integer version", async () => {
    await ready();
    expect((await publish(json("/api/reports/nope/publish", "POST", {}), ctx("nope"))).status).toBe(404);
    expect((await versions(json("/api/reports/nope/versions", "GET"), ctx("nope"))).status).toBe(404);
    const id = `pub2-${Date.now()}`;
    await getStore().create({ id, version: 1, page: { width: 10, height: 10 } });
    expect((await setPublished(json(`/api/reports/${id}/published`, "PUT", { version: 5 }), ctx(id))).status).toBe(404);
    expect((await setPublished(json(`/api/reports/${id}/published`, "PUT", { version: "1" }), ctx(id))).status).toBe(400);
  });
  it("publish runs the component guard: a mismatching component body is a 409", async () => {
    await ready();
    const { getComponentStore } = await import("@/lib/component-store");
    const body = { name: "C", w: 20, h: 10, props: [], elements: [{ id: "t", type: "text", x: 0, y: 0, w: 20, h: 10, value: "c" }] };
    const cid = `pubc${Date.now() % 100000}`;
    await getComponentStore().create(cid, body as never);
    const id = `pub3-${Date.now()}`;
    const tampered = { ...body, elements: [{ ...body.elements[0], value: "changed" }] };
    await getStore().create({ id, version: 1, page: { width: 100, height: 100 }, components: { [`${cid}@1`]: tampered },
      elements: [{ id: "r", type: "ref", x: 0, y: 0, w: 20, h: 10, ref: cid, version: 1, props: {} }] });
    const res = await publish(json(`/api/reports/${id}/publish`, "POST", {}), ctx(id));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("COMPONENT_MISMATCH");
    expect(await getStore().getPublished(id)).toBeNull();
  });
});
