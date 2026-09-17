import { describe, it, expect } from "vitest";
import {
  ComponentBodySchema, ComponentPropSchema, parseComponentBody, componentKey, COMPONENT_ID_RE, COMPONENT_KEY_RE,
} from "../schema/component";
import { ElementSchema } from "../schema/elements";
import { parseReport, safeParseReport, RESERVED_CONTEXT_NAMES, type ReportInput } from "../schema/report";
import { reportJsonSchema } from "../schema/json-schema";
import * as core from "../index";

const text = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", x: 1, y: 1, w: 20, h: 5, value: "x", ...extra });
const table = (id: string, overflow?: string) => ({ id, type: "table", x: 0, y: 0, w: 100, h: 50, source: "items", columns: [], ...(overflow ? { overflow } : {}) });
const repeater = (id: string, children: unknown[]) => ({ id, type: "repeater", x: 0, y: 0, w: 100, h: 100, source: "lots", item: { w: 50, h: 20, children } });
const group = (id: string, children: unknown[]) => ({ id, type: "group", x: 0, y: 0, w: 60, h: 30, children });
const ref = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "ref", x: 5, y: 5, w: 180, h: 24, ref: "company-header", version: 3, ...extra });
const body = (extra: Record<string, unknown> = {}) => ({ name: "회사 헤더", w: 180, h: 24, elements: [text("title")], ...extra });
const bodyIssues = (input: unknown) => { const r = ComponentBodySchema.safeParse(input); return r.success ? [] : r.error.issues.map((i) => i.message); };
const base = { id: "r", version: 1, page: { width: 210, height: 297 } };
const issues = (input: unknown) => { const r = safeParseReport(input); return r.success ? [] : r.error.issues.map((i) => i.message); };

describe("component body schema", () => {
  it("parses with defaults props=[] and elements=[] and fills element defaults", () => {
    const b = parseComponentBody({ name: "빈 컴포넌트", w: 10, h: 5 });
    expect(b).toEqual({ name: "빈 컴포넌트", w: 10, h: 5, props: [], elements: [] });
    const full = parseComponentBody(body({ props: [{ name: "title", type: "string", default: "품질보증서", label: "제목" }] }));
    expect(full.props).toEqual([{ name: "title", type: "string", default: "품질보증서", label: "제목" }]);
    expect(full.elements[0]).toMatchObject({ id: "title", type: "text", flow: "once", style: { fontSize: 10 } });
  });
  it("rejects empty name and non-positive size", () => {
    expect(ComponentBodySchema.safeParse(body({ name: "" })).success).toBe(false);
    expect(ComponentBodySchema.safeParse(body({ w: 0 })).success).toBe(false);
    expect(ComponentBodySchema.safeParse(body({ h: -1 })).success).toBe(false);
  });
  it("accepts each prop type with a matching default", () => {
    for (const p of [
      { name: "title", type: "string", default: "" },
      { name: "qty", type: "number", default: 3 },
      { name: "showLogo", type: "boolean", default: true },
      { name: "logo", type: "image", default: "asset://logo" },
      { name: "_x1", type: "image", default: "https://example.com/a.png" },
    ]) expect(ComponentPropSchema.safeParse(p).success).toBe(true);
  });
  it("rejects a default that does not match the type, a missing default and an unknown type", () => {
    expect(ComponentPropSchema.safeParse({ name: "a", type: "string", default: 1 }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "number", default: "1" }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "boolean", default: "true" }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "image", default: false }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "string" }).success).toBe(false);
    expect(ComponentPropSchema.safeParse({ name: "a", type: "date", default: "" }).success).toBe(false);
  });
  it("rejects prop names that are not identifiers", () => {
    for (const name of ["1a", "a-b", "a b", "", "제목"]) {
      expect(ComponentPropSchema.safeParse({ name, type: "string", default: "" }).success).toBe(false);
    }
  });
  it("rejects duplicate prop names", () => {
    const props = [{ name: "title", type: "string", default: "" }, { name: "title", type: "number", default: 0 }];
    expect(bodyIssues(body({ props }))).toContain("duplicate prop name: title");
  });
  it("rejects a ref anywhere in the element tree (no nesting)", () => {
    expect(bodyIssues(body({ elements: [ref("inner")] }))).toContain("ref inside component: inner");
    expect(bodyIssues(body({ elements: [group("g", [ref("deep")])] }))).toContain("ref inside component: deep");
    expect(bodyIssues(body({ elements: [repeater("rp", [ref("tpl")])] }))).toContain("ref inside component: tpl");
  });
  it("rejects duplicate element ids inside the component tree, including groups and templates", () => {
    expect(bodyIssues(body({ elements: [text("a"), text("a")] }))).toContain("duplicate element id: a");
    expect(bodyIssues(body({ elements: [text("a"), group("g", [text("a")])] }))).toContain("duplicate element id: a");
    expect(bodyIssues(body({ elements: [text("a"), repeater("rp", [text("a")])] }))).toContain("duplicate element id: a");
  });
  it("applies the repeater template rules like the report schema, and allows flow elements at top level", () => {
    expect(bodyIssues(body({ elements: [repeater("rp", [repeater("rp2", [])])] }))).toContain("repeater inside repeater template: rp2");
    expect(bodyIssues(body({ elements: [repeater("rp", [table("t")])] }))).toContain('table inside repeater template must be overflow "clip": t');
    expect(bodyIssues(body({ elements: [repeater("rp", [table("t", "clip")])] }))).toEqual([]);
    expect(bodyIssues(body({ elements: [table("t"), repeater("rp", [text("nm")])] }))).toEqual([]);
  });
});

describe("component ids and keys", () => {
  it("builds keys and matches the id/key formats", () => {
    expect(componentKey("company-header", 3)).toBe("company-header@3");
    for (const id of ["company-header", "h1", "0abc"]) expect(COMPONENT_ID_RE.test(id)).toBe(true);
    for (const id of ["Company", "-x", "a_b", "a@1", ""]) expect(COMPONENT_ID_RE.test(id)).toBe(false);
    expect("company-header@3".match(COMPONENT_KEY_RE)?.slice(1)).toEqual(["company-header", "3"]);
    for (const key of ["company-header", "company-header@0", "company-header@01", "Company@1", "a@1.5", "@1"]) {
      expect(COMPONENT_KEY_RE.test(key)).toBe(false);
    }
  });
});

describe("ref element schema", () => {
  it("parses ref with version and string/number/boolean props, props default {}", () => {
    const el = ElementSchema.parse(ref("hdr", { props: { title: "{{ record.DOC_TITLE }}", qty: 2, showLogo: false } }));
    expect(el).toMatchObject({ type: "ref", ref: "company-header", version: 3, props: { title: "{{ record.DOC_TITLE }}", qty: 2, showLogo: false } });
    const bare = ElementSchema.parse(ref("hdr"));
    if (bare.type === "ref") expect(bare.props).toEqual({});
  });
  it("requires a positive integer version", () => {
    const { version: _omit, ...noVersion } = ref("hdr");
    expect(ElementSchema.safeParse(noVersion).success).toBe(false);
    for (const version of [0, -1, 1.5, "3"]) expect(ElementSchema.safeParse(ref("hdr", { version })).success).toBe(false);
  });
  it("requires ref to be a component id", () => {
    for (const r of ["Company", "a/b", "", "company-header@3"]) expect(ElementSchema.safeParse(ref("hdr", { ref: r })).success).toBe(false);
  });
  it("rejects prop values that are not string, number or boolean", () => {
    for (const v of [null, [1], { a: 1 }]) expect(ElementSchema.safeParse(ref("hdr", { props: { title: v } })).success).toBe(false);
  });
});

describe("report components", () => {
  const components = { "company-header@3": body() };
  it("defaults components to {} and keeps parsed bodies", () => {
    expect(parseReport(base).components).toEqual({});
    const r = parseReport({ ...base, components, elements: [ref("hdr")] });
    expect(r.components["company-header@3"]).toMatchObject({ name: "회사 헤더", w: 180, h: 24, props: [] });
    expect(r.components["company-header@3"].elements[0]).toMatchObject({ id: "title", style: { fontSize: 10 } });
  });
  it("rejects malformed component keys", () => {
    for (const key of ["company-header", "company-header@0", "Company@1", "a@b"]) {
      expect(safeParseReport({ ...base, components: { [key]: body() } }).success).toBe(false);
    }
  });
  it("validates each embedded body with the component rules", () => {
    expect(issues({ ...base, components: { "company-header@3": body({ elements: [ref("inner")] }) } })).toContain("ref inside component: inner");
    expect(issues({ ...base, components: { "company-header@3": body({ elements: [text("a"), text("a")] }) } })).toContain("duplicate element id: a");
  });
  it("allows unused components entries", () => {
    expect(issues({ ...base, components: { "company-header@3": body(), "company-header@2": body() } })).toEqual([]);
  });
  it("rejects a ref whose component version is missing, at top level, in groups and in repeater templates", () => {
    expect(issues({ ...base, elements: [ref("hdr")] })).toContain("missing component company-header@3: hdr");
    expect(issues({ ...base, components: { "company-header@2": body() }, elements: [ref("hdr")] })).toContain("missing component company-header@3: hdr");
    expect(issues({ ...base, elements: [group("g", [ref("inGroup")])] })).toContain("missing component company-header@3: inGroup");
    expect(issues({ ...base, elements: [repeater("rp", [ref("inTpl")])] })).toContain("missing component company-header@3: inTpl");
    const withBand = { ...repeater("rp", []), groups: [{ by: "item.LINE", header: { h: 8, children: [ref("inBand")] } }] };
    expect(issues({ ...base, elements: [withBand] })).toContain("missing component company-header@3: inBand");
  });
  it("does not treat inherited object keys as components", () => {
    expect(issues({ ...base, elements: [ref("hdr", { ref: "constructor", version: 1 })] })).toContain("missing component constructor@1: hdr");
  });
  it("rejects a ref whose w/h differ from the component body", () => {
    expect(issues({ ...base, components, elements: [ref("hdr", { w: 170 })] })).toContain("ref size differs from component company-header@3: hdr");
    expect(issues({ ...base, components, elements: [ref("hdr", { h: 30 })] })).toContain("ref size differs from component company-header@3: hdr");
    expect(issues({ ...base, components, elements: [ref("hdr", { w: 180 + 1e-9 })] })).toEqual([]);
  });
  it("rejects a component with a continue table or a repeater used inside a repeater template", () => {
    const flowComponents = {
      "std-table@1": { name: "표준 표", w: 50, h: 20, elements: [table("t")] },
      "cards@1": { name: "카드", w: 50, h: 20, elements: [repeater("inner", [text("nm")])] },
      "clip-table@1": { name: "잘린 표", w: 50, h: 20, elements: [group("g", [table("t", "clip")])] },
    };
    const inTpl = (id: string, name: string) => ref(id, { ref: name, version: 1, w: 50, h: 20 });
    expect(issues({ ...base, components: flowComponents, elements: [repeater("rp", [inTpl("a", "std-table")])] }))
      .toContain("component with continue table or repeater inside repeater template: a");
    expect(issues({ ...base, components: flowComponents, elements: [repeater("rp", [group("g", [inTpl("b", "cards")])])] }))
      .toContain("component with continue table or repeater inside repeater template: b");
    expect(issues({ ...base, components: flowComponents, elements: [repeater("rp", [inTpl("c", "clip-table")])] })).toEqual([]);
    expect(issues({ ...base, components: flowComponents, elements: [inTpl("d", "std-table"), inTpl("e", "cards")] })).toEqual([]);
  });
  it("applies id uniqueness to the report tree only; component internal ids may overlap report ids", () => {
    expect(issues({ ...base, components, elements: [text("title"), ref("hdr")] })).toEqual([]);
    expect(issues({ ...base, components, elements: [ref("hdr", { x: 0 }), ref("hdr2", { y: 40 })] })).toEqual([]);
    expect(issues({ ...base, components, elements: [ref("hdr"), text("hdr")] })).toContain("duplicate element id: hdr");
  });
  it("reserves props as a context name for datasets and repeat.as", () => {
    expect(RESERVED_CONTEXT_NAMES).toContain("props");
    expect(issues({ ...base, datasets: [{ name: "props", type: "static", rows: [] }] })).toContain("reserved name: props");
    expect(issues({ ...base, repeat: { source: "s", as: "props" } })).toContain("reserved name: props");
  });
  it("exports the component API from the package index and keeps the JSON schema export working", () => {
    expect(core.componentKey("a", 1)).toBe("a@1");
    expect(core.parseComponentBody).toBe(parseComponentBody);
    expect(core.ComponentBodySchema).toBe(ComponentBodySchema);
    expect(core.COMPONENT_KEY_RE).toBe(COMPONENT_KEY_RE);
    const js = reportJsonSchema() as { properties: { components: { propertyNames: { pattern: string } } } };
    expect(js.properties.components.propertyNames.pattern).toBe(COMPONENT_KEY_RE.source);
    expect(JSON.stringify(js)).toContain('"required":["id","x","y","w","h","type","ref","version"]');
  });
});

describe("component schema typing and shared tree rules", () => {
  const components = { "company-header@3": body() };

  it("keeps the schema input type: components values are checked, and the object shape stays reachable", () => {
    // 입력 타입이 unknown으로 무너지면 아래 @ts-expect-error가 "쓰이지 않은 지시"로 타입 검사에서 걸린다
    // @ts-expect-error components 값은 컴포넌트 내용이어야 한다
    const bad: ReportInput = { ...base, components: { "company-header@3": 42 } };
    expect(safeParseReport(bad).success).toBe(false);
    expect(safeParseReport({ ...base, components: { "company-header@3": 42 } }).success).toBe(false);
    expect(safeParseReport({ ...base, components: { "company-header@3": null } }).success).toBe(false);
    expect(safeParseReport({ ...base, components: { "company-header@3": "x" } }).success).toBe(false);
    expect(Object.keys(ComponentBodySchema.shape).sort()).toEqual(["elements", "h", "name", "props", "w"]);
  });

  it("rejects a ref hidden in a repeater group band inside a component body", () => {
    const headerBand = { ...repeater("rp", []), groups: [{ by: "item.LINE", header: { h: 8, children: [ref("inHeader")] } }] };
    const footerBand = { ...repeater("rp", []), groups: [{ by: "item.LINE", footer: { h: 8, children: [ref("inFooter")] } }] };
    expect(bodyIssues(body({ elements: [headerBand] }))).toContain("ref inside component: inHeader");
    expect(bodyIssues(body({ elements: [footerBand] }))).toContain("ref inside component: inFooter");
  });

  it("rejects a component whose non-clip table is hidden in a group when used inside a repeater template", () => {
    const deep = { "deep-table@1": { name: "숨은 표", w: 50, h: 20, elements: [group("g", [table("t")])] } };
    const inTpl = ref("a", { ref: "deep-table", version: 1, w: 50, h: 20 });
    expect(issues({ ...base, components: deep, elements: [repeater("rp", [inTpl])] }))
      .toContain("component with continue table or repeater inside repeater template: a");
    expect(issues({ ...base, components: deep, elements: [inTpl] })).toEqual([]);
  });

  it("rejects a ref size mismatch inside groups and repeater templates too", () => {
    expect(issues({ ...base, components, elements: [group("g", [ref("inGroup", { w: 170 })])] }))
      .toContain("ref size differs from component company-header@3: inGroup");
    expect(issues({ ...base, components, elements: [repeater("rp", [ref("inTpl", { h: 30 })])] }))
      .toContain("ref size differs from component company-header@3: inTpl");
  });

  it("puts embedded component body issues under components.<key>", () => {
    const r = safeParseReport({ ...base, components: { "company-header@3": body({ elements: [text("a"), text("a")] }) } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const paths = r.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("components.company-header@3.elements");
    expect(paths.every((p) => p.startsWith("components.company-header@3"))).toBe(true);
  });
});
