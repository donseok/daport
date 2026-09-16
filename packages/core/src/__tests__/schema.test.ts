import { describe, it, expect } from "vitest";
import { ReportSchema, parseReport } from "../schema/report";
import { reportJsonSchema } from "../schema/json-schema";

const base = {
  id: "r1", version: 1,
  page: { width: 210, height: 297, margin: [10, 10, 10, 10] },
  datasets: [], params: [], elements: [],
};

describe("ReportSchema", () => {
  it("parses minimal report with defaults", () => {
    const r = parseReport(base);
    expect(r.page.unit).toBe("mm");
    expect(r.elements).toEqual([]);
  });
  it("parses text element and fills style defaults", () => {
    const r = parseReport({ ...base, elements: [
      { id: "t1", type: "text", x: 1, y: 2, w: 50, h: 8, value: "hi" },
    ]});
    const el = r.elements[0];
    expect(el.type).toBe("text");
    if (el.type === "text") expect(el.style.fontSize).toBe(10);
    expect(el.flow).toBe("once");
  });
  it("parses nested group", () => {
    const r = parseReport({ ...base, elements: [
      { id: "g", type: "group", x: 0, y: 0, w: 100, h: 20, children: [
        { id: "l", type: "line", x: 0, y: 0, w: 100, h: 0, x2: 100, y2: 0 },
      ]},
    ]});
    expect(r.elements[0].type).toBe("group");
  });
  it("accepts table/barcode/ref/pageNumber types (declared only)", () => {
    const r = parseReport({ ...base, elements: [
      { id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "qr", value: "{{ params.lot }}" },
      { id: "p", type: "pageNumber", x: 0, y: 280, w: 40, h: 5 },
      { id: "c", type: "ref", x: 0, y: 0, w: 40, h: 5, ref: "hdr" },
      { id: "t", type: "table", x: 0, y: 0, w: 100, h: 100, source: "items", columns: [] },
    ]});
    expect(r.elements).toHaveLength(4);
  });
  it("rejects duplicate element ids", () => {
    expect(() => parseReport({ ...base, elements: [
      { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 },
    ]})).toThrow(/duplicate/i);
  });
  it("rejects unknown element type", () => {
    expect(() => ReportSchema.parse({ ...base, elements: [{ id: "x", type: "chart", x: 0, y: 0, w: 1, h: 1 }] })).toThrow();
  });
  it("exports a JSON schema with elements definition", () => {
    const js = reportJsonSchema() as any;
    expect(js.type).toBe("object");
    expect(js.properties.elements).toBeDefined();
  });
});
