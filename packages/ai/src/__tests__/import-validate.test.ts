import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { flatten } from "@daport/renderer";
import { validateImported, MAX_IMPORT_ELEMENTS } from "../import-validate";
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

  it("페이지 밖 group을 안으로 밀어도 자식의 저장된 좌표는 그대로다(자식은 그룹 상대좌표)", () => {
    const res = validateImported(empty, {
      elements: [el({
        id: "g1", type: "group", x: 900, y: 0, w: 200, h: 100,
        children: [{ id: "c1", type: "text", x: 0, y: 0, w: 50, h: 50, value: "안" }],
      })],
      explanation: "",
    }, page);
    const g = res.elements[0] as { x: number; children: { x: number; y: number }[] };
    // 그룹은 페이지 안으로 밀렸다
    expect(g.x + 42).toBeLessThanOrEqual(210 + 1e-6);
    // 자식은 부모를 따라가는 상대좌표이므로 밀기 전과 같은 값이어야 한다(0 그대로)
    expect(g.children[0].x).toBeCloseTo(0, 6);
    expect(g.children[0].y).toBeCloseTo(0, 6);
    // flatten으로 절대좌표를 계산해도 자식이 그룹 밖으로 나가지 않는다
    const flat = flatten(res.elements);
    const child = flat.find((f) => f.id === "c1")!;
    expect(child.x).toBeCloseTo(g.x, 6);
    expect(child.x + child.w).toBeLessThanOrEqual(210 + 1e-6);
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

  it("params·row의 대괄호 참조도 잡아낸다", () => {
    const res = validateImported(empty, {
      elements: [
        el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: '{{ params["unknown"] }}' }),
        el({ id: "t2", type: "text", x: 0, y: 30, w: 100, h: 20, value: "{{ row['qty'] }}" }),
      ],
      explanation: "",
    }, page);
    expect((res.elements[0] as { value: string }).value).toBe("");
    expect((res.elements[1] as { value: string }).value).toBe("");
    expect(res.warnings.join(" ")).toContain("unknown");
    expect(res.warnings.join(" ")).toContain("row");
  });

  it("__proto__ 같은 예약 이름은 파라미터로 거부한다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "본문" })],
      params: [JSON.stringify({ name: "__proto__", type: "string" }), JSON.stringify({ name: "row", type: "string" })],
      explanation: "",
    }, page);
    expect(res.params).toEqual([]);
    expect(res.warnings.join(" ")).toContain("__proto__");
    expect(res.warnings.join(" ")).toContain("row");
  });

  it("표 자신의 visible도 다른 요소와 같은 검사를 받는다", () => {
    const res = validateImported(empty, {
      elements: [el({
        id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1",
        visible: "{{ params.unknown }}",
        columns: [{ header: "a", value: "{{ row.a }}", w: 1000 }],
      })],
      datasets: [JSON.stringify({ name: "rows1", rows: [] })],
      explanation: "",
    }, page);
    expect((res.elements[0] as { visible?: string }).visible).toBe("");
    expect(res.warnings.join(" ")).toContain("unknown");
  });

  it("표 열 value의 미선언 파라미터는 비우고 row 참조는 그대로 둔다", () => {
    const res = validateImported(empty, {
      elements: [el({
        id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1",
        columns: [{ header: "a", value: "{{ row.a }}", w: 500 }, { header: "b", value: "{{ params.unknown }}", w: 500 }],
      })],
      datasets: [JSON.stringify({ name: "rows1", rows: [{ a: 1 }] })],
      explanation: "",
    }, page);
    const cols = (res.elements[0] as { columns: { value: string }[] }).columns;
    expect(cols[0].value).toBe("{{ row.a }}");
    expect(cols[1].value).toBe("");
    expect(res.warnings.join(" ")).toContain("unknown");
  });

  it("배열인 요소 JSON은 그 요소만 버린다", () => {
    const res = validateImported(empty, {
      elements: [el([1, 2, 3]), el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "정상" })],
      explanation: "",
    }, page);
    expect(res.elements).toHaveLength(1);
    expect(res.elements[0].id).toBe("t1");
    expect(res.warnings.join(" ")).toContain("건너뜀");
  });

  it(`요소는 ${MAX_IMPORT_ELEMENTS}개까지만 남기고 넘는 개수를 경고에 적는다(프롬프트 상한이 지켜지지 않아도 서버가 강제한다)`, () => {
    const many = Array.from({ length: MAX_IMPORT_ELEMENTS + 5 }, (_, i) => el({ id: `t${i}`, type: "text", x: 0, y: 0, w: 10, h: 10, value: String(i) }));
    const res = validateImported(empty, { elements: many, explanation: "" }, page);
    expect(res.elements).toHaveLength(MAX_IMPORT_ELEMENTS);
    expect(res.elements[0].id).toBe("t0");   // 앞에서부터 남긴다
    expect(res.warnings.join(" ")).toContain("5");
  });

  it("데이터셋의 객체가 아닌 행은 그 행만 버리고 나머지는 남긴다", () => {
    const res = validateImported(empty, {
      elements: [el({ id: "tb1", type: "table", x: 0, y: 0, w: 1000, h: 200, source: "rows1", columns: [{ header: "a", value: "{{ row.a }}", w: 1000 }] })],
      datasets: [JSON.stringify({ name: "rows1", rows: [{ a: 1 }, "깨짐", null, ["배열"], { a: 2 }] })],
      explanation: "",
    }, page);
    expect(res.datasets).toEqual([{ name: "rows1", type: "static", rows: [{ a: 1 }, { a: 2 }] }]);
    expect(res.warnings.join(" ")).toContain("객체가 아니라 건너뜀");
  });

  it("report에 이미 있던 예약어 파라미터 이름은 표현식에서 쓸 수 없다", () => {
    const withReserved = parseReport({ id: "r", version: 1, page, params: [{ name: "__proto__", type: "string" }] });
    const res = validateImported(withReserved, {
      elements: [el({ id: "t1", type: "text", x: 0, y: 0, w: 100, h: 20, value: "{{ params.__proto__ }}" })],
      explanation: "",
    }, page);
    expect((res.elements[0] as { value: string }).value).toBe("");
    expect(res.warnings.join(" ")).toContain("__proto__");
  });

  it("좌표가 유한수가 아니면 요소를 버린다", () => {
    const res = validateImported(empty, {
      // 1e400은 JS 숫자 범위를 넘어 JSON.parse가 Infinity로 읽는다
      elements: ['{"id":"t1","type":"text","x":1e400,"y":0,"w":100,"h":20,"value":"정상"}'],
      explanation: "",
    }, page);
    expect(res.elements).toHaveLength(0);
    expect(res.warnings.join(" ")).toContain("t1");
  });
});
