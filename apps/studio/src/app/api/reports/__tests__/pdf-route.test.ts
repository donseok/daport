// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExpressionError } from "@daport/core";

const renderPdf = vi.fn();
vi.mock("@daport/pdf", () => ({ renderPdf }));
const { POST } = await import("../[id]/pdf/route");

const report = { id: "qc", name: "품질(보증)서", version: 1, page: { width: 100, height: 100 }, params: [{ name: "lot", type: "string", required: true }] };
const call = (body: unknown) => POST(new Request("http://localhost/api/reports/qc/pdf", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "qc" }) });

beforeEach(() => { renderPdf.mockReset(); });

describe("POST /api/reports/[id]/pdf", () => {
  it("returns the PDF with an ASCII filename and the Korean name in filename*", async () => {
    renderPdf.mockResolvedValue(Buffer.from("%PDF-"));
    const res = await call({ report, params: { lot: "L1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="qc.pdf"; filename*=UTF-8''${encodeURIComponent("품질")}%28${encodeURIComponent("보증")}%29${encodeURIComponent("서")}.pdf`);
  });

  it("returns 400 for an invalid model, a missing required param and an expression error", async () => {
    expect((await call({ report: { ...report, page: {} }, params: { lot: "L1" } })).status).toBe(400);
    expect((await call({ report, params: {} })).status).toBe(400);
    expect(renderPdf).not.toHaveBeenCalled();
    renderPdf.mockRejectedValue(new ExpressionError("a.", new Error("syntax")));
    expect((await call({ report, params: { lot: "L1" } })).status).toBe(400);
  });

  it("treats a JSON null body like an empty body and rejects a non-object body with 400, never 500", async () => {
    const res = await call(null);
    expect(res.status).toBe(404);                 // 본문 모델이 없으면 저장된 레포트를 찾는다 (qc는 없다)
    expect((await call(5)).status).toBe(400);
    expect((await call("report")).status).toBe(400);
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it("returns 500 when rendering fails for another reason such as a Chromium crash", async () => {
    renderPdf.mockRejectedValue(new Error("Target page, context or browser has been closed"));
    const res = await call({ report, params: { lot: "L1" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("closed");
  });

  it("passes request data to the renderer and returns 400 with datasetErrors when a dataset fails", async () => {
    renderPdf.mockResolvedValue(Buffer.from("%PDF-"));
    const withDs = { ...report, datasets: [{ name: "h", type: "http", url: "https://nope.example.com/x" }] };
    expect((await call({ report: withDs, params: { lot: "L1" }, data: { h: [{ A: 1 }] } })).status).toBe(200);
    expect((renderPdf.mock.calls[0][1] as { h: { A: number } }).h.A).toBe(1);
    const bad = await call({ report: withDs, params: { lot: "L1" } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).datasetErrors).toHaveLength(1);
  });

  it("maps LayoutLimitError to 400 LAYOUT_LIMIT", async () => {
    const { LayoutLimitError } = await import("@daport/renderer");
    renderPdf.mockRejectedValue(new LayoutLimitError(2001));
    const res = await call({ report, params: { lot: "L1" } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("LAYOUT_LIMIT");
  });
});

describe("POST /api/reports/[id]/pdf props field", () => {
  it("passes body props to the renderer context next to params, and omits props when the field is missing or not an object", async () => {
    renderPdf.mockResolvedValue(Buffer.from("%PDF-"));
    expect((await call({ report, params: { lot: "L1" }, props: { title: "T", n: 2 } })).status).toBe(200);
    const ctx = renderPdf.mock.calls[0][1] as Record<string, unknown>;
    expect(ctx.props).toEqual({ title: "T", n: 2 });
    expect((ctx.params as { lot: string }).lot).toBe("L1");
    await call({ report, params: { lot: "L1" } });
    expect(Object.hasOwn(renderPdf.mock.calls[1][1] as object, "props")).toBe(false);
    await call({ report, params: { lot: "L1" }, props: ["T"] });
    expect(Object.hasOwn(renderPdf.mock.calls[2][1] as object, "props")).toBe(false);
  });
});
