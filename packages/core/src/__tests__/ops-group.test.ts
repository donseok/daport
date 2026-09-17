import { describe, it, expect } from "vitest";
import { ElementSchema, type Element } from "../schema/elements";
import { sameParent, groupElements, ungroupElement } from "../ops/group";

type Group = Extract<Element, { type: "group" }>;
type Repeater = Extract<Element, { type: "repeater" }>;
const parse = (list: unknown[]): Element[] => list.map((e) => ElementSchema.parse(e));

function tree(): Element[] {
  return parse([
    { id: "a", type: "text", x: 10.3, y: 10.1, w: 20, h: 5, value: "A" },
    { id: "b", type: "rect", x: 40, y: 12.7, w: 10, h: 10 },
    { id: "l", type: "line", x: 60, y: 30, w: 0, h: 0, x2: 45, y2: 30 },
    { id: "g", type: "group", x: 100, y: 100, w: 50, h: 50, children: [
      { id: "g1", type: "rect", x: 1, y: 1, w: 5, h: 5 },
      { id: "g2", type: "text", x: 10, y: 10, w: 5, h: 5 },
    ]},
    { id: "hdr", type: "ref", ref: "hdr", version: 1, x: 0, y: 200, w: 30, h: 10 },
    { id: "cards", type: "repeater", x: 0, y: 220, w: 200, h: 60, source: "rows", item: { w: 90, h: 20, children: [
      { id: "c1", type: "text", x: 1, y: 1, w: 10, h: 5 },
      { id: "c2", type: "text", x: 20, y: 1, w: 10, h: 5 },
    ]}},
  ]);
}
const allow = { allowInTemplate: true, allowRefs: true };
const strict = { allowInTemplate: false, allowRefs: false };

describe("sameParent", () => {
  it("returns the real parent array and sorted indices for top-level siblings", () => {
    const els = tree();
    const info = sameParent(els, ["l", "a"], strict);
    expect(info).toEqual({ parent: els, indices: [0, 2] });
    if ("parent" in info) expect(info.parent).toBe(els);
  });
  it("accepts children of the same group and a single element", () => {
    const els = tree();
    const info = sameParent(els, ["g2", "g1"], strict);
    expect("parent" in info && info.parent).toBe((els[3] as Group).children);
    expect("parent" in info && info.indices).toEqual([0, 1]);
    expect(sameParent(els, ["g"], strict)).toEqual({ parent: els, indices: [3] });
  });
  it("rejects an empty selection, unknown ids and mixed parents with Korean reasons", () => {
    const els = tree();
    expect(sameParent(els, [], allow)).toEqual({ error: "선택한 요소가 없습니다" });
    expect(sameParent(els, ["a", "zz"], allow)).toEqual({ error: "요소를 찾을 수 없습니다: zz" });
    expect(sameParent(els, ["a", "g1"], allow)).toEqual({ error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" });
    expect(sameParent(els, ["g", "g1"], allow)).toEqual({ error: "같은 부모(최상위 또는 같은 그룹) 안의 요소만 함께 선택할 수 있습니다" });
  });
  it("allowInTemplate controls repeater template children", () => {
    const els = tree();
    expect(sameParent(els, ["c1", "c2"], strict)).toEqual({ error: "반복 영역 템플릿 안의 요소는 컴포넌트로 만들 수 없습니다" });
    const info = sameParent(els, ["c1", "c2"], allow);
    expect("parent" in info && info.parent).toBe((els[5] as Repeater).item.children);
    expect(sameParent(els, ["cards"], strict)).toEqual({ parent: els, indices: [5] });   // 반복 영역 자체는 템플릿 안이 아니다
  });
  it("allowRefs controls refs in the selection and inside selected groups", () => {
    const els = parse([...tree(), { id: "wrap", type: "group", x: 0, y: 0, w: 30, h: 10, children: [
      { id: "inner-ref", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 30, h: 10 },
    ]}]);
    const reason = { error: "컴포넌트 인스턴스는 다른 컴포넌트에 넣을 수 없습니다" };
    expect(sameParent(els, ["a", "hdr"], strict)).toEqual(reason);
    expect(sameParent(els, ["wrap"], strict)).toEqual(reason);
    expect(sameParent(els, ["a", "hdr"], allow)).toEqual({ parent: els, indices: [0, 4] });
  });
  it("ignores duplicate ids", () => {
    const els = tree();
    expect(sameParent(els, ["a", "a", "b"], strict)).toEqual({ parent: els, indices: [0, 1] });
  });
});

describe("groupElements", () => {
  it("wraps the selection in a group at the first selected index, with the bounding box (line end points) and relative children", () => {
    const els = tree();
    const out = groupElements(els, ["l", "b"], "group-1");
    expect(out.map((e) => e.id)).toEqual(["a", "group-1", "g", "hdr", "cards"]);
    const g = out[1] as Group;
    expect(g).toMatchObject({ type: "group", x: 40, y: 12.7, w: 20, h: 17.3, flow: "once" });
    expect(g.visible).toBeUndefined();
    expect(g.children.map((c) => c.id)).toEqual(["b", "l"]);             // 부모 배열 순서
    expect(g.children[0]).toMatchObject({ x: 0, y: 0, w: 10, h: 10 });
    expect(g.children[1]).toMatchObject({ x: 20, y: 17.3, x2: 5, y2: 17.3 });
    expect(() => ElementSchema.parse(g)).not.toThrow();
  });
  it("uses document order, not selection order, to place the group", () => {
    const out = groupElements(tree(), ["hdr", "a"], "group-1");
    expect(out.map((e) => e.id)).toEqual(["group-1", "b", "l", "g", "cards"]);
    expect((out[0] as Group).children.map((c) => c.id)).toEqual(["a", "hdr"]);
  });
  it("groups inside a group's children and keeps nested groups' own children untouched", () => {
    const els = tree();
    const inner = (els[3] as Group).children;
    const out = groupElements(parse([...inner, { id: "n", type: "group", x: 20, y: 20, w: 10, h: 10, children: [{ id: "n1", type: "rect", x: 2, y: 2, w: 1, h: 1 }] }]), ["g2", "n"], "group-1");
    const g = out[1] as Group;
    expect(g).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
    expect((g.children[1] as Group).children[0]).toMatchObject({ x: 2, y: 2 });
  });
  it("does not modify the input array or elements and throws for ids outside the array", () => {
    const els = tree();
    const before = JSON.parse(JSON.stringify(els));
    groupElements(els, ["a", "b"], "group-1");
    expect(JSON.parse(JSON.stringify(els))).toEqual(before);
    expect(() => groupElements(els, ["a", "g1"], "group-1")).toThrow();
  });
});

describe("ungroupElement", () => {
  it("puts the children back in place, in order, with parent coordinates (line end points too)", () => {
    const els = parse([
      { id: "x", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "g", type: "group", x: 100, y: 50, w: 50, h: 50, children: [
        { id: "l", type: "line", x: 10, y: 5, w: 0, h: 0, x2: 0, y2: 5 },
        { id: "t", type: "text", x: 1, y: 2, w: 5, h: 5 },
      ]},
      { id: "z", type: "rect", x: 0, y: 0, w: 1, h: 1 },
    ]);
    const out = ungroupElement(els, "g");
    expect(out.map((e) => e.id)).toEqual(["x", "l", "t", "z"]);
    expect(out[1]).toMatchObject({ x: 110, y: 55, x2: 100, y2: 55 });
    expect(out[2]).toMatchObject({ x: 101, y: 52 });
    expect((els[1] as Group).children[1]).toMatchObject({ x: 1, y: 2 });   // 입력은 그대로
  });
  it("refuses a group with a visible condition and ids that are not groups in the array", () => {
    const els = parse([{ id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, visible: "{{ params.show }}", children: [] }, { id: "r", type: "rect", x: 0, y: 0, w: 1, h: 1 }]);
    expect(() => ungroupElement(els, "g")).toThrow("group has visible");
    expect(() => ungroupElement(els, "r")).toThrow();
    expect(() => ungroupElement(els, "nope")).toThrow();
  });
  it("round-trips: grouping contiguous siblings then ungrouping gives the original tree", () => {
    const els = tree();
    const grouped = groupElements(els, ["a", "b", "l"], "group-1");
    expect(ungroupElement(grouped, "group-1")).toEqual(els);
    const inner = (els[3] as Group).children;
    expect(ungroupElement(groupElements(inner, ["g1", "g2"], "group-2"), "group-2")).toEqual(inner);
    const cards = (els[5] as Repeater).item.children;
    expect(ungroupElement(groupElements(cards, ["c1", "c2"], "group-3"), "group-3")).toEqual(cards);
  });
  it("round-trips non-contiguous siblings except that they end up adjacent at the first position", () => {
    const els = tree();
    const out = ungroupElement(groupElements(els, ["a", "l"], "group-1"), "group-1");
    expect(out.map((e) => e.id)).toEqual(["a", "l", "b", "g", "hdr", "cards"]);
    expect(out[0]).toEqual(els[0]);
    expect(out[1]).toEqual(els[2]);
  });
});

describe("package entry", () => {
  it("exports geometry, component and group ops", async () => {
    const core = await import("../index");
    for (const name of ["elementBox", "unionBox", "translateElement", "refsTo", "upgradeRefs", "pruneComponents", "extractComponent", "sameParent", "groupElements", "ungroupElement"]) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
