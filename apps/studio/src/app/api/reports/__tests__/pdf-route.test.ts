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

  it("returns 500 when rendering fails for another reason such as a Chromium crash", async () => {
    renderPdf.mockRejectedValue(new Error("Target page, context or browser has been closed"));
    const res = await call({ report, params: { lot: "L1" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("closed");
  });
});
