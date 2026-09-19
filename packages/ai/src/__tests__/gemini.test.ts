import { describe, it, expect, beforeEach, vi } from "vitest";

// SDK 경계에서 가짜로 바꾼다. 실제 호출은 __it__ (GEMINI_IT=1)
const generateContent = vi.fn();
const ctor = vi.fn();
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; constructor(o: unknown) { ctor(o); } } }));
const { createGeminiClient, LlmError } = await import("../index");

const input = { system: "SYS", messages: [{ role: "user" as const, text: "이전" }, { role: "model" as const, text: "답" }, { role: "user" as const, text: "지시" }], schema: { type: "object" } };
const client = () => createGeminiClient({ apiKey: "AIza-secret-key", model: "gemini-3.8-flash", timeoutMs: 1_000 });

beforeEach(() => { generateContent.mockReset(); ctor.mockReset(); });

describe("createGeminiClient", () => {
  it("sends system instruction, roles, JSON mime type, schema and low temperature; parses the JSON text", async () => {
    generateContent.mockResolvedValue({ text: '{"patch":[],"explanation":"ok"}' });
    expect(await client().complete(input)).toEqual({ patch: [], explanation: "ok" });
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "AIza-secret-key" }));
    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe("gemini-3.8-flash");
    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "이전" }] }, { role: "model", parts: [{ text: "답" }] }, { role: "user", parts: [{ text: "지시" }] },
    ]);
    expect(req.config).toMatchObject({ systemInstruction: "SYS", responseMimeType: "application/json", responseSchema: { type: "object" }, temperature: 0.2, maxOutputTokens: 8192 });
    expect(req.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("retries once with a correction turn on unparseable output, then gives LLM_BAD_OUTPUT", async () => {
    generateContent.mockResolvedValueOnce({ text: "not json" }).mockResolvedValueOnce({ text: '{"a":1}' });
    expect(await client().complete(input)).toEqual({ a: 1 });
    expect(generateContent).toHaveBeenCalledTimes(2);
    const retry = generateContent.mock.calls[1][0].contents;
    expect(retry.at(-1).parts[0].text).toMatch(/형식/);
    generateContent.mockReset().mockResolvedValue({ text: "" });
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_BAD_OUTPUT" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("shares one deadline signal across the bad-output retry instead of a fresh timeout per attempt", async () => {
    generateContent.mockResolvedValueOnce({ text: "not json" }).mockResolvedValueOnce({ text: '{"a":1}' });
    await client().complete(input);
    const firstSignal = generateContent.mock.calls[0][0].config.abortSignal;
    const secondSignal = generateContent.mock.calls[1][0].config.abortSignal;
    expect(secondSignal).toBe(firstSignal);   // I4: 60s 예산이 재시도로 2배가 되면 안 된다
  });
  it("maps SDK errors by status and masks the api key", async () => {
    const err = (status: number, message = `status ${status} key=AIza-secret-key`) => Object.assign(new Error(message), { status });
    generateContent.mockRejectedValueOnce(err(429));
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_RATE_LIMIT" });
    generateContent.mockRejectedValueOnce(err(403));
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED" });
    generateContent.mockRejectedValueOnce(err(500));
    let e: unknown;
    try { await client().complete(input); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(LlmError);
    if (!(e instanceof LlmError)) throw e;
    expect(e.code).toBe("LLM_ERROR");
    expect(e.message).not.toContain("AIza-secret-key"); expect(e.message).toContain("***");
    generateContent.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(client().complete(input)).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });
  it("refuses to construct without an api key", () => {
    expect(() => createGeminiClient({ apiKey: "", model: "m" })).toThrow(expect.objectContaining({ code: "LLM_NOT_CONFIGURED" }));
  });
  it("images를 마지막 user 파트에 inlineData로 싣는다", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"ok":1}' });
    await client().complete({
      system: "s", messages: [{ role: "user", text: "이 이미지를 읽어라" }], schema: {},
      images: [{ mimeType: "image/jpeg", data: "QUJD" }],
    });
    const req = generateContent.mock.calls[0][0];
    const parts = req.contents.at(-1).parts;
    expect(parts[0]).toEqual({ text: "이 이미지를 읽어라" });
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
  });
  it("images가 없으면 파트는 텍스트 하나뿐이다", async () => {
    generateContent.mockResolvedValueOnce({ text: '{"ok":1}' });
    await client().complete({ system: "s", messages: [{ role: "user", text: "t" }], schema: {} });
    expect(generateContent.mock.calls[0][0].contents.at(-1).parts).toEqual([{ text: "t" }]);
  });
});
