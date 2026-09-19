// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import { FakeLlmClient } from "@daport/ai/testing";
import { LlmError } from "@daport/ai";

let fake: FakeLlmClient;
vi.mock("@/lib/ai", async (orig) => ({ ...(await orig<typeof import("@/lib/ai")>()), getLlmClient: () => fake }));
// assetStorageEnabled·putAsset·preprocessScan은 기본적으로 실제 구현을 그대로 쓰되, 저장 실패·큰 출력
// 같은 예외 경로만 테스트별로 vi.fn 오버라이드로 흉내낸다
vi.mock("@/lib/asset-io", async (orig) => {
  const actual = await orig<typeof import("@/lib/asset-io")>();
  return { ...actual, assetStorageEnabled: vi.fn(actual.assetStorageEnabled), putAsset: vi.fn(actual.putAsset) };
});
vi.mock("@/lib/scan", async (orig) => {
  const actual = await orig<typeof import("@/lib/scan")>();
  return { ...actual, preprocessScan: vi.fn(actual.preprocessScan) };
});
const { POST } = await import("../[id]/ai/import/route");
const { assetStorageEnabled, putAsset } = await import("@/lib/asset-io");
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
    vi.mocked(assetStorageEnabled).mockClear();
    vi.mocked(putAsset).mockClear();
    vi.mocked(preprocessScan).mockClear();
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

  it("스캔 배경 저장이 실패해도 이관 결과는 200을 유지하고 배경 경고만 남긴다", async () => {
    vi.mocked(assetStorageEnabled).mockReturnValueOnce(true);
    vi.mocked(putAsset).mockRejectedValueOnce(new Error("blob 5xx"));
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", type: "text" });         // 이미 검증한 결과는 버리지 않는다
    expect(body.params).toEqual([{ name: "lotNo", type: "string" }]);
    expect(body.scan.src).toBeNull();
    expect(body.warnings.some((w: string) => w.includes("배경"))).toBe(true);
  }, 30_000);

  it("저장소가 없고 전처리 결과가 data URL 상한을 넘으면 배경 없이 200을 돌려준다", async () => {
    vi.mocked(assetStorageEnabled).mockReturnValueOnce(false);
    vi.mocked(preprocessScan).mockResolvedValueOnce({
      data: Buffer.alloc(2 * 1024 * 1024, 1),   // 1MB(data URL 상한)를 넘는 전처리 결과를 흉내낸다
      mimeType: "image/jpeg",
      width: 400,
      height: 560,
      angle: 0,
      notes: [],
    });
    const res = await post({ report, image: { mimeType: "image/png", dataBase64: await png() }, preset: { width: 210, height: 297 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.elements[0]).toMatchObject({ id: "t1", type: "text" });
    expect(body.scan.src).toBeNull();
    expect(putAsset).not.toHaveBeenCalled();
  }, 30_000);
});
