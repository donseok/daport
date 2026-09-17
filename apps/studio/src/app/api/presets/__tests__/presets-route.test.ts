// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { GET, POST } from "../route";
import { DELETE } from "../[id]/route";

const base = "http://localhost/api/presets";
const headers = { "content-type": "application/json" };
const post = (body: unknown) => POST(new Request(base, { method: "POST", headers, body: JSON.stringify(body) }));
const del = (id: string) => DELETE(new Request(`${base}/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeAll(() => { delete process.env.DATABASE_URL; });

describe("presets API (memory store)", () => {
  it("GET lists builtin presets", async () => {
    const list = await (await GET()).json();
    expect(list.map((p: { id: string }) => p.id)).toContain("coil-tag-100x150");
  });
  it("POST creates 201, 409 on conflict, 400 on invalid input", async () => {
    const res = await post({ id: "e2e-tag", name: "E2E", page: { width: 80, height: 50 }, output: { kind: "label", label: { language: "tspl", dpi: 300 } } });
    expect(res.status).toBe(201);
    expect((await res.json()).output.label.threshold).toBe(128);
    expect((await post({ id: "e2e-tag", name: "again", page: { width: 1, height: 1 } })).status).toBe(409);
    expect((await post({ id: "a4-portrait", name: "x", page: { width: 1, height: 1 } })).status).toBe(409);
    expect((await post({ id: "Bad", name: "x", page: { width: 1, height: 1 } })).status).toBe(400);
    expect((await post(5)).status).toBe(400);
    const list = await (await GET()).json();
    expect(list.at(-1).id).toBe("e2e-tag");
  });
  it("DELETE returns 204, 403 for builtin, 404 for unknown", async () => {
    expect((await del("e2e-tag")).status).toBe(204);
    expect((await del("a4-portrait")).status).toBe(403);
    expect((await del("e2e-tag")).status).toBe(404);
  });
});
