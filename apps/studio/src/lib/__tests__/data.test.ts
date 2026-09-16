import { describe, it, expect } from "vitest";
import { parseReport, resolveData } from "@daport/core";
import { sampleParams, resolveDataSync } from "../data";

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, params: [
  { name: "lot", type: "string", required: true },
  { name: "qty", type: "number" },
  { name: "dt", type: "date", default: "2026-09-16" },
]});

describe("sampleParams", () => {
  it("uses the default, 0 for numbers and {name} otherwise, the same values the canvas binds", () => {
    expect(sampleParams(report)).toEqual({ lot: "{lot}", qty: 0, dt: "2026-09-16" });
    expect(resolveDataSync(report).params).toEqual(sampleParams(report));
  });
  it("converts number params like preview and PDF do, so `params.qty + 1` is the same on the canvas", async () => {
    const r = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, params: [
      { name: "qty", type: "number", default: "5" },
      { name: "lot", type: "string", required: true, default: "" },   // 미리보기는 오류를 보이지만 캔버스는 그린다
    ]});
    expect(resolveDataSync(r).params).toEqual({ qty: 5, lot: "" });
    expect((await resolveData({ ...r, params: [r.params[0]] }, sampleParams(r))).params).toEqual({ qty: 5 });
  });
});
