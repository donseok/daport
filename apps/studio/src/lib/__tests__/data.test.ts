import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
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
});
