// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const renderLabel = vi.fn();
const rasterizePages = vi.fn();
vi.mock("@daport/label", async (orig) => ({ ...(await orig<typeof import("@daport/label")>()), renderLabel, rasterizePages }));
const { POST } = await import("../[id]/label/route");

const label = { id: "lb", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } };
const call = (body: unknown, query = "") => POST(new Request(`http://localhost/api/reports/lb/label${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "lb" }) });
beforeEach(() => { renderLabel.mockReset(); rasterizePages.mockReset(); });

describe("POST /api/reports/[id]/label", () => {
  it("returns the encoded label with mime and filename", async () => {
    renderLabel.mockResolvedValue({ language: "zpl", dpi: 203, pages: 1, data: Buffer.from("^XA^XZ\n"), mime: "text/plain", filename: "lb.zpl" });
    const res = await call({ report: label, params: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toContain('filename="lb.zpl"');
    expect(await res.text()).toBe("^XA^XZ\n");
  });
  it("returns a PNG of the first label for ?preview=png", async () => {
    rasterizePages.mockResolvedValue([{ width: 8, height: 1, bits: new Uint8Array([0xf0]) }]);
    const res = await call({ report: label, params: {} }, "?preview=png");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });
  it("returns 400 for a pdf report, dataset errors, LABEL_TOO_LARGE and LAYOUT_LIMIT", async () => {
    expect((await call({ report: { ...label, output: { kind: "pdf" } }, params: {} })).status).toBe(400);
    const bad = await call({ report: { ...label, datasets: [{ name: "h", type: "http", url: "https://nope.example.com/x" }] }, params: {} });
    expect(bad.status).toBe(400);
    expect((await bad.json()).datasetErrors).toHaveLength(1);
    const { LabelTooLargeError } = await import("@daport/label");
    renderLabel.mockRejectedValue(new LabelTooLargeError(99));
    const big = await call({ report: label, params: {} });
    expect(big.status).toBe(400);
    expect((await big.json()).code).toBe("LABEL_TOO_LARGE");
    const { LayoutLimitError } = await import("@daport/renderer");
    renderLabel.mockRejectedValue(new LayoutLimitError(2001));
    expect((await (await call({ report: label, params: {} })).json()).code).toBe("LAYOUT_LIMIT");
  });
  it("returns 500 for a browser failure", async () => {
    renderLabel.mockRejectedValue(new Error("Target crashed"));
    expect((await call({ report: label, params: {} })).status).toBe(500);
  });
});

describe("POST /api/reports/[id]/label props field", () => {
  it("passes body props into the context for the label download and the bitmap preview, and omits a non-object props", async () => {
    renderLabel.mockResolvedValue({ language: "zpl", dpi: 203, pages: 1, data: Buffer.from("^XA^XZ\n"), mime: "text/plain", filename: "lb.zpl" });
    rasterizePages.mockResolvedValue([{ width: 8, height: 1, bits: new Uint8Array([0xf0]) }]);
    expect((await call({ report: label, params: {}, props: { code: "P-1" } })).status).toBe(200);
    expect((renderLabel.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ code: "P-1" });
    expect((await call({ report: label, params: {}, props: { code: "P-2" } }, "?preview=png")).status).toBe(200);
    expect((rasterizePages.mock.calls[0][1] as Record<string, unknown>).props).toEqual({ code: "P-2" });
    await call({ report: label, params: {}, props: "P-3" });
    expect(Object.hasOwn(renderLabel.mock.calls[1][1] as object, "props")).toBe(false);
  });
});
