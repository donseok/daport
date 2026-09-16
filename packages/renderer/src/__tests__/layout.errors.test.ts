import { describe, it, expect, vi } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";

// 이 파일에서만 측정기를 망가뜨린다. 다른 레이아웃 테스트는 실제 측정기를 쓴다
vi.mock("../text/measure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/measure")>()),
  wrapText: () => { throw new TypeError("boom"); },
}));

const page = { width: 100, height: 50 };

describe("layout error isolation scope", () => {
  const make = (onExpressionError: "blank" | "fail") => parseReport({ id: "r", version: 1, page, onExpressionError, elements: [
    { id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, value: "hello" },
  ]});
  it("rethrows non-expression errors in blank mode", () => {
    expect(() => layout(make("blank"), { params: {} })).toThrow(TypeError);
  });
  it("rethrows non-expression errors in fail mode", () => {
    expect(() => layout(make("fail"), { params: {} })).toThrow(TypeError);
  });
});
