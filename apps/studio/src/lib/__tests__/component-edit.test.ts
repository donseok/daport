import { describe, it, expect } from "vitest";
import { parseComponentBody, type ComponentProp } from "@daport/core";
import { componentToEditReport, editReportToComponent, defaultSampleProps, samplePropsContext } from "../component-edit";

const body = parseComponentBody({ name: "회사 헤더", w: 180, h: 24,
  props: [
    { name: "title", type: "string", default: "품질보증서", label: "제목" },
    { name: "showLogo", type: "boolean", default: true },
    { name: "copies", type: "number", default: 2 },
    { name: "logo", type: "image", default: "asset://logo" },
  ],
  elements: [
    { id: "t", type: "text", x: 0, y: 0, w: 100, h: 10, value: "{{ props.title }}" },
    { id: "g", type: "group", x: 100, y: 0, w: 80, h: 24, children: [{ id: "l", type: "line", x: 0, y: 0, w: 80, h: 0, x2: 80, y2: 0 }] },
  ] });

describe("componentToEditReport", () => {
  it("wraps the body in a report whose page is the component box without margins or datasets", () => {
    const r = componentToEditReport("company-header", body);
    expect(r).toMatchObject({ id: "component-company-header", name: "회사 헤더", page: { width: 180, height: 24, margin: [0, 0, 0, 0] },
      datasets: [], params: [], components: {}, output: { kind: "pdf" } });
    expect(r.elements).toEqual(body.elements);
  });
  it("copies the elements so edits of the report do not touch the body", () => {
    const r = componentToEditReport("company-header", body);
    (r.elements[0] as { x: number }).x = 50;
    expect(body.elements[0].x).toBe(0);
  });
});

describe("editReportToComponent", () => {
  it("round-trips a body with its props", () => {
    expect(editReportToComponent(componentToEditReport("company-header", body), body.props)).toEqual(body);
  });
  it("takes name, size and elements from the edited report and props from the argument", () => {
    const r = componentToEditReport("company-header", body);
    const edited = { ...r, name: "새 헤더", page: { ...r.page, width: 150, height: 30 }, elements: r.elements.slice(0, 1) };
    const props: ComponentProp[] = [{ name: "title", type: "string", default: "X" }];
    const out = editReportToComponent(edited, props);
    expect(out).toEqual({ name: "새 헤더", w: 150, h: 30, props, elements: [body.elements[0]] });
    props[0].name = "changed";
    (edited.elements[0] as { x: number }).x = 9;
    expect(out.props[0].name).toBe("title");                 // 복제본을 돌려준다
    expect(out.elements[0].x).toBe(0);
  });
});

describe("defaultSampleProps", () => {
  it("maps each declared name to its default", () => {
    expect(defaultSampleProps(body.props)).toEqual({ title: "품질보증서", showLogo: true, copies: 2, logo: "asset://logo" });
  });
});

describe("samplePropsContext", () => {
  const mode = (sampleProps: Record<string, unknown>, props: ComponentProp[] = body.props) => ({ componentId: "company-header", version: 1, props, sampleProps });
  it("overlays sample values on defaults, drops undeclared names and values of the wrong type", () => {
    expect(samplePropsContext(mode({ title: "샘플", showLogo: "yes", copies: 5, extra: 1 })))
      .toEqual({ title: "샘플", showLogo: true, copies: 5, logo: "asset://logo" });
  });
  it("returns the same object for the same mode object and a new one for a new mode object", () => {
    const m = mode({ title: "A" });
    expect(samplePropsContext(m)).toBe(samplePropsContext(m));
    expect(samplePropsContext({ ...m })).not.toBe(samplePropsContext(m));
  });
});
