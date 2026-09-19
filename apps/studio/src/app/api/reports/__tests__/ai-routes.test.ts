// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeLlmClient } from "@daport/ai/testing";
import { LlmError } from "@daport/ai";

let fake: FakeLlmClient;
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getLlmClient: () => fake }));
const { POST: edit } = await import("../[id]/ai/edit/route");
const { POST: generate } = await import("../[id]/ai/generate/route");

const ctx = { params: Promise.resolve({ id: "r" }) };
const post = (fn: typeof edit, body: unknown) => fn(new Request("http://localhost/api/reports/r/ai/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
const report = { id: "r", name: "R", version: 1, page: { width: 210, height: 297 }, elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "제목" }] };
const op = (o: string, path: string, value: unknown) => ({ op: o, path, value: JSON.stringify(value) });

afterEach(() => { vi.restoreAllMocks(); });

describe("POST ai/edit", () => {
  beforeEach(() => { fake = new FakeLlmClient({ patch: [op("replace", "/elements/0/value", "검사 성적서"), op("replace", "/output/kind", "label")], explanation: "제목을 바꿨습니다" }); });
  it("returns the validated patch, explanation and warnings; never the prompt or raw output", async () => {
    const res = await post(edit, { report, instruction: "제목 바꿔", selection: ["t1"], history: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patch).toEqual([{ op: "replace", path: "/elements/0/value", value: "검사 성적서" }]);
    expect(body.explanation).toBe("제목을 바꿨습니다");
    expect(body.warnings.join(" ")).toMatch(/\/output/);
    expect(JSON.stringify(body)).not.toMatch(/JSON Patch|허용 경로|system/);   // 프롬프트 원문 비노출
    expect(fake.calls[0].messages.at(-1)!.text).toContain("제목 바꿔");
  });
  it("400 AI_INPUT_TOO_LONG, 400 AI_INPUT_EMPTY, 400 AI_INVALID_PATCH, and the LlmError mapping", async () => {
    const tooLong = await post(edit, { report, instruction: "가".repeat(2001), selection: [], history: [] });
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).code).toBe("AI_INPUT_TOO_LONG");
    const empty = await post(edit, { report, instruction: "  ", selection: [], history: [] });
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe("AI_INPUT_EMPTY");
    fake = new FakeLlmClient({ patch: [op("replace", "/elements/0/w", -1)], explanation: "" });
    const bad = await post(edit, { report, instruction: "x", selection: [], history: [] });
    expect(bad.status).toBe(400); expect((await bad.json()).code).toBe("AI_INVALID_PATCH");
    const cases: [string, number, string][] = [["LLM_RATE_LIMIT", 429, "AI_RATE_LIMIT"], ["LLM_TIMEOUT", 504, "AI_TIMEOUT"], ["LLM_BAD_OUTPUT", 502, "AI_BAD_OUTPUT"], ["LLM_ERROR", 502, "AI_ERROR"], ["LLM_NOT_CONFIGURED", 503, "AI_NOT_CONFIGURED"]];
    for (const [code, status, out] of cases) {
      fake = new FakeLlmClient(() => { throw new LlmError(code as never, "m"); });
      const r = await post(edit, { report, instruction: "x", selection: [], history: [] });
      expect(r.status).toBe(status); expect((await r.json()).code).toBe(out);
    }
  });
  it("never forwards the provider's own LLM_ERROR message to the client", async () => {
    fake = new FakeLlmClient(() => { throw new LlmError("LLM_ERROR", "invalid argument: field system quota-project=daport-prod model=gemini-3.8-flash"); });
    const r = await post(edit, { report, instruction: "x", selection: [], history: [] });
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.code).toBe("AI_ERROR");
    expect(body.error).not.toMatch(/quota-project|gemini-3\.8-flash/);   // I2: 502 사유 문구만
  });
  it("drops an inapplicable op end to end and returns only the surviving ops (C1)", async () => {
    fake = new FakeLlmClient({ patch: [op("replace", "/elements/9/value", "x"), op("replace", "/elements/0/value", "ok")], explanation: "e" });
    const res = await post(edit, { report, instruction: "x", selection: [], history: [] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patch).toEqual([{ op: "replace", path: "/elements/0/value", value: "ok" }]);
    expect(body.warnings.some((w: string) => w.includes("/elements/9/value"))).toBe(true);
  });
  it("503 AI_NOT_CONFIGURED when there is no client", async () => {
    fake = null as never;
    const r = await post(edit, { report, instruction: "x", selection: [], history: [] });
    expect(r.status).toBe(503); expect((await r.json()).code).toBe("AI_NOT_CONFIGURED");
  });
});

describe("POST ai/generate", () => {
  it("400 AI_INPUT_EMPTY for an empty or blank brief", async () => {
    const res = await post(generate, { report: { ...report, elements: [] }, brief: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("AI_INPUT_EMPTY");
  });
  it("400 AI_NOT_EMPTY for a report with elements; returns elements for an empty one", async () => {
    fake = new FakeLlmClient({ elements: [JSON.stringify({ id: "t1", type: "text", x: 10, y: 10, w: 80, h: 8, value: "품질보증서" })], explanation: "생성" });
    const notEmpty = await post(generate, { report, brief: "품질보증서" });
    expect(notEmpty.status).toBe(400); expect((await notEmpty.json()).code).toBe("AI_NOT_EMPTY");
    const ok = await post(generate, { report: { ...report, elements: [] }, brief: "품질보증서" });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", value: "품질보증서" });
    expect(body.components).toEqual({});
  });
});
