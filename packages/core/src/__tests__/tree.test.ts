import { describe, it, expect } from "vitest";
import { ElementSchema, type Element } from "../schema/elements";
import { childArrays, walkElements, collectIds } from "../schema/tree";

const els: Element[] = [
  ElementSchema.parse({ id: "a", type: "text", x: 0, y: 0, w: 1, h: 1 }),
  ElementSchema.parse({ id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [{ id: "b", type: "rect", x: 0, y: 0, w: 1, h: 1 }] }),
  ElementSchema.parse({ id: "r", type: "repeater", x: 0, y: 0, w: 1, h: 1, source: "s", item: { w: 1, h: 1, children: [{ id: "c", type: "text", x: 0, y: 0, w: 1, h: 1 }] },
    groups: [{ by: "item.k", header: { h: 1, children: [{ id: "d", type: "rect", x: 0, y: 0, w: 1, h: 1 }] }, footer: { h: 1, children: [{ id: "e", type: "rect", x: 0, y: 0, w: 1, h: 1 }] } }] }),
];

describe("tree", () => {
  it("childArrays: group → [children], repeater → [item, group header, group footer], leaf → []", () => {
    expect(childArrays(els[0])).toEqual([]);
    expect(childArrays(els[1]).map((a) => a.map((e) => e.id))).toEqual([["b"]]);
    expect(childArrays(els[2]).map((a) => a.map((e) => e.id))).toEqual([["c"], ["d"], ["e"]]);
  });
  it("walkElements visits depth-first in document order with parent, index and ancestors", () => {
    const seen: string[] = [];
    walkElements(els, (el, parent, i, ancestors) => { seen.push(`${el.id}:${parent[i] === el}:${ancestors.map((a) => a.id).join("/")}`); });
    expect(seen).toEqual(["a:true:", "g:true:", "b:true:g", "r:true:", "c:true:r", "d:true:r", "e:true:r"]);
  });
  it("walkElements stops when fn returns true", () => {
    const seen: string[] = [];
    expect(walkElements(els, (el) => { seen.push(el.id); return el.id === "b"; })).toBe(true);
    expect(seen).toEqual(["a", "g", "b"]);
    expect(walkElements(els, () => {})).toBe(false);
  });
  it("collectIds includes template children", () => {
    expect([...collectIds(els)].sort()).toEqual(["a", "b", "c", "d", "e", "g", "r"]);
  });
});
