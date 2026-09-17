import { describe, it, expect } from "vitest";
import { inferFields } from "../data/infer";

describe("inferFields", () => {
  it("unions keys of the first rows in first-seen order and types primitives, dates, objects and arrays", () => {
    const f = inferFields([
      { NO: "A-1", QTY: 3, OK: true, DT: "2026-09-17", TS: "2026-09-17T05:02:00.000Z", D: new Date(0), NOTE: null, meta: { a: 1 }, items: [{ n: 1 }, { n: 2, m: "x" }] },
      { NO: "A-2", EXTRA: 1 },
    ]);
    expect(f.map((n) => [n.name, n.type])).toEqual([
      ["NO", "string"], ["QTY", "number"], ["OK", "boolean"], ["DT", "date"], ["TS", "date"], ["D", "date"], ["NOTE", "null"],
      ["meta", "object"], ["items", "array"], ["EXTRA", "number"],
    ]);
    expect(f.find((n) => n.name === "meta")?.children).toEqual([{ name: "a", path: "meta.a", type: "number" }]);
    expect(f.find((n) => n.name === "items")?.children).toEqual([{ name: "n", path: "items.n", type: "number" }, { name: "m", path: "items.m", type: "string" }]);
  });
  it("picks the most common non-null type, string on a tie", () => {
    expect(inferFields([{ v: 1 }, { v: null }, { v: 2 }, { v: "x" }])[0].type).toBe("number");
    expect(inferFields([{ v: 1 }, { v: "x" }])[0].type).toBe("string");
    expect(inferFields([{ v: null }, { v: undefined }])[0].type).toBe("null");
  });
  it("only looks at sampleSize rows and stops at maxDepth", () => {
    expect(inferFields([{ a: 1 }, { b: 2 }], { sampleSize: 1 }).map((n) => n.name)).toEqual(["a"]);
    const deep = inferFields([{ l1: { l2: { l3: 1 } } }], { maxDepth: 1 });
    expect(deep[0].children?.[0]).toEqual({ name: "l2", path: "l1.l2", type: "object" });   // children 없음
  });
  it("accepts a single object and returns [] for non-objects", () => {
    expect(inferFields({ a: 1 })).toEqual([{ name: "a", path: "a", type: "number" }]);
    expect(inferFields("x")).toEqual([]);
    expect(inferFields([1, 2])).toEqual([]);
  });
});
