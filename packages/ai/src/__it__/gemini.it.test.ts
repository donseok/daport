import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { createGeminiClient, buildEditPrompt, validateEditPatch } from "../index";

const enabled = process.env.GEMINI_IT === "1" && !!process.env.GEMINI_API_KEY;

describe.skipIf(!enabled)("Gemini (real API)", () => {
  it("turns a short edit instruction into a valid patch", async () => {
    const client = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" });
    const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 210, height: 297 },
      elements: [{ id: "title", type: "text", x: 10, y: 10, w: 120, h: 10, value: "품질보증서" }] });
    const prompt = buildEditPrompt({ report, selection: ["title"], fields: {}, library: [], history: [] }, "제목을 '검사 성적서'로 바꾸고 글자를 가운데 정렬해");
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema });
    const { next, warnings } = validateEditPatch(report, raw);
    expect(warnings).toEqual([]);
    expect(next.elements[0]).toMatchObject({ value: "검사 성적서" });
  });
});
