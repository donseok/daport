import { describe, it, expect } from "vitest";
import { parseReport, safeParseReport } from "../schema/report";
import { OutputSchema, DEFAULT_OUTPUT } from "../schema/output";
import { PresetSchema } from "../schema/preset";
import { ElementSchema } from "../schema/elements";

const base = { id: "r", version: 1, page: { width: 60, height: 40 } };

describe("output schema", () => {
  it("defaults to pdf and fills label defaults", () => {
    expect(parseReport(base).output).toEqual({ kind: "pdf" });
    expect(DEFAULT_OUTPUT).toEqual({ kind: "pdf" });
    const r = parseReport({ ...base, output: { kind: "label", label: { language: "zpl", dpi: 203 } } });
    expect(r.output).toEqual({ kind: "label", label: { language: "zpl", dpi: 203, threshold: 128, copies: 1 } });
  });
  it("rejects label without the label block, bad dpi, threshold and speed ranges", () => {
    expect(safeParseReport({ ...base, output: { kind: "label" } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 600 } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 300, threshold: 256 } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 300, speed: 0 } }).success).toBe(false);
    expect(OutputSchema.safeParse({ kind: "label", label: { language: "tspl", dpi: 300, darkness: 30, speed: 14, copies: 2 } }).success).toBe(true);
  });
});

describe("barcode format", () => {
  it("accepts the five formats and rejects others", () => {
    for (const format of ["code128", "ean13", "qr", "code39", "datamatrix"]) {
      expect(ElementSchema.safeParse({ id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format, value: "x" }).success).toBe(true);
    }
    expect(ElementSchema.safeParse({ id: "b", type: "barcode", x: 0, y: 0, w: 40, h: 15, format: "pdf417", value: "x" }).success).toBe(false);
  });
});

describe("preset schema", () => {
  it("parses with output default and builtin false, enforces the id rule", () => {
    const p = PresetSchema.parse({ id: "coil-tag", name: "코일 Tag", page: { width: 100, height: 150 } });
    expect(p).toEqual({ id: "coil-tag", name: "코일 Tag", page: { width: 100, height: 150, margin: [10, 10, 10, 10], unit: "mm" }, output: { kind: "pdf" }, builtin: false });
    expect(PresetSchema.safeParse({ id: "Bad Id", name: "x", page: { width: 1, height: 1 } }).success).toBe(false);
    expect(PresetSchema.safeParse({ id: "x", name: "", page: { width: 1, height: 1 } }).success).toBe(false);
  });
});
