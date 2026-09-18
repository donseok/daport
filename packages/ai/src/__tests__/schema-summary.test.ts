import { describe, it, expect } from "vitest";
import { summarizeSchema } from "../index";

describe("summarizeSchema", () => {
  it("lists every element type with its required fields, derived from the real schema", () => {
    const s = summarizeSchema();
    for (const t of ["text", "rect", "line", "image", "table", "repeater", "barcode", "ref", "group", "pageNumber"]) {
      expect(s).toContain(t);
    }
    expect(s).toMatch(/text: [^\n]*value/);
    expect(s).toMatch(/table: [^\n]*source/);
    expect(s).toMatch(/ref: [^\n]*component|ref: [^\n]*ref/);      // 실제 필드 이름에 맞춘다
    expect(s.length).toBeLessThan(6_000);                           // 프롬프트에 들어갈 만큼 짧다
  });
});
