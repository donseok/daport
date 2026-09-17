import { describe, it, expect } from "vitest";
import { parseReport, type Report } from "../schema/report";
import { ElementSchema, type Element } from "../schema/elements";
import type { ComponentBody } from "../schema/component";
import { refsTo, upgradeRefs, pruneComponents, extractComponent } from "../ops/components";

const page = { width: 210, height: 297 };
const hdrV1: ComponentBody = {
  name: "헤더", w: 180, h: 24,
  props: [{ name: "title", type: "string", default: "제목" }, { name: "showLogo", type: "boolean", default: true }],
  elements: [ElementSchema.parse({ id: "t", type: "text", x: 0, y: 0, w: 180, h: 10, value: "{{ props.title }}" })],
};
const hdrV2: ComponentBody = {
  name: "헤더", w: 170, h: 30,
  props: [{ name: "title", type: "string", default: "제목" }],
  elements: [ElementSchema.parse({ id: "t", type: "text", x: 0, y: 0, w: 170, h: 12, value: "{{ props.title }}" })],
};
const sign: ComponentBody = { name: "서명", w: 50, h: 20, props: [], elements: [ElementSchema.parse({ id: "s", type: "rect", x: 0, y: 0, w: 50, h: 20 })] };
/** 그룹 안에서만 쓰인다 */
const badge: ComponentBody = { name: "배지", w: 30, h: 12, props: [], elements: [ElementSchema.parse({ id: "b", type: "rect", x: 0, y: 0, w: 30, h: 12 })] };
/** 반복 영역 템플릿 안에서만 쓰인다 */
const cell: ComponentBody = { name: "칸", w: 40, h: 16, props: [], elements: [ElementSchema.parse({ id: "c", type: "rect", x: 0, y: 0, w: 40, h: 16 })] };

function sample(): Report {
  return parseReport({ id: "r", page, components: { "hdr@1": hdrV1, "sign@1": sign, "sign@2": sign, "badge@1": badge, "cell@1": cell }, elements: [
    { id: "top", type: "ref", ref: "hdr", version: 1, x: 15, y: 10, w: 180, h: 24, props: { title: "{{ record.T }}", showLogo: false } },
    { id: "g", type: "group", x: 0, y: 100, w: 200, h: 50, children: [
      { id: "inner", type: "ref", ref: "hdr", version: 1, x: 5, y: 5, w: 180, h: 24, props: { showLogo: true } },
      { id: "group-badge", type: "ref", ref: "badge", version: 1, x: 150, y: 30, w: 30, h: 12 },
    ]},
    { id: "cards", type: "repeater", x: 0, y: 160, w: 200, h: 100, source: "rows", item: { w: 190, h: 30, children: [
      { id: "card-hdr", type: "ref", ref: "hdr", version: 1, x: 0, y: 0, w: 180, h: 24 },
      { id: "row-cell", type: "ref", ref: "cell", version: 1, x: 140, y: 0, w: 40, h: 16 },
    ]}},
    { id: "sig", type: "ref", ref: "sign", version: 1, x: 150, y: 270, w: 50, h: 20 },
  ]});
}

describe("refsTo", () => {
  it("finds refs to one component at the top level, inside groups and inside repeater templates, in document order", () => {
    expect(refsTo(sample(), "hdr").map((r) => r.id)).toEqual(["top", "inner", "card-hdr"]);
    expect(refsTo(sample(), "sign").map((r) => r.id)).toEqual(["sig"]);
    expect(refsTo(sample(), "none")).toEqual([]);
  });
});

describe("upgradeRefs", () => {
  it("rule 1: puts the new body under id@version", () => {
    const out = upgradeRefs(sample(), "hdr", 2, hdrV2);
    expect(out.components["hdr@2"]).toEqual(hdrV2);
    expect(out.components["hdr@2"]).not.toBe(hdrV2);   // 호출자의 내용과 공유하지 않는다
  });
  it("rule 2: moves every instance to the new version and size, keeps declared values and drops undeclared ones", () => {
    const out = upgradeRefs(sample(), "hdr", 2, hdrV2);
    const refs = refsTo(out, "hdr");
    expect(refs.map((r) => [r.id, r.version, r.w, r.h])).toEqual([["top", 2, 170, 30], ["inner", 2, 170, 30], ["card-hdr", 2, 170, 30]]);
    expect(refs[0].props).toEqual({ title: "{{ record.T }}" });   // showLogo는 v2 선언에 없다
    expect(refs[1].props).toEqual({});
    expect(refs[0]).toMatchObject({ x: 15, y: 10 });                // 위치는 그대로
  });
  it("rule 3: removes old versions of this component only, leaving other components' entries (even unused ones)", () => {
    const out = upgradeRefs(sample(), "hdr", 2, hdrV2);
    expect(Object.keys(out.components).sort()).toEqual(["badge@1", "cell@1", "hdr@2", "sign@1", "sign@2"]);
    expect(refsTo(out, "sign")[0]).toMatchObject({ version: 1, w: 50, h: 20 });
  });
  it("does not mutate the input report and the result passes the report schema", () => {
    const input = sample();
    const before = JSON.parse(JSON.stringify(input));
    const out = upgradeRefs(input, "hdr", 2, hdrV2);
    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
    expect(() => parseReport(JSON.parse(JSON.stringify(out)))).not.toThrow();
  });
  it("adds the body even when the report has no instance of the component", () => {
    const out = upgradeRefs(sample(), "fresh", 1, sign);
    expect(out.components["fresh@1"]).toEqual(sign);
    expect(out.elements).toEqual(sample().elements);
  });
});

describe("pruneComponents", () => {
  it("drops entries no ref points at, including refs inside groups and repeater templates", () => {
    const out = pruneComponents(sample());
    // badge@1은 그룹 안에서만, cell@1은 반복 영역 템플릿 안에서만 쓰인다(최상위에는 없다)
    expect(Object.keys(out.components).sort()).toEqual(["badge@1", "cell@1", "hdr@1", "sign@1"]);
    expect(out.components["badge@1"]).toEqual(badge);
    expect(out.components["cell@1"]).toEqual(cell);
  });
  it("returns a new report without touching the input", () => {
    const input = sample();
    const out = pruneComponents(input);
    expect(out).not.toBe(input);
    expect(Object.keys(input.components).sort()).toEqual(["badge@1", "cell@1", "hdr@1", "sign@1", "sign@2"]);
  });
  it("empties components when there are no refs", () => {
    const r = parseReport({ id: "r", page, components: { "sign@1": sign }, elements: [{ id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 }] });
    expect(pruneComponents(r).components).toEqual({});
  });
});

describe("extractComponent", () => {
  const parent: Element[] = [
    ElementSchema.parse({ id: "title", type: "text", x: 20, y: 15, w: 100, h: 10, value: "품질보증서" }),
    ElementSchema.parse({ id: "other", type: "rect", x: 0, y: 200, w: 10, h: 10 }),
    ElementSchema.parse({ id: "rule", type: "line", x: 130, y: 30, w: 0, h: 0, x2: 10, y2: 30 }),
    ElementSchema.parse({ id: "logo-box", type: "group", x: 140, y: 10, w: 30, h: 15, children: [
      { id: "logo", type: "image", x: 1, y: 1, w: 28, h: 13, src: "asset://logo" },
    ]}),
  ];

  it("computes the bounding box using both line end points", () => {
    const { box } = extractComponent(parent, ["rule", "title", "logo-box"], "헤더");
    expect(box).toEqual({ x: 10, y: 10, w: 160, h: 20 });
  });
  it("copies the elements in parent order with coordinates relative to the box, line ends included, and no props", () => {
    const { body } = extractComponent(parent, ["rule", "title", "logo-box"], "헤더");
    expect(body).toMatchObject({ name: "헤더", w: 160, h: 20, props: [] });
    expect(body.elements.map((e) => e.id)).toEqual(["title", "rule", "logo-box"]);
    expect(body.elements[0]).toMatchObject({ x: 10, y: 5, w: 100, h: 10, value: "품질보증서" });
    expect(body.elements[1]).toMatchObject({ x: 120, y: 20, x2: 0, y2: 20 });
    expect(body.elements[2]).toMatchObject({ x: 130, y: 0 });
    // 그룹 자식은 그룹 기준 좌표라 그대로다
    expect((body.elements[2] as Extract<Element, { type: "group" }>).children[0]).toMatchObject({ x: 1, y: 1 });
  });
  it("does not change the parent array or its elements", () => {
    const before = JSON.parse(JSON.stringify(parent));
    const { body } = extractComponent(parent, ["title"], "제목");
    body.elements[0].x = 999;
    expect(JSON.parse(JSON.stringify(parent))).toEqual(before);
  });
  it("works for a single element (the box is the element itself)", () => {
    const { body, box } = extractComponent(parent, ["logo-box"], "로고");
    expect(box).toEqual({ x: 140, y: 10, w: 30, h: 15 });
    expect(body.elements[0]).toMatchObject({ x: 0, y: 0, w: 30, h: 15 });
  });
  it("throws when an id is not in the parent array (for example a group child)", () => {
    expect(() => extractComponent(parent, ["title", "logo"], "x")).toThrow(/logo/);
    expect(() => extractComponent(parent, [], "x")).toThrow();
  });
});
