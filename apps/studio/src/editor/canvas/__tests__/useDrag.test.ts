import { describe, it, expect } from "vitest";
import { applyHandle, type Box, type Handle } from "../useDrag";

const box: Box = { x: 10, y: 10, w: 20, h: 5 };

describe("applyHandle", () => {
  it.each<[Handle, number, number, Box]>([
    ["move", 3, -2, { x: 13, y: 8, w: 20, h: 5 }],
    ["e", 5, 0, { x: 10, y: 10, w: 25, h: 5 }],
    ["s", 0, 2.5, { x: 10, y: 10, w: 20, h: 7.5 }],
    ["w", -5, 0, { x: 5, y: 10, w: 25, h: 5 }],          // 왼쪽 변을 끌면 x가 따라간다
    ["n", 0, -2, { x: 10, y: 8, w: 20, h: 7 }],
    ["ne", 5, -2, { x: 10, y: 8, w: 25, h: 7 }],
    ["nw", -5, -2, { x: 5, y: 8, w: 25, h: 7 }],
    ["se", 5, 2.5, { x: 10, y: 10, w: 25, h: 7.5 }],
    ["sw", -5, 2.5, { x: 5, y: 10, w: 25, h: 7.5 }],
  ])("%s handle with dx=%d dy=%d", (h, dx, dy, expected) => {
    expect(applyHandle(box, h, dx, dy)).toEqual(expected);
  });

  it("does not mutate the input box", () => {
    applyHandle(box, "se", 5, 5);
    expect(box).toEqual({ x: 10, y: 10, w: 20, h: 5 });
  });

  it("clamps to the minimum size and keeps the opposite edge fixed", () => {
    expect(applyHandle(box, "w", 30, 0)).toEqual({ x: 29, y: 10, w: 1, h: 5 });     // 오른쪽 변(x+w=30)이 고정
    expect(applyHandle(box, "e", -30, 0)).toEqual({ x: 10, y: 10, w: 1, h: 5 });
    expect(applyHandle(box, "n", 0, 10)).toEqual({ x: 10, y: 14, w: 20, h: 1 });    // 아래 변(y+h=15)이 고정
    expect(applyHandle(box, "s", 0, -10)).toEqual({ x: 10, y: 10, w: 20, h: 1 });
    expect(applyHandle(box, "e", -30, 0, 2)).toEqual({ x: 10, y: 10, w: 2, h: 5 });
  });
});
