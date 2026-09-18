// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseReport } from "@daport/core";

vi.stubEnv("DAPORT_DEV_API_KEY", "e2e-dev-key");
(globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = undefined;   // 환경변수가 반영된 저장소를 새로 만들게 한다
const renderPdf = vi.fn();
vi.mock("@daport/pdf", () => ({ renderPdf }));
const { POST, OPTIONS } = await import("../[id]/render/route");
const { getStore, ready } = await import("@/lib/report-store");
const { MemoryApiKeyStore } = await import("@/lib/api-key-store");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (id: string, body: unknown, headers: Record<string, string> = { "x-api-key": "e2e-dev-key" }) =>
  POST(new Request(`http://studio.local/api/reports/${id}/render`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), ctx(id));

let id: string;
beforeEach(async () => {
  renderPdf.mockReset().mockResolvedValue(Buffer.from("%PDF-"));
  await ready();
  id = `rnd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await getStore().create({ id, name: "R", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "published" }] });
});

describe("POST /api/reports/:id/render", () => {
  it("401 without a key, 404 NOT_PUBLISHED before the first publish, then renders the published version", async () => {
    expect((await call(id, { format: "pdf" }, {})).status).toBe(401);
    expect((await call(id, { format: "pdf" }, { "x-api-key": "wrong" })).status).toBe(401);
    const np = await call(id, { format: "pdf" });
    expect(np.status).toBe(404);
    expect((await np.json()).code).toBe("NOT_PUBLISHED");
    await getStore().publish(id, (await getStore().get(id))!);
    const res = await call(id, { format: "pdf", params: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-daport-version")).toBe("1");
    expect(res.headers.get("content-disposition")).toContain(`filename="${id}.pdf"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("never renders the draft: edits after publish are invisible until republished; version pins an old version", async () => {
    await getStore().publish(id, (await getStore().get(id))!);
    const draft = (await getStore().get(id))!;
    await getStore().update(id, { ...draft, elements: [{ ...draft.elements[0], value: "DRAFT-ONLY" }] });
    const html = await call(id, { format: "html" });
    expect(html.status).toBe(200);
    const text = await html.text();
    expect(text).toContain("published");
    expect(text).not.toContain("DRAFT-ONLY");
    await getStore().publish(id, (await getStore().get(id))!);
    expect(await (await call(id, { format: "html" })).text()).toContain("DRAFT-ONLY");
    const pinned = await call(id, { format: "html", version: 1 });
    expect(pinned.headers.get("x-daport-version")).toBe("1");
    expect(await pinned.text()).not.toContain("DRAFT-ONLY");
    expect((await call(id, { format: "html", version: 9 })).status).toBe(404);
    expect((await call(id, { format: "html", version: "1" })).status).toBe(400);
  });
  it("ignores a report field in the body and rejects unknown formats and label formats for a pdf report", async () => {
    await getStore().publish(id, (await getStore().get(id))!);
    const smuggled = { id, version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "SMUGGLED" }] };
    expect(await (await call(id, { format: "html", report: smuggled })).text()).not.toContain("SMUGGLED");
    expect((await call(id, { format: "docx" })).status).toBe(400);
    const mm = await call(id, { format: "zpl" });
    expect(mm.status).toBe(400);
    expect((await mm.json()).code).toBe("FORMAT_MISMATCH");
  });
  it("403 when the key does not allow the report; unknown report is 404 only after auth", async () => {
    const store = new MemoryApiKeyStore();
    const { rawKey } = await store.create("limited", ["other-report"]);
    (globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = store;
    try {
      expect((await call(id, { format: "pdf" }, { "x-api-key": rawKey })).status).toBe(403);
      expect((await call("nope", { format: "pdf" }, { "x-api-key": rawKey })).status).toBe(403);
      expect((await call("nope", { format: "pdf" }, {})).status).toBe(401);
    } finally {
      (globalThis as { __daportApiKeyStore?: unknown }).__daportApiKeyStore = undefined;
    }
  });
  it("OPTIONS answers preflight for a listed origin", async () => {
    vi.stubEnv("DAPORT_CORS_ORIGINS", "https://mes.example.com");
    const res = await OPTIONS(new Request(`http://studio.local/api/reports/${id}/render`, { method: "OPTIONS", headers: { origin: "https://mes.example.com" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://mes.example.com");
    vi.unstubAllEnvs();
    vi.stubEnv("DAPORT_DEV_API_KEY", "e2e-dev-key");
  });
});
