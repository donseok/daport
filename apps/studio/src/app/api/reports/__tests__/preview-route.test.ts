// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { parseReport } from "@daport/core";
import { POST } from "../[id]/preview/route";

const call = (body: unknown, id = "qc") => POST(new Request(`http://localhost/api/reports/${id}/preview`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

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

  it("uses request data instead of running datasets, and reports dataset errors as 400 with datasetErrors", async () => {
    const report = { id: "qc", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "h", type: "http", url: "https://nope.example.com/x" }],
      elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "{{ h.NAME }}" }] };
    const ok = await call({ report, params: {}, data: { h: [{ NAME: "from-data" }] } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("from-data");
    const bad = await call({ report, params: {} });
    expect(bad.status).toBe(400);
    expect((await bad.json()).datasetErrors[0]).toMatchObject({ dataset: "h", code: "HOST_NOT_ALLOWED" });
  });

  it("returns 400 LAYOUT_LIMIT above the page limit and 413 for an oversized body", async () => {
    const report = { id: "qc", version: 1, page: { width: 100, height: 100 }, repeat: { source: "ships" } };
    const limit = await call({ report, params: {}, data: { ships: Array.from({ length: 2001 }, () => ({})) } });
    expect(limit.status).toBe(400);
    expect((await limit.json()).code).toBe("LAYOUT_LIMIT");
    // 실제 21MB 본문으로 읽은 바이트 검사를 지난다 (content-length 선검사는 body.test.ts가 본다)
    const big = await POST(new Request("http://localhost/api/reports/qc/preview", { method: "POST", headers: { "content-type": "application/json" }, body: `{"pad":"${"x".repeat(21 * 1024 * 1024)}"}` }), { params: Promise.resolve({ id: "qc" }) });
    expect(big.status).toBe(413);
  });
});

describe("POST /api/reports/[id]/preview props field", () => {
  const report = { id: "qc", version: 1, page: { width: 100, height: 40 },
    elements: [{ id: "t", type: "text", x: 0, y: 0, w: 90, h: 8, value: "제목={{ props.title }} 수량={{ props.qty + 1 }}" }] };

  it("puts the body props object into the layout context as props", async () => {
    const res = await call({ report, params: {}, props: { title: "샘플 제목", qty: 2 } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("제목=샘플 제목 수량=3");
  });

  it("does not accept props through data, because props is a reserved context name", async () => {
    const res = await call({ report, params: {}, data: { props: [{ title: "x" }] } });
    expect(res.status).toBe(400);
    expect((await res.json()).datasetErrors).toEqual([expect.objectContaining({ dataset: "props", code: "BAD_DATA" })]);
  });
});

describe("POST /api/reports/:id/preview version", () => {
  it("renders the given published version instead of the draft, 404 for a missing version", async () => {
    const { getStore, ready } = await import("@/lib/report-store");
    await ready();
    const id = `pv-${Date.now()}`;
    const base = { id, name: "V1", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "first" }] };
    await getStore().create(base);
    await getStore().publish(id, parseReport(base));
    await getStore().update(id, { ...base, elements: [{ ...base.elements[0], value: "second" }] });
    const v1 = await call({ version: 1 }, id);
    expect(v1.status).toBe(200);
    expect(await v1.text()).toContain("first");
    const draft = await call({}, id);
    expect(await draft.text()).toContain("second");
    expect((await call({ version: 9 }, id)).status).toBe(404);
    expect((await call({ version: "1" }, id)).status).toBe(400);
  });
});
