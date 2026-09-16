import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { PaintPages } from "../paint/Paint";
import { pageCss } from "../paint/css";
import { renderToHtml } from "../html";

const report = parseReport({ id: "r", version: 1, page: { width: 60, height: 40 }, elements: [
  { id: "t", type: "text", x: 5, y: 5, w: 40, h: 10, value: "Hello", style: { fontSize: 12, bold: true, align: "center" } },
  { id: "r", type: "rect", x: 1, y: 1, w: 58, h: 38, style: { stroke: "#000", strokeWidth: 0.3 } },
  { id: "l", type: "line", x: 5, y: 20, w: 50, h: 0, x2: 55, y2: 20, style: { stroke: "#f00" } },
  { id: "i", type: "image", x: 5, y: 25, w: 10, h: 10, src: "https://example.com/a.png" },
  { id: "b", type: "barcode", x: 20, y: 25, w: 20, h: 10, format: "qr", value: "x" },
]});

describe("paint", () => {
  it("renders absolute mm positioned elements", () => {
    const html = renderToStaticMarkup(<PaintPages pages={layout(report, { params: {} })} />);
    expect(html).toContain('data-element-id="t"');
    expect(html).toMatch(/left:5mm;top:5mm;width:40mm;height:10mm/);
    expect(html).toContain("font-weight:700");
    expect(html).toContain("text-align:center");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).toContain("barcode:qr");
    expect(html).toContain("<svg");           // line은 svg
  });
  it("emits @page size from page dims", () => {
    expect(pageCss(60, 40)).toContain("@page{size:60mm 40mm;margin:0}");
  });
  it("renderToHtml returns a full document with font-face", () => {
    const html = renderToHtml(report, { params: {} }, { fontBaseUrl: "/fonts" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("@font-face");
    expect(html).toContain("/fonts/Pretendard-Regular.otf");
    expect(html).toContain('class="dp-page"');
  });
  it("escapes the report name in <title>", () => {
    const r = parseReport({ id: "r3", name: "</title><script>x</script>", version: 1, page: { width: 60, height: 40 }, elements: [] });
    const html = renderToHtml(r, { params: {} }, { fontBaseUrl: "/fonts" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;/title&gt;");
  });
  it("omits the src attribute of an image without a source", () => {
    const r = parseReport({ id: "r4", version: 1, page: { width: 60, height: 40 }, elements: [
      { id: "i", type: "image", x: 5, y: 5, w: 10, h: 10, src: "" },
    ]});
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(<PaintPages pages={layout(r, { params: {} })} />);
      expect(html).toContain('data-element-id="i"');
      expect(html).not.toContain("src=");
      expect(warn).not.toHaveBeenCalled();   // React의 빈 src 경고 (브라우저가 페이지를 다시 요청할 수 있다)
    } finally {
      warn.mockRestore();
    }
  });
  it("keeps an empty text line as a non-breaking space", () => {
    const r = parseReport({ id: "r2", version: 1, page: { width: 60, height: 40 }, elements: [
      { id: "m", type: "text", x: 5, y: 5, w: 40, h: 20, value: "a\n\nb", style: { fontSize: 12 } },
    ]});
    const html = renderToStaticMarkup(<PaintPages pages={layout(r, { params: {} })} />);
    expect(html).toContain("<div>a</div><div>\u00a0</div><div>b</div>");
    expect(html).not.toContain("<div> </div>");
  });
});
