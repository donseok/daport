// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";

const renderPdf = vi.fn();
vi.mock("@daport/pdf", () => ({ renderPdf }));
const renderLabel = vi.fn(); const rasterizePages = vi.fn();
vi.mock("@daport/label", async (orig) => ({ ...(await orig<typeof import("@daport/label")>()), renderLabel, rasterizePages }));
const { renderReport, renderErrorResponse, renderAllowHosts, parseHostList, RenderRequestError, isRenderFormat, contentDisposition } = await import("../render");

const doc = parseReport({ id: "d", name: "문서", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 10, value: "hi" }] });
const label = parseReport({ id: "lb", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } });
const origin = "http://studio.local:3000";

beforeEach(() => {
  renderPdf.mockReset().mockResolvedValue(Buffer.from("%PDF-"));
  renderLabel.mockReset().mockImplementation(async (r: { output: { label: { language: string } } }) =>
    ({ language: r.output.label.language, dpi: 203, pages: 1, data: Buffer.from("X"), mime: "text/plain", filename: `lb.${r.output.label.language === "zpl" ? "zpl" : "prn"}` }));
  rasterizePages.mockReset().mockResolvedValue([{ width: 8, height: 1, bits: new Uint8Array([0xff]) }]);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("renderReport", () => {
  it("html: renders with fonts under the studio origin", async () => {
    const out = await renderReport(doc, { format: "html", params: {}, origin });
    expect(out.mime).toBe("text/html; charset=utf-8");
    expect(String(out.body)).toContain(`${origin}/fonts/`);
    expect(String(out.body)).toContain("hi");
  });
  it("pdf: passes allowHosts (own origin + DAPORT_RENDER_ALLOW) and returns the pdf", async () => {
    vi.stubEnv("DAPORT_RENDER_ALLOW", "cdn.example.com, img.local:8080");
    const out = await renderReport(doc, { format: "pdf", params: {}, origin });
    expect(out.mime).toBe("application/pdf");
    expect(renderPdf.mock.calls[0][2]).toEqual({ allowHosts: ["studio.local:3000", "cdn.example.com", "img.local:8080"] });
  });
  it("zpl/tspl: override the report language and require a label report", async () => {
    const tspl = await renderReport(label, { format: "tspl", params: {}, origin });
    expect(tspl.filename).toBe("lb.prn");
    expect((renderLabel.mock.calls[0][0] as typeof label).output).toMatchObject({ kind: "label", label: { language: "tspl", dpi: 203 } });
    await expect(renderReport(doc, { format: "zpl", params: {}, origin })).rejects.toMatchObject({ code: "FORMAT_MISMATCH" });
    await expect(renderReport(doc, { format: "png", params: {}, origin })).rejects.toMatchObject({ code: "FORMAT_MISMATCH" });
    expect(renderLabel).toHaveBeenCalledTimes(1);
  });
  it("png: first page bitmap as PNG; aborted signal stops before rasterizing", async () => {
    const out = await renderReport(label, { format: "png", params: {}, origin });
    expect(out.mime).toBe("image/png");
    expect((out.body as Buffer).subarray(1, 4).toString()).toBe("PNG");
    const ac = new AbortController(); ac.abort();
    await expect(renderReport(label, { format: "png", params: {}, origin, signal: ac.signal })).rejects.toThrow(/aborted/);
    expect(rasterizePages).toHaveBeenCalledTimes(1);
  });
  it("props go into the render context; a failing dataset is a 400 with datasetErrors; a missing required param is a 400", async () => {
    await renderReport(doc, { format: "pdf", params: {}, props: { a: 1 }, origin });
    expect((renderPdf.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ a: 1 });
    const withDs = parseReport({ ...doc, datasets: [{ name: "h", type: "http", url: "https://nope.example/x" }] });
    const err = await renderReport(withDs, { format: "pdf", params: {}, origin }).catch((e) => e);
    expect(err).toBeInstanceOf(RenderRequestError);
    expect(renderErrorResponse(err).status).toBe(400);
    expect((await renderErrorResponse(err).json()).datasetErrors).toHaveLength(1);
    const withParam = parseReport({ ...doc, params: [{ name: "lot", type: "string", required: true }] });
    expect(renderErrorResponse(await renderReport(withParam, { format: "pdf", params: {}, origin }).catch((e) => e)).status).toBe(400);
  });
});

describe("helpers", () => {
  it("parseHostList trims and drops empties; isRenderFormat; contentDisposition", () => {
    expect(parseHostList(" a.com ,, b.local:1 ")).toEqual(["a.com", "b.local:1"]);
    expect(parseHostList(undefined)).toEqual([]);
    expect(renderAllowHosts("https://x.example")).toEqual(["x.example"]);
    expect(isRenderFormat("pdf")).toBe(true); expect(isRenderFormat("docx")).toBe(false); expect(isRenderFormat(1)).toBe(false);
    expect(contentDisposition(doc, "pdf")).toBe(`attachment; filename="d.pdf"; filename*=UTF-8''${encodeURIComponent("문서")}.pdf`);
  });
  it("renderErrorResponse maps unknown errors to 500 without leaking the message", async () => {
    const res = renderErrorResponse(new Error("boom: postgres://user:pass@host/db"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "렌더에 실패했습니다", code: "RENDER_FAILED" });
  });
});
