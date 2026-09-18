import { describe, it, expect } from "vitest";
import { parseReport, parseComponentBody } from "@daport/core";
import { validateEditPatch, validateGenerated, AiValidationError } from "../index";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 210, height: 297 },
  elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "제목" }] });
const raw = (patch: unknown[], explanation = "x") => ({ patch, explanation });
const op = (o: string, path: string, value?: unknown) => ({ op: o, path, ...(value === undefined ? {} : { value: JSON.stringify(value) }) });

describe("validateEditPatch", () => {
  it("applies an allowed patch, parses JSON-string values and returns the next report", () => {
    const res = validateEditPatch(report, raw([op("replace", "/elements/0/value", "검사 성적서"), op("replace", "/page/width", 297)]));
    expect(res.warnings).toEqual([]);
    expect(res.next.elements[0]).toMatchObject({ value: "검사 성적서" });
    expect(res.next.page.width).toBe(297);
    expect((report.elements[0] as { value: string }).value).toBe("제목");                 // 원본 불변
    expect(res.patch).toHaveLength(2);
  });
  it("drops forbidden paths with a warning and keeps the rest", () => {
    const res = validateEditPatch(report, raw([
      op("replace", "/id", "hacked"), op("replace", "/output/kind", "label"), op("add", "/components/x@1", {}),
      op("replace", "/sample/params/lot", "L"), op("replace", "/elements/0/w", 90),
    ]));
    expect(res.patch).toHaveLength(1);
    expect(res.next.elements[0].w).toBe(90);
    expect(res.next.id).toBe("r");
    expect(res.warnings.join(" ")).toMatch(/\/id/);
    expect(res.warnings).toHaveLength(4);
  });
  it("drops an op that cannot be applied and keeps going", () => {
    const res = validateEditPatch(report, raw([op("replace", "/elements/9/value", "x"), op("replace", "/elements/0/value", "ok")]));
    expect((res.next.elements[0] as { value: string }).value).toBe("ok");
    expect(res.warnings.some((w) => w.includes("/elements/9/value"))).toBe(true);
  });
  it("renames a new element whose id collides, in the value and in later ops", () => {
    const res = validateEditPatch(report, raw([
      op("add", "/elements/-", { id: "t1", type: "text", x: 0, y: 0, w: 10, h: 5, value: "새 텍스트" }),
      op("replace", "/elements/1/w", 20),
    ]));
    const added = res.next.elements[1] as { id: string; w: number };
    expect(added.id).not.toBe("t1");
    expect(added.id).toMatch(/^text-\d+$/);
    expect(added.w).toBe(20);
  });
  it("drops a copy whose from-path is forbidden, even though the destination path is allowed", () => {
    const res = validateEditPatch(report, raw([{ op: "copy", from: "/output/kind", path: "/name" }]));
    expect(res.patch).toHaveLength(0);
    expect(res.warnings.join(" ")).toMatch(/\/output\/kind/);
    expect(res.next.name).toBe("R");
    expect(res.next.output.kind).toBe("pdf");
  });
  it("drops a move whose from-path is forbidden, leaving the forbidden field in place", () => {
    const res = validateEditPatch(report, raw([{ op: "move", from: "/id", path: "/name" }]));
    expect(res.patch).toHaveLength(0);
    expect(res.warnings.join(" ")).toMatch(/\/id/);
    expect(res.next.id).toBe("r");
    expect(res.next.name).toBe("R");
  });
  it("still applies a legal move between two /elements paths", () => {
    const res = validateEditPatch(report, raw([
      op("add", "/elements/-", { id: "t2", type: "text", x: 0, y: 0, w: 10, h: 5, value: "b" }),
      { op: "move", from: "/elements/1", path: "/elements/0" },
    ]));
    expect(res.warnings).toEqual([]);
    expect(res.patch).toHaveLength(2);
    expect(res.next.elements[0]).toMatchObject({ id: "t2" });
    expect(res.next.elements[1]).toMatchObject({ id: "t1" });
  });
  it("throws AiValidationError when the result fails the schema, and for a malformed response", () => {
    expect(() => validateEditPatch(report, raw([op("replace", "/elements/0/w", -5)]))).toThrow(AiValidationError);
    expect(() => validateEditPatch(report, raw([{ op: "frobnicate", path: "/elements/0" }]))).toThrow(AiValidationError);
    expect(() => validateEditPatch(report, { explanation: "x" })).toThrow(AiValidationError);
    expect(() => validateEditPatch(report, raw([op("replace", "/elements/0/value", undefined)]))).toThrow(AiValidationError);   // value 없는 replace
  });
});

describe("validateGenerated", () => {
  const empty = parseReport({ id: "e", version: 1, page: { width: 210, height: 297 } });
  const body = parseComponentBody({ name: "회사 헤더", w: 190, h: 20, props: [], elements: [{ id: "h", type: "text", x: 0, y: 0, w: 190, h: 20, value: "회사" }] });
  const lookup = async (id: string) => (id === "header" ? { version: 3, body } : null);
  const gen = (elements: unknown[]) => ({ elements: elements.map((e) => JSON.stringify(e)), explanation: "x" });

  it("parses elements, fills components for refs at the latest version and clamps to the page", async () => {
    const res = await validateGenerated(empty, gen([
      { id: "hd", type: "ref", x: 10, y: 10, w: 190, h: 20, ref: "header", version: 1, props: {} },
      { id: "t1", type: "text", x: 200, y: 10, w: 80, h: 8, value: "제목" },
    ]), lookup);
    expect(res.elements[0]).toMatchObject({ ref: "header", version: 3 });
    expect(res.components["header@3"]).toBeTruthy();
    expect(res.elements[1].x + res.elements[1].w).toBeLessThanOrEqual(210);
    expect(res.warnings.join(" ")).toMatch(/header/);
    expect(res.warnings.join(" ")).toMatch(/t1/);
  });
  it("rejects a ref to an unknown component and a non-empty report", async () => {
    await expect(validateGenerated(empty, gen([{ id: "x", type: "ref", x: 0, y: 0, w: 10, h: 10, ref: "nope", version: 1, props: {} }]), lookup)).rejects.toThrow(AiValidationError);
    await expect(validateGenerated(empty, { elements: ["not json"], explanation: "" }, lookup)).rejects.toThrow(AiValidationError);
  });
});
