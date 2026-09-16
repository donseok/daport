// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
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

  it("renders the seeded quality certificate by id with no body report on a fresh module instance", async () => {
    // 서버 부팅 직후처럼 저장소와 시드가 아직 없는 새 모듈 인스턴스에서 첫 요청이 저장된 품질보증서를 찾아야 한다
    vi.resetModules();
    const holder = globalThis as { __daportReportStore?: unknown; __daportSeeded?: unknown };
    delete holder.__daportReportStore;
    delete holder.__daportSeeded;
    delete process.env.DATABASE_URL;
    const { POST: fresh } = await import("../[id]/preview/route");
    const res = await fresh(new Request("http://localhost/api/reports/quality-cert/preview", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { lotNo: "L2609-0142" } }) }),
      { params: Promise.resolve({ id: "quality-cert" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("L2609-0142");
  });
});
