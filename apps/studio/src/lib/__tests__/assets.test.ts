import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { resolveAssetUrls } from "../assets";

describe("resolveAssetUrls", () => {
  it("rewrites asset:// in groups and repeater templates without touching the input", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, elements: [
      { id: "i", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://a" },
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "i2", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://b" }] },
      { id: "rp", type: "repeater", x: 0, y: 0, w: 1, h: 1, source: "s", item: { w: 1, h: 1, children: [{ id: "i3", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://c" }] },
        groups: [{ by: "item.k", footer: { h: 1, children: [{ id: "i4", type: "image", x: 0, y: 0, w: 1, h: 1, src: "http://keep" }] } }] },
    ]});
    const out = resolveAssetUrls(r, "https://o");
    const srcs: string[] = [];
    const walk = (els: typeof out.elements) => { for (const e of els) { if (e.type === "image") srcs.push(e.src); if (e.type === "group") walk(e.children); if (e.type === "repeater") { walk(e.item.children); for (const g of e.groups) { if (g.header) walk(g.header.children); if (g.footer) walk(g.footer.children); } } } };
    walk(out.elements);
    expect(srcs).toEqual(["https://o/api/assets/a", "https://o/api/assets/b", "https://o/api/assets/c", "http://keep"]);
    expect((r.elements[0] as { src: string }).src).toBe("asset://a");
  });
});
