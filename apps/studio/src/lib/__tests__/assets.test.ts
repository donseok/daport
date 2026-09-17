import { describe, it, expect } from "vitest";
import { parseReport, walkElements, type Element } from "@daport/core";
import { resolveAssetUrls } from "../assets";

const img = (id: string, src: string) => ({ id, type: "image", x: 0, y: 0, w: 1, h: 1, src });
const srcs = (els: Element[]): string[] => {
  const out: string[] = [];
  walkElements(els, (el) => { if (el.type === "image") out.push(el.src); });
  return out;
};
/** 본문 요소든 컴포넌트 내용이든 같은 모양으로 쓰는 트리: 이미지 하나, 그룹 안 하나, 반복 영역 템플릿 안 하나, 그룹 꼬리 http 하나 */
const tree = (p: string) => [
  img(`${p}1`, `asset://${p}a`),
  { id: `${p}g`, type: "group", x: 0, y: 0, w: 1, h: 1, children: [img(`${p}2`, `asset://${p}b`)] },
  { id: `${p}r`, type: "repeater", x: 0, y: 0, w: 1, h: 1, source: "s",
    item: { w: 1, h: 1, children: [img(`${p}3`, `asset://${p}c`)] },
    groups: [{ by: "item.k", footer: { h: 1, children: [img(`${p}4`, "http://keep")] } }] },
];
const expected = (p: string) => [`https://o/api/assets/${p}a`, `https://o/api/assets/${p}b`, `https://o/api/assets/${p}c`, "http://keep"];

describe("resolveAssetUrls", () => {
  it("rewrites asset:// in groups and repeater templates without touching the input", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, elements: tree("e") });
    const out = resolveAssetUrls(r, "https://o");
    expect(srcs(out.elements)).toEqual(expected("e"));
    expect(srcs(r.elements)).toEqual(["asset://ea", "asset://eb", "asset://ec", "http://keep"]);
  });

  it("rewrites asset:// inside component bodies, including group and repeater templates", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 },
      elements: [{ id: "ref1", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 2, h: 2 }],
      components: { "hdr@1": { name: "머리글", w: 2, h: 2, elements: tree("c") } } });
    const out = resolveAssetUrls(r, "https://o");
    expect(srcs(out.components["hdr@1"].elements)).toEqual(expected("c"));
    expect(srcs(r.components["hdr@1"].elements)).toEqual(["asset://ca", "asset://cb", "asset://cc", "http://keep"]);
  });

  it("rewrites asset:// in ref props and component prop defaults, leaving other values alone", () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 },
      elements: [
        { id: "ref1", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 2, h: 2,
          props: { logo: "asset://p", url: "http://keep", title: "{{ record.T }}", n: 1, on: true } },
        { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [
          { id: "ref2", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 2, h: 2, props: { logo: "asset://q" } },
        ] },
      ],
      components: { "hdr@1": { name: "머리글", w: 2, h: 2, elements: [],
        props: [
          { name: "logo", type: "image", default: "asset://d" },
          { name: "url", type: "image", default: "" },
          { name: "title", type: "string", default: "" },
          { name: "n", type: "number", default: 0 },
          { name: "on", type: "boolean", default: false },
        ] } } });
    const out = resolveAssetUrls(r, "https://o");
    const [ref1, group] = out.elements;
    if (ref1.type !== "ref" || group.type !== "group") throw new Error("shape");
    expect(ref1.props).toEqual({ logo: "https://o/api/assets/p", url: "http://keep", title: "{{ record.T }}", n: 1, on: true });
    expect(group.children[0]).toMatchObject({ props: { logo: "https://o/api/assets/q" } });
    expect(out.components["hdr@1"].props[0].default).toBe("https://o/api/assets/d");
    expect((r.elements[0] as { props: Record<string, unknown> }).props.logo).toBe("asset://p");
    expect(r.components["hdr@1"].props[0].default).toBe("asset://d");
  });
});
