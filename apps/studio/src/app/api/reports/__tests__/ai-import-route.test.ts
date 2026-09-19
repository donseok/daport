// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import { FakeLlmClient } from "@daport/ai/testing";
import { LlmError } from "@daport/ai";

let fake: FakeLlmClient;
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getLlmClient: () => fake }));
const { POST } = await import("../[id]/ai/import/route");

const ctx = { params: Promise.resolve({ id: "r" }) };
const report = { id: "r", name: "R", version: 1, page: { width: 210, height: 297 }, elements: [] };

async function png(): Promise<string> {
  const buf = await sharp({ create: { width: 400, height: 560, channels: 3, background: "#ffffff" } }).png().toBuffer();
  return buf.toString("base64");
}

const post = async (body: unknown) =>
  POST(new Request("http://localhost/api/reports/r/ai/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);

describe("POST ai/import", () => {
  beforeEach(() => {
    fake = new FakeLlmClient({
      elements: [JSON.stringify({ id: "t1", type: "text", x: 100, y: 100, w: 400, h: 40, value: "{{ params.lotNo }}" })],
      params: [JSON.stringify({ name: "lotNo", type: "string" })],
      explanation: "제목과 값 칸을 옮겼습니다",
      warnings: [],
    });
  });

  it("요소·파라미터·설명·스캔 에셋을 돌려준다", async () => {
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", type: "text" });
    expect(body.elements[0].x).toBeCloseTo(21, 3);          // 100/1000 * 210
    expect(body.params).toEqual([{ name: "lotNo", type: "string" }]);
    expect(body.scan.src).toMatch(/^(asset:\/\/|data:image\/jpeg;base64,)/);   // 저장소가 없으면 data URL
    expect(typeof body.scan.angle).toBe("number");
    expect(JSON.stringify(body)).not.toMatch(/0-1000|시스템|프롬프트/);   // 프롬프트 비노출
    expect(fake.calls[0].images).toHaveLength(1);
    expect(fake.calls[0].images![0].mimeType).toBe("image/jpeg");        // 전처리 결과를 보낸다
  }, 30_000);

  it("요소가 있는 레포트는 400 AI_NOT_EMPTY", async () => {
    const withEl = { ...report, elements: [{ id: "x", type: "text", x: 0, y: 0, w: 10, h: 10, value: "a" }] };
    const res = await post({ report: withEl, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("AI_NOT_EMPTY");
  }, 30_000);

  it("이미지가 아니면 415, 너무 크면 413", async () => {
    const bad = await post({ report, image: { mimeType: "image/png", dataBase64: Buffer.from("nope").toString("base64") }, preset: { width: 210, height: 297 } });
    expect(bad.status).toBe(415);
    expect((await bad.json()).code).toBe("IMAGE_UNSUPPORTED");

    const big = await post({ report, image: { mimeType: "image/png", dataBase64: Buffer.alloc(21 * 1024 * 1024).toString("base64") }, preset: { width: 210, height: 297 } });
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe("IMAGE_TOO_LARGE");
  }, 30_000);

  it("검증 실패는 400 AI_INVALID_IMPORT, LlmError는 5단계 표대로", async () => {
    fake = new FakeLlmClient({ explanation: "" });   // elements 없음
    const bad = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("AI_INVALID_IMPORT");

    fake = new FakeLlmClient(() => { throw new LlmError("LLM_TIMEOUT", "m"); });
    const slow = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(slow.status).toBe(504);
    expect((await slow.json()).code).toBe("AI_TIMEOUT");
  }, 30_000);

  it("클라이언트가 없으면 503", async () => {
    fake = null as never;
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("AI_NOT_CONFIGURED");
  }, 30_000);
});
