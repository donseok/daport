import { describe, it, expect } from "vitest";
import { shouldPushToEditor, parseEditorText, decideSync } from "../sync";

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
  it("flushes a pending editor edit instead of pushing store text over it", () => {
    const report = { id: "a", x: 1 };
    const same = JSON.stringify(report, null, 2);
    // 디바운스 중인 입력이 있으면 편집기 내용이 스토어와 같든 다르든, 깨진 JSON이든 먼저 스토어로 보낸다
    expect(decideSync({ pendingEdit: true, editorText: same.replace("1", "2"), report })).toBe("flush");
    expect(decideSync({ pendingEdit: true, editorText: "{ bad", report })).toBe("flush");
    expect(decideSync({ pendingEdit: true, editorText: same, report })).toBe("flush");
    // 대기 중인 입력이 없으면 내용이 다를 때만 스토어 텍스트를 넣는다
    expect(decideSync({ pendingEdit: false, editorText: same.replace("1", "2"), report })).toBe("push");
    expect(decideSync({ pendingEdit: false, editorText: "{ bad", report })).toBe("push");
    expect(decideSync({ pendingEdit: false, editorText: JSON.stringify(report), report })).toBe("skip");
  });
});
