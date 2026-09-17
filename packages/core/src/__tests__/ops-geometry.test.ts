import { describe, it, expect } from "vitest";
import { ElementSchema, type Element } from "../schema/elements";
import { elementBox, unionBox, translateElement } from "../ops/geometry";

const el = (input: unknown) => ElementSchema.parse(input);

describe("elementBox", () => {
  it("uses x, y, w, h for boxed elements", () => {
    expect(elementBox(el({ id: "t", type: "text", x: 3, y: 4, w: 20, h: 5 }))).toEqual({ x: 3, y: 4, w: 20, h: 5 });
  });
  it("uses both end points for a line drawn right-to-left and bottom-to-top", () => {
    expect(elementBox(el({ id: "l", type: "line", x: 40, y: 30, w: 0, h: 0, x2: 10, y2: 20 }))).toEqual({ x: 10, y: 20, w: 30, h: 10 });
  });
  it("gives a flat line zero height", () => {
    expect(elementBox(el({ id: "l", type: "line", x: 5, y: 8, w: 0, h: 0, x2: 25, y2: 8 }))).toEqual({ x: 5, y: 8, w: 20, h: 0 });
  });
});

describe("unionBox", () => {
  it("covers every box", () => {
    expect(unionBox([{ x: 10, y: 20, w: 5, h: 5 }, { x: 2, y: 30, w: 4, h: 10 }, { x: 12, y: 1, w: 1, h: 1 }])).toEqual({ x: 2, y: 1, w: 13, h: 39 });
  });
  it("returns a single box unchanged and throws on an empty list", () => {
    expect(unionBox([{ x: 1, y: 2, w: 3, h: 4 }])).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(() => unionBox([])).toThrow();
  });
  it("does not leave floating point noise", () => {
    expect(unionBox([{ x: 0.1, y: 0.2, w: 0.2, h: 0.1 }])).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.1 });
  });
});

describe("translateElement", () => {
  it("returns a moved copy and leaves the original alone", () => {
    const t = el({ id: "t", type: "text", x: 3, y: 4, w: 20, h: 5, value: "A" });
    const moved = translateElement(t, 10, -2);
    expect(moved).toMatchObject({ id: "t", x: 13, y: 2, w: 20, h: 5, value: "A" });
    expect(t).toMatchObject({ x: 3, y: 4 });
    expect(moved).not.toBe(t);
  });
  it("moves both end points of a line", () => {
    const moved = translateElement(el({ id: "l", type: "line", x: 40, y: 30, w: 30, h: 10, x2: 10, y2: 20 }), -10, 5);
    expect(moved).toMatchObject({ x: 30, y: 35, x2: 0, y2: 25 });
  });
  it("moves a group by its own x/y only, keeping nested children (relative) untouched", () => {
    const g = el({ id: "g", type: "group", x: 10, y: 10, w: 30, h: 30, children: [
      { id: "l", type: "line", x: 1, y: 2, w: 0, h: 0, x2: 5, y2: 2 },
      { id: "inner", type: "group", x: 3, y: 3, w: 10, h: 10, children: [{ id: "r", type: "rect", x: 1, y: 1, w: 2, h: 2 }] },
    ]}) as Extract<Element, { type: "group" }>;
    const moved = translateElement(g, 5, 5) as typeof g;
    expect(moved).toMatchObject({ x: 15, y: 15 });
    expect(moved.children).toEqual(g.children);
    expect(moved.children).not.toBe(g.children);   // 깊은 복제본
  });
  it("keeps coordinates free of floating point noise", () => {
    expect(translateElement(el({ id: "r", type: "rect", x: 0.1, y: 0.7, w: 1, h: 1 }), 0.2, -0.1)).toMatchObject({ x: 0.3, y: 0.6 });
  });
});
