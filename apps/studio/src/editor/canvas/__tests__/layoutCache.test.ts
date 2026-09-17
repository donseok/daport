import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layoutFor, layoutError } from "../layoutCache";

const repeatOverLimit = parseReport({
  id: "r", version: 1, page: { width: 100, height: 100 }, repeat: { source: "ships" },
  sample: { params: {}, capturedAt: "2026-09-17T00:00:00.000Z", data: { ships: Array.from({ length: 2001 }, (_, i) => ({ N: i })) } },
  elements: [],
});

const normal = parseReport({ id: "r2", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "hi" }] });

describe("layoutFor (스펙: 캔버스 밖 레이아웃 오류는 에디터 전체를 내리지 않는다)", () => {
  it("페이지 상한을 넘는 레포트는 빈 페이지 1장을 돌려주고 오류를 기록한다", () => {
    const pages = layoutFor(repeatOverLimit);
    expect(pages).toEqual([{ index: 0, width: 100, height: 100, items: [], copyIndex: 0, pageInCopy: 0 }]);
    expect(layoutError(repeatOverLimit)).toContain("2001");
  });

  it("정상 레포트는 페이지를 계산하고 오류는 없다", () => {
    const pages = layoutFor(normal);
    expect(pages.length).toBeGreaterThan(0);
    expect(layoutError(normal)).toBeUndefined();
  });

  it("같은 report 객체는 같은(참조 동일) 배열을 돌려준다", () => {
    const first = layoutFor(normal);
    const second = layoutFor(normal);
    expect(second).toBe(first);
  });
});

describe("layoutFor with sample props", () => {
  const titled = parseReport({ id: "r3", version: 1, page: { width: 100, height: 20, margin: [0, 0, 0, 0] },
    elements: [{ id: "t", type: "text", x: 0, y: 0, w: 50, h: 5, value: "{{ props.title }}" }] });
  const lines = (pages: ReturnType<typeof layoutFor>) => {
    const it = pages[0].items.find((i) => i.elementId === "t");
    return it?.kind === "text" ? it.lines : [];
  };
  it("lays out with the given props and caches per (report, props) reference", () => {
    const a = { title: "A" }, b = { title: "B" };
    const first = layoutFor(titled, a);
    expect(lines(first)).toEqual(["A"]);
    expect(layoutFor(titled, a)).toBe(first);
    const second = layoutFor(titled, b);
    expect(lines(second)).toEqual(["B"]);
    expect(second).not.toBe(first);
    expect(layoutError(titled, b)).toBeUndefined();
  });
});
