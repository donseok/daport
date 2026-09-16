import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
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
  it("does not push over focused text that only lacks defaults or orders keys differently", () => {
    const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [
      { id: "b", type: "rect", x: 1, y: 1, w: 1, h: 1 },
    ]});
    // 사용자가 필수 필드만 입력했고, 커밋된 모델은 기본값이 채워져 텍스트가 다르다
    const typed = '{ "version": 1, "id": "r", "page": { "height": 100, "width": 100 }, "elements": [{"id":"b","type":"rect","x":1,"y":1,"w":1,"h":1}] }';
    expect(decideSync({ pendingEdit: false, editorText: typed, report, editorFocused: true })).toBe("skip");
    expect(decideSync({ pendingEdit: false, editorText: typed, report, editorFocused: false })).toBe("push");   // 포커스가 없으면 정리된 텍스트를 보인다
    expect(decideSync({ pendingEdit: false, editorText: typed.replace('"x":1', '"x":2'), report, editorFocused: true })).toBe("push");
    expect(decideSync({ pendingEdit: false, editorText: typed.replace('"id": "r"', '"id": "other"'), report, editorFocused: true })).toBe("push");
    expect(decideSync({ pendingEdit: false, editorText: "{ bad", report, editorFocused: true })).toBe("push");
  });
});
