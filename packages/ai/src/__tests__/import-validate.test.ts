import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { validateImported } from "../import-validate";
import { AiValidationError } from "../types";

const page = { width: 210, height: 297 };
const empty = parseReport({ id: "r", version: 1, page });
const el = (o: object) => JSON.stringify(o);

describe("validateImported", () => {
  it("정규화 좌표를 mm으로 바꾼다", () => {
    const res = validateImported(empty, { elements: [el({ id: "t1", type: "text", x: 500, y: 0, w: 250, h: 20, value: "제목" })], explanation: "" }, page);
    const t = res.elements[0];
    expect(t.x).toBeCloseTo(105, 3);      // 500/1000 * 210
    expect(t.w).toBeCloseTo(52.5, 3);     // 250/1000 * 210
    expect(t.h).toBeCloseTo(5.94, 2);     // 20/1000 * 297
  });

  it("group 자식 좌표도 mm으로 바꾼다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "g1", type: "group", x: 0, y: 0, w: 1000, h: 100, children: [{ id: "c1", type: "text", x: 100, y: 50, w: 200, h: 30, value: "안" }] })],
      explanation: "",
    }, page);
    const g = res.elements[0] as { children: { x: number; y: number }[] };
    expect(g.children[0].x).toBeCloseTo(21, 3);
    expect(g.children[0].y).toBeCloseTo(14.85, 2);
  });

  it("페이지 밖 요소를 안으로 밀고 경고를 남긴다", () => {
    const res = validateImported(empty, { elements: [el({ id: "t1", type: "text", x: 950, y: 10, w: 200, h: 20, value: "밖" })], explanation: "" }, page);
    expect(res.elements[0].x + res.elements[0].w).toBeLessThanOrEqual(210 + 1e-6);
    expect(res.warnings.join(" ")).toContain("페이지");
  });

  it("params에 없는 이름을 쓰면 표현식을 비우고 경고를 남긴다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "{{ params.lotNo }}" }), el({ id: "t2", type: "text", x: 0, y: 30, w: 100, h: 20, value: "{{ params.unknown }}" })],
      params: [JSON.stringify({ name: "lotNo", type: "string" })],
      explanation: "",
    }, page);
    expect((res.elements[0] as { value: string }).value).toBe("{{ params.lotNo }}");
    expect((res.elements[1] as { value: string }).value).toBe("");
    expect(res.params.map((p) => p.name)).toEqual(["lotNo"]);
    expect(res.warnings.join(" ")).toContain("unknown");
  });

  it("표와 rows 데이터셋을 받아들이고 열 value의 row 참조는 허용한다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1", columns: [{ header: "품명", value: "{{ row.name }}", w: 600 }, { header: "수량", value: "{{ row.qty }}", w: 400 }] })],
      datasets: [JSON.stringify({ name: "rows1", rows: [{ name: "볼트", qty: 3 }] })],
      explanation: "",
    }, page);
    expect(res.datasets).toEqual([{ name: "rows1", type: "static", rows: [{ name: "볼트", qty: 3 }] }]);
    expect(res.elements[0].type).toBe("table");
  });

  it("이름 규칙을 어긴 데이터셋은 그것을 쓰는 표와 함께 버린다", () => {
    const res = validateImported(empty, {
      elements: [
        el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "sales", columns: [{ header: "a", value: "{{ row.a }}", w: 1000 }] }),
        el({ id: "t1", type: "text", x: 0, y: 500, w: 100, h: 20, value: "남는다" }),
      ],
      datasets: [JSON.stringify({ name: "sales", rows: [] })],
      explanation: "",
    }, page);
    expect(res.datasets).toEqual([]);
    expect(res.elements.map((e) => e.id)).toEqual(["t1"]);
    expect(res.warnings.join(" ")).toContain("sales");
  });

  it("rows는 20행까지만 남긴다", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ a: i }));
    const res = validateImported(empty, {
      elements: [el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1", columns: [{ header: "a", value: "{{ row.a }}", w: 1000 }] })],
      datasets: [JSON.stringify({ name: "rows1", rows })],
      explanation: "",
    }, page);
    expect(res.datasets[0].rows).toHaveLength(20);
    expect(res.warnings.join(" ")).toContain("20");
  });

  it("표 밖의 row 참조는 비운다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "{{ row.qty }}" })],
      explanation: "",
    }, page);
    expect((res.elements[0] as { value: string }).value).toBe("");
    expect(res.warnings.join(" ")).toContain("row");
  });

  it("깨진 요소 JSON은 그 요소만 버린다", () => {
    const res = validateImported(empty, { elements: ["{깨짐", el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "정상" })], explanation: "" }, page);
    expect(res.elements).toHaveLength(1);
    expect(res.warnings.join(" ")).toContain("건너뜀");
  });

  it("id가 겹치면 바꾸고 경고를 남긴다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "A" }), el({ id: "t1", type: "text", x: 0, y: 30, w: 100, h: 20, value: "B" })],
      explanation: "",
    }, page);
    expect(new Set(res.elements.map((e) => e.id)).size).toBe(2);
    expect(res.warnings.join(" ")).toContain("id");
  });

  it("elements 배열이 없으면 던진다", () => {
    expect(() => validateImported(empty, { explanation: "" }, page)).toThrow(AiValidationError);
  });
});
