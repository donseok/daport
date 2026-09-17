import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { renderBarcode, BarcodeError, BARCODE_2D } from "../barcode/render";
import { flatten } from "../layout/flatten";
import { placeStatic } from "../layout/place";
import { layout } from "../layout/layout";

const opts = { showText: true, fontSize: 8 };

describe("renderBarcode", () => {
  it.each(["code128", "ean13", "qr", "code39", "datamatrix"] as const)("renders %s as an svg that fills its box", (format) => {
    const value = format === "ean13" ? "4006381333931" : "LOT-2026-0917";
    const svg = renderBarcode(format, value, opts);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="100%"');
    expect(svg).toContain('height="100%"');
    expect(svg).toContain(BARCODE_2D.has(format) ? 'preserveAspectRatio="xMidYMid meet"' : 'preserveAspectRatio="none"');
    expect(svg).not.toContain("<script");
    expect(svg).toMatchSnapshot();
  });
  it("omits the human-readable text when showText is false", () => {
    const withText = renderBarcode("code128", "ABC", opts);
    const without = renderBarcode("code128", "ABC", { showText: false, fontSize: 8 });
    expect(withText.length).toBeGreaterThan(without.length);
  });
  it("throws BarcodeError for an empty value, a wrong EAN-13 check digit and characters code39 cannot encode", () => {
    expect(() => renderBarcode("code128", "", opts)).toThrow(BarcodeError);
    expect(() => renderBarcode("ean13", "4006381333930", opts)).toThrow(BarcodeError);
    expect(() => renderBarcode("code39", "abc", opts)).toThrow(BarcodeError);
    try { renderBarcode("ean13", "12", opts); } catch (e) { expect(e).toMatchObject({ name: "BarcodeError", format: "ean13", value: "12" }); }
  });
});

describe("barcode in layout", () => {
  const page = { width: 100, height: 60 };
  it("places a barcode as an svg item with the interpolated value", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [{ id: "b", type: "barcode", x: 5, y: 5, w: 40, h: 15, format: "code128", value: "{{ lot.NO }}" }] });
    const [item] = placeStatic(flatten(r.elements)[0], { params: {}, lot: { NO: "L-1" } }, { onExpressionError: "blank" });
    expect(item).toMatchObject({ kind: "svg", elementId: "b", x: 5, y: 5, w: 40, h: 15 });
    expect((item as { svg: string }).svg).toContain("<svg");
  });
  it("isolates an invalid value as #ERR in blank mode and throws in fail mode", () => {
    const r = parseReport({ id: "r", version: 1, page, elements: [
      { id: "b", type: "barcode", x: 5, y: 5, w: 40, h: 15, format: "ean13", value: "{{ lot.NO }}" },
      { id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, value: "ok" },
    ]});
    const items = layout(r, { params: {}, lot: { NO: "12" } })[0].items;
    expect(items[0]).toMatchObject({ kind: "text", elementId: "b", lines: ["#ERR"], error: expect.stringContaining("ean13") });
    expect(items[1]).toMatchObject({ elementId: "t" });
    expect(() => layout({ ...r, onExpressionError: "fail" }, { params: {}, lot: { NO: "12" } })).toThrow(BarcodeError);
  });
});
