import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { buildEditPrompt, buildGeneratePrompt, EDIT_RESPONSE_SCHEMA, GENERATE_RESPONSE_SCHEMA, estimateTokens, MAX_CONTEXT_TOKENS } from "../index";

const base = { id: "r", name: "R", version: 1, page: { width: 210, height: 297 },
  params: [{ name: "lot", type: "string" }],
  elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "제목" }] };
const ctx = {
  report: parseReport(base),
  selection: ["t1"],
  fields: { items: [{ name: "NO", path: "NO", type: "string" as const }] },
  library: [{ id: "header", name: "회사 헤더", version: 2, w: 190, h: 20, props: [] }],
  history: [{ role: "user" as const, text: "이전 지시" }, { role: "assistant" as const, text: "이전 답" }],
};

describe("buildEditPrompt", () => {
  it("puts the rules in system and the context+instruction in the last user message", () => {
    const p = buildEditPrompt(ctx, "제목을 '검사 성적서'로 바꿔");
    expect(p.system).toContain("JSON Patch");
    expect(p.system).toContain("/elements");
    expect(p.system).toContain("/output");                       // 금지 경로 목록
    expect(p.system).toContain("text:");                          // 축약 스키마가 들어 있다
    const last = p.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.text).toContain("page 210×297mm");                // 페이지 크기·여백
    expect(last.text).toContain("t1 text 10,10 80×8");            // 압축된 모델
    expect(last.text).toContain("items.NO: string");
    expect(last.text).toContain("header 회사 헤더 v2");
    expect(last.text).toContain("선택: t1");
    expect(last.text).toContain("params: lot(string)");
    expect(last.text).toContain("제목을 '검사 성적서'로 바꿔");
    expect(p.messages.slice(0, -1).map((m) => m.role)).toEqual(["user", "model"]);   // 이력이 앞에
    expect(p.schema).toBe(EDIT_RESPONSE_SCHEMA);
    expect(p.truncated).toEqual([]);
  });
  it("truncates history first, then the element tree, and records what it cut", () => {
    const many = parseReport({ ...base, elements: Array.from({ length: 4_000 }, (_, i) => ({ id: `t${i}`, type: "text", x: 0, y: 0, w: 10, h: 5, value: "가".repeat(30) })) });
    const p = buildEditPrompt({ ...ctx, report: many, history: [{ role: "user", text: "가".repeat(5_000) }] }, "정리해");
    expect(p.truncated.length).toBeGreaterThan(0);
    expect(p.truncated).toContain("history");
    expect(estimateTokens(p.system + p.messages.map((m) => m.text).join(""))).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
  });
});

describe("buildGeneratePrompt", () => {
  it("asks for a full element list and carries the brief", () => {
    const p = buildGeneratePrompt({ report: parseReport({ ...base, elements: [] }), fields: ctx.fields, library: ctx.library }, "품질보증서: 헤더, 품목 표, 서명란");
    expect(p.system).toContain("elements");
    expect(p.system).toContain("라이브러리");                      // 컴포넌트 우선 사용 지시
    expect(p.system).toContain("여백");                            // 배치 규칙이 여백을 반영한다
    expect(p.system).toContain("width - marginRight");             // 여백을 뺀 경계값
    expect(p.messages.at(-1)!.text).toContain("page 210×297mm");   // 페이지 크기·여백
    expect(p.messages.at(-1)!.text).toContain("품질보증서: 헤더, 품목 표, 서명란");
    expect(p.schema).toBe(GENERATE_RESPONSE_SCHEMA);
  });
  it("never blames history for truncation, since generate carries none", () => {
    const many = parseReport({ ...base, elements: Array.from({ length: 4_000 }, (_, i) => ({ id: `t${i}`, type: "text", x: 0, y: 0, w: 10, h: 5, value: "가".repeat(30) })) });
    const p = buildGeneratePrompt({ report: many, fields: ctx.fields, library: ctx.library }, "정리해");
    expect(p.truncated.length).toBeGreaterThan(0);
    expect(p.truncated).not.toContain("history");
    expect(estimateTokens(p.system + p.messages.map((m) => m.text).join(""))).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
  });
});

describe("response schemas", () => {
  it("are Gemini-compatible: object/array/string only, no oneOf or $ref, value carried as a JSON string", () => {
    const json = JSON.stringify([EDIT_RESPONSE_SCHEMA, GENERATE_RESPONSE_SCHEMA]);
    expect(json).not.toContain("oneOf"); expect(json).not.toContain("$ref"); expect(json).not.toContain("anyOf");
    const patchItem = (EDIT_RESPONSE_SCHEMA as any).properties.patch.items;
    expect(patchItem.properties.value.type).toBe("string");
    expect(patchItem.properties.op.enum).toEqual(["add", "remove", "replace", "move", "copy"]);
    expect(patchItem.required).toEqual(["op", "path"]);
    expect((GENERATE_RESPONSE_SCHEMA as any).properties.elements.items.type).toBe("string");
  });
});
