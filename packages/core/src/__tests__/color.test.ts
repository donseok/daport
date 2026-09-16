import { describe, it, expect } from "vitest";
import { isSafeCssColor, StyleSchema, parseReport } from "../index";

const accepted = [
  "#000", "#0008", "#000000", "#00000080", "#ABCDEF", " #fff ",
  "rgb(0, 0, 0)", "rgba(0 0 0 / 50%)", "rgba(255,255,255,0.5)", "hsl(120deg 50% 50%)", "hsla(-30, 50%, 50%, .5)",
  "red", "RebeccaPurple", "transparent", "currentColor",
];
const rejected = [
  "red;background:url(x)", "url(x)", "#fff}", "var(--x)", '"red"', "'red'", "red\nx", "red\n", "expression(alert(1))",
  "", "   ", "#ff", "#fffff", "#ggg", "red blue", "rgb(0 0 0);x", "rgb(0,0,0", "rgb(calc(1),0,0)", "rgb(0 0 0) url(x)",
  "rgb(0\\,0,0)", "hsl(1 2 3 {)", "red:", "lab(0 0 0)", "rgb(0,0,--1)",
];

describe("isSafeCssColor", () => {
  it.each(accepted)("accepts %j", (v) => expect(isSafeCssColor(v)).toBe(true));
  it.each(rejected)("rejects %j", (v) => expect(isSafeCssColor(v)).toBe(false));
});

describe("StyleSchema colors", () => {
  it("keeps the default color and accepts safe colors", () => {
    expect(StyleSchema.parse({}).color).toBe("#000000");
    const s = StyleSchema.parse({ color: "rgb(0, 0, 0)", stroke: "#00000080", fill: "transparent" });
    expect(s).toMatchObject({ color: "rgb(0, 0, 0)", stroke: "#00000080", fill: "transparent" });
    expect(StyleSchema.parse({}).stroke).toBeUndefined();
  });
  it.each(["color", "stroke", "fill"])("rejects an injected %s with an invalid color message", (key) => {
    const r = StyleSchema.safeParse({ [key]: "red;background:url(http://127.0.0.1:9/evil)" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: [key], message: "invalid color" });
  });
  it.each(["stroke", "fill"])("rejects an empty %s", (key) => {
    expect(StyleSchema.safeParse({ [key]: "" }).success).toBe(false);
  });
  it("parseReport throws on a report with an injected color", () => {
    expect(() => parseReport({ id: "r", version: 1, page: { width: 60, height: 40 }, elements: [
      { id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, value: "x", style: { color: "red;background:url(http://127.0.0.1:9/evil)" } },
    ]})).toThrow();
  });
});
