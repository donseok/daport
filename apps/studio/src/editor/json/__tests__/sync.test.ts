import { describe, it, expect } from "vitest";
import { shouldPushToEditor, parseEditorText } from "../sync";

describe("json sync", () => {
  it("does not push when editor text already equals report", () => {
    const report = { id: "a", x: 1 };
    const text = JSON.stringify(report, null, 2);
    expect(shouldPushToEditor(text, report)).toBe(false);
    expect(shouldPushToEditor(text.replace("1", "2"), report)).toBe(true);
    expect(shouldPushToEditor("{ bad", report)).toBe(true);
  });
  it("parses valid json and reports syntax error", () => {
    expect(parseEditorText('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const r = parseEditorText("{a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON/);
  });
});
