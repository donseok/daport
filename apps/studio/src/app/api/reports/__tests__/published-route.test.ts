// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.stubEnv("DAPORT_DEV_API_KEY", "e2e-dev-key");
(globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = undefined;
const { GET } = await import("../[id]/published/route");
const { getStore, ready } = await import("@/lib/report-store");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, q = "", key: string | null = "e2e-dev-key") =>
  GET(new Request(`http://studio.local/api/reports/${id}/published${q}`, { headers: key ? { "x-api-key": key } : {} }), ctx(id));

describe("GET /api/reports/:id/published", () => {
  it("returns the published model with absolute asset urls and the version header", async () => {
    await ready();
    const id = `pubget-${Date.now()}`;
    const model = { id, version: 1, page: { width: 100, height: 100 }, elements: [{ id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, src: "asset://logo1" }] };
    await getStore().create(model);
    expect((await get(id)).status).toBe(404);
    expect((await (await get(id)).json()).code).toBe("NOT_PUBLISHED");
    await getStore().publish(id, (await getStore().get(id))!);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-daport-version")).toBe("1");
    const body = await res.json();
    expect(body.elements[0].src).toBe("http://studio.local/api/assets/logo1");
    expect((await get(id, "?version=1")).status).toBe(200);
    expect((await get(id, "?version=2")).status).toBe(404);
    expect((await get(id, "?version=x")).status).toBe(400);
    expect((await get(id, "", null)).status).toBe(401);
  });
});
