import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { resolveAssetUrls } from "../assets";

describe("resolveAssetUrls", () => {
  it("rewrites asset:// to /api/assets/{id} and leaves http alone", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, elements: [
      { id: "a", type: "image", x: 0, y: 0, w: 1, h: 1, src: "asset://stamp" },
      { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "b", type: "image", x: 0, y: 0, w: 1, h: 1, src: "https://x/y.png" }] },
    ]});
    const out = resolveAssetUrls(r, "https://studio.example");
    expect((out.elements[0] as any).src).toBe("https://studio.example/api/assets/stamp");
    expect(((out.elements[1] as any).children[0]).src).toBe("https://x/y.png");
    expect((r.elements[0] as any).src).toBe("asset://stamp");   // 원본 불변
  });
});
