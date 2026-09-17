import { describe, it, expect } from "vitest";
import { parseReport, safeParseReport, RESERVED_CONTEXT_NAMES } from "../schema/report";

const base = { id: "r", version: 1, page: { width: 210, height: 297 } };
const text = (id: string) => ({ id, type: "text", x: 1, y: 1, w: 20, h: 5, value: "x" });
const table = (id: string, overflow?: string) => ({ id, type: "table", x: 0, y: 0, w: 100, h: 50, source: "items", columns: [], ...(overflow ? { overflow } : {}) });
const repeater = (id: string, children: unknown[]) => ({ id, type: "repeater", x: 0, y: 0, w: 100, h: 100, source: "lots", item: { w: 50, h: 20, children } });
const issues = (input: unknown) => { const r = safeParseReport(input); return r.success ? [] : r.error.issues.map((i) => i.message); };

describe("report schema (phase 2)", () => {
  it("parses repeat with default as=record and sample with defaults", () => {
    const r = parseReport({ ...base, repeat: { source: "shipments" }, sample: { capturedAt: "2026-09-17T00:00:00.000Z" } });
    expect(r.repeat).toEqual({ source: "shipments", as: "record" });
    expect(r.sample).toEqual({ params: {}, data: {}, capturedAt: "2026-09-17T00:00:00.000Z" });
    expect(parseReport(base).repeat).toBeUndefined();
  });
  it("rejects a repeat.as that is not an identifier or is reserved", () => {
    expect(issues({ ...base, repeat: { source: "s", as: "1x" } }).length).toBeGreaterThan(0);
    expect(issues({ ...base, repeat: { source: "s", as: "row" } })).toContain("reserved name: row");
    expect(RESERVED_CONTEXT_NAMES).toContain("pageRows");
  });
  it("parses http dataset with headers/body/rowsPath and sql dataset", () => {
    const r = parseReport({ ...base, datasets: [
      { name: "orders", type: "http", url: "https://mes.example.com/{{ params.no }}", headers: { Authorization: "Bearer {{ secrets.T }}" }, method: "POST", body: "{}", rowsPath: "data.items" },
      { name: "items", type: "sql", connection: "mes", query: "SELECT 1 FROM DUAL" },
    ]});
    expect(r.datasets[0]).toMatchObject({ type: "http", method: "POST", headers: { Authorization: "Bearer {{ secrets.T }}" }, rowsPath: "data.items" });
    const http = parseReport({ ...base, datasets: [{ name: "o", type: "http", url: "https://x" }] }).datasets[0];
    expect(http).toEqual({ name: "o", type: "http", url: "https://x", method: "GET", headers: {} });
  });
  it("rejects reserved or duplicate dataset names", () => {
    expect(issues({ ...base, datasets: [{ name: "record", type: "static", rows: [] }] })).toContain("reserved name: record");
    expect(issues({ ...base, datasets: [{ name: "a", type: "static", rows: [] }, { name: "a", type: "static", rows: [] }] })).toContain("duplicate dataset name: a");
  });
  it("rejects a dataset name that is not an identifier or is a forbidden prototype key", () => {
    expect(issues({ ...base, datasets: [{ name: "a-b", type: "static", rows: [] }] }).length).toBeGreaterThan(0);
    expect(issues({ ...base, datasets: [{ name: "__proto__", type: "static", rows: [] }] })).toContain("reserved name: __proto__");
  });
  it("rejects duplicate ids across repeater template children", () => {
    expect(issues({ ...base, elements: [text("t"), repeater("r", [text("t")])] })).toContain("duplicate element id: t");
  });
  it("rejects a repeater inside a repeater template and a continue-table inside a template", () => {
    expect(issues({ ...base, elements: [repeater("r", [repeater("r2", [])])] })).toContain("repeater inside repeater template: r2");
    expect(issues({ ...base, elements: [repeater("r", [table("t")])] })).toContain('table inside repeater template must be overflow "clip": t');
    expect(issues({ ...base, elements: [repeater("r", [table("t", "clip")])] })).toEqual([]);
    expect(issues({ ...base, elements: [repeater("r", [{ id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, children: [table("t")] }])] }))
      .toContain('table inside repeater template must be overflow "clip": t');
  });
});
