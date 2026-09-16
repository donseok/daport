// @vitest-environment node
import { describe, it, expect } from "vitest";
import { POST } from "../[id]/preview/route";

const call = (body: unknown) => POST(new Request("http://localhost/api/reports/qc/preview", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "qc" }) });

describe("POST /api/reports/[id]/preview", () => {
  it("treats a JSON null body like an empty body and rejects a non-object body with a clean 400", async () => {
    const res = await call(null);
    expect(res.status).toBe(404);
    const bad = await call(5);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).not.toMatch(/Cannot read properties/);
  });

  it("renders the model in the body", async () => {
    const res = await call({ report: { id: "qc", version: 1, page: { width: 60, height: 40 } }, params: {} });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('class="dp-page"');
  });
});
