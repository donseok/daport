// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import { FakeLlmClient } from "@daport/ai/testing";
import { LlmError } from "@daport/ai";
import { MAX_OUTPUT_BYTES } from "@/lib/scan";

let fake: FakeLlmClient;
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getLlmClient: () => fake }));
// preprocessScan은 기본적으로 실제 구현을 그대로 쓰되, 출력이 너무 큰 경로만 테스트별로 오버라이드한다
vi.mock("@/lib/scan", async (orig) => {
  const actual = await orig<typeof import("@/lib/scan")>();
  return { ...actual, preprocessScan: vi.fn(actual.preprocessScan) };
});
const { POST } = await import("../[id]/ai/import/route");
const { preprocessScan } = await import("@/lib/scan");

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
    // 호출 기록만 지운다(기본 구현은 유지) — 이전 테스트의 누적 호출이 다음 테스트의
    // toHaveBeenCalled 계열 단언에 섞여 들어가지 않게 한다
    vi.mocked(preprocessScan).mockClear();
  });

  it("요소·파라미터·설명·용지·스캔 배경을 돌려준다", async () => {
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", type: "text" });
    expect(body.elements[0].x).toBeCloseTo(21, 3);          // 100/1000 * 210
    expect(body.params).toEqual([{ name: "lotNo", type: "string" }]);
    expect(body.page).toMatchObject({ width: 210, height: 297 });   // 서버가 검증에 쓴 용지를 그대로 돌려준다(I1)
    expect(body.scan.src).toMatch(/^data:image\/jpeg;base64,/);    // 별도 저장소 없이 항상 data URL(I4)
    expect(typeof body.scan.angle).toBe("number");
    expect(JSON.stringify(body)).not.toMatch(/0-1000|시스템|프롬프트/);   // 프롬프트 비노출
    expect(fake.calls[0].images).toHaveLength(1);
    expect(fake.calls[0].images![0].mimeType).toBe("image/jpeg");        // 전처리 결과를 보낸다
  }, 30_000);

  it("모델의 warnings를 검증기 경고와 합쳐서 돌려준다(I2)", async () => {
    fake = new FakeLlmClient({
      elements: [JSON.stringify({ id: "t1", type: "text", x: 100, y: 100, w: 400, h: 40, value: "본문" })],
      explanation: "",
      warnings: ["도장 영역은 읽지 못했습니다", 42, null, "  "],   // 문자열이 아닌 항목은 버려야 한다
    });
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toContain("도장 영역은 읽지 못했습니다");
    expect(body.warnings).toContain("  ");   // 공백도 문자열이므로 버리지 않는다 — trim 대상이 아니라 길이만 본다
    expect(body.warnings).not.toContain(42);
  }, 30_000);

  it("모델 warnings는 20개까지만 남긴다(I2)", async () => {
    fake = new FakeLlmClient({
      elements: [JSON.stringify({ id: "t1", type: "text", x: 100, y: 100, w: 400, h: 40, value: "본문" })],
      explanation: "",
      warnings: Array.from({ length: 25 }, (_, i) => `경고${i}`),
    });
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    const body = await res.json();
    const modelWarnings = body.warnings.filter((w: string) => w.startsWith("경고"));
    expect(modelWarnings.length).toBe(20);   // 25개 중 20개까지만 남는다
  }, 30_000);

  it("모델 warnings의 각 문자열은 200자로 자른다(I2)", async () => {
    const long = "x".repeat(300);
    fake = new FakeLlmClient({
      elements: [JSON.stringify({ id: "t1", type: "text", x: 100, y: 100, w: 400, h: 40, value: "본문" })],
      explanation: "",
      warnings: [long],
    });
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    const body = await res.json();
    expect(body.warnings).not.toContain(long);       // 300자 원문 그대로는 없다
    expect(body.warnings.some((w: string) => w.length === 200)).toBe(true);   // 200자로 잘렸다
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

  it("전처리 결과가 출력 상한을 넘으면 배경 없이 200을 돌려준다(I4: 저장소를 두지 않는다)", async () => {
    vi.mocked(preprocessScan).mockResolvedValueOnce({
      data: Buffer.alloc(MAX_OUTPUT_BYTES + 1, 1),   // preprocessScan의 출력 상한을 넘는 결과를 흉내낸다
      mimeType: "image/jpeg",
      width: 400,
      height: 560,
      angle: 0,
      notes: [],
    });
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", type: "text" });   // 이미 검증한 결과는 버리지 않는다
    expect(body.scan.src).toBeNull();
  }, 30_000);
});
