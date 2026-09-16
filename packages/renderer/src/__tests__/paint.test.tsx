import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseReport, StyleSchema, type Style } from "@daport/core";
import { layout } from "../layout/layout";
import type { Page } from "../layout/types";
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
  it("gives a horizontal or vertical line an SVG box at least as thick as its stroke (mm, not screen px)", () => {
    const r = parseReport({ id: "r5", version: 1, page: { width: 60, height: 40 }, elements: [
      { id: "h", type: "line", x: 5, y: 20, w: 50, h: 0, x2: 55, y2: 20, style: { stroke: "#000", strokeWidth: 0.5 } },
      { id: "v", type: "line", x: 30, y: 5, w: 0, h: 30, x2: 30, y2: 35, style: { stroke: "#000", strokeWidth: 2 } },
    ]});
    const html = renderToStaticMarkup(<PaintPages pages={layout(r, { params: {} })} />);
    const svg = (id: string) => {
      const m = html.match(new RegExp(`<svg[^>]*data-element-id="${id}"[^>]*>(.*?)</svg>`));
      expect(m).not.toBeNull();
      const tag = m![0];
      const mm = (prop: string) => Number(tag.match(new RegExp(`${prop}:([\\d.]+)mm`))![1]);
      return { tag, left: mm("left"), top: mm("top"), width: mm("width"), height: mm("height") };
    };
    const h = svg("h");
    expect(h.height).toBeGreaterThanOrEqual(0.5);          // 0.01mm 높이의 SVG는 Chromium이 그리지 않는다
    expect(h.top).toBeCloseTo(19.75); expect(h.left).toBeCloseTo(4.75); expect(h.width).toBeCloseTo(50.5);
    const v = svg("v");
    expect(v.width).toBeGreaterThanOrEqual(2);
    expect(v.left).toBeCloseTo(29); expect(v.top).toBeCloseTo(4); expect(v.height).toBeCloseTo(32);
    expect(html).not.toContain("vector-effect");            // non-scaling-stroke면 strokeWidth가 mm가 아니라 화면 px로 읽힌다
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
  it("drops color, stroke and fill values that bypassed the schema instead of writing them into inline styles", () => {
    // 캔버스는 검증 전의 메모리 편집을 그리므로 스키마를 거치지 않은 Page[]를 직접 만든다
    const evil = "red;background:url(http://x)";
    const style: Style = { ...StyleSchema.parse({}), color: evil, stroke: evil, fill: evil };
    const pages: Page[] = [{ index: 0, width: 60, height: 40, items: [
      { kind: "text", elementId: "t", x: 0, y: 0, w: 20, h: 10, style, lines: ["x"], lineHeight: 4, overflow: false },
      { kind: "rect", elementId: "r", x: 0, y: 10, w: 20, h: 10, style },
      { kind: "line", elementId: "l", x: 0, y: 30, w: 20, h: 0, x2: 20, y2: 30, style },
    ]}];
    const html = renderToStaticMarkup(<PaintPages pages={pages} />);
    expect(html).toContain('data-element-id="t"');
    expect(html).not.toContain("url(");
    expect(html).not.toContain("background");
    expect(html).not.toContain("border:");
    expect(html).toContain('stroke="#000"');
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
