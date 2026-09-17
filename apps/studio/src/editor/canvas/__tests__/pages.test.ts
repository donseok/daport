import { describe, it, expect } from "vitest";
import type { Page } from "@daport/renderer";
import { clampView, currentPage, primaryItem, isOtherInstance } from "../pages";

const pg = (index: number, copyIndex: number, pageInCopy: number, items: Page["items"] = []): Page => ({ index, width: 10, height: 10, items, copyIndex, pageInCopy });
const pages = [pg(0, 0, 0), pg(1, 0, 1), pg(2, 1, 0)];

describe("pages", () => {
  it("clampView keeps a valid view and clamps copy then page", () => {
    expect(clampView({ copyIndex: 0, pageInCopy: 1 }, pages)).toEqual({ copyIndex: 0, pageInCopy: 1 });
    expect(clampView({ copyIndex: 5, pageInCopy: 9 }, pages)).toEqual({ copyIndex: 1, pageInCopy: 0 });
    expect(clampView({ copyIndex: 0, pageInCopy: 9 }, pages)).toEqual({ copyIndex: 0, pageInCopy: 1 });
    expect(clampView({ copyIndex: 0, pageInCopy: 0 }, [])).toEqual({ copyIndex: 0, pageInCopy: 0 });
  });
  it("currentPage returns the page for the view", () => {
    expect(currentPage(pages, { copyIndex: 1, pageInCopy: 0 }).index).toBe(2);
    expect(currentPage(pages, { copyIndex: 7, pageInCopy: 7 }).index).toBe(2);
  });
  it("primaryItem picks the first non-cell/border item of the element", () => {
    const style = {} as Page["items"][number]["style"];
    const p = pg(0, 0, 0, [
      { kind: "rect", elementId: "t", role: "flowBox", x: 1, y: 1, w: 5, h: 5, style },
      { kind: "text", elementId: "t", role: "cell", instance: "t#h", x: 1, y: 1, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
      { kind: "text", elementId: "nm", instance: "cards#0", x: 2, y: 2, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
      { kind: "text", elementId: "nm", instance: "cards#1", x: 3, y: 3, w: 5, h: 5, style, lines: [], lineHeight: 1, overflow: false },
    ]);
    expect(primaryItem(p, "t")).toMatchObject({ role: "flowBox" });
    expect(primaryItem(p, "nm")).toMatchObject({ instance: "cards#0" });
    expect(primaryItem(p, "zz")).toBeUndefined();
  });
  it("isOtherInstance dims only non-first repeater item instances, not table cells or group bands", () => {
    const rep = (id: string) => id === "cards";
    const notRep = () => false;
    expect(isOtherInstance("cards#0", rep)).toBe(false);
    expect(isOtherInstance("cards#2", rep)).toBe(true);
    expect(isOtherInstance("cards#g0h1", rep)).toBe(false);
    expect(isOtherInstance("t#2", notRep)).toBe(false);
    expect(isOtherInstance("cards#2/t2#0", rep)).toBe(true);
    expect(isOtherInstance(undefined, rep)).toBe(false);
  });
});
