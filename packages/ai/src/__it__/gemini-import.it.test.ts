import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { parseReport } from "@daport/core";
import { createGeminiClient, buildImportPrompt, validateImported } from "../index";

const enabled = process.env.GEMINI_IT === "1" && !!process.env.GEMINI_API_KEY;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * 흰 바탕에 검은 줄 하나(제목 자리)를 그린, 진짜로 디코드되는 작은 그레이스케일 PNG를 직접 만든다.
 * packages/ai에는 sharp 등 이미지 라이브러리가 없으므로(스튜디오 앱 전용) zlib만으로 최소 유효 PNG를 구성한다
 */
function tinyFormPng(width: number, height: number): Buffer {
  const rowBytes = 1 + width;   // 필터 바이트(0) + 그레이스케일 1바이트/픽셀
  const raw = Buffer.alloc(rowBytes * height, 0xff);
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0;   // 필터: None
  // 위쪽에 가로줄 하나를 검게 그려 "제목" 자리를 흉내낸다
  const titleY = Math.floor(height * 0.15);
  for (let x = 20; x < width - 20; x++) raw[titleY * rowBytes + 1 + x] = 0x00;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // color type: grayscale
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

describe.skipIf(!enabled)("Gemini (real API) — import", () => {
  it("작은 양식 이미지를 실제 프롬프트·스키마로 보내 유효한 요소 제안을 받는다(스펙 §10·§11.1)", async () => {
    const client = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" });
    const page = { width: 210, height: 297 };
    const png = tinyFormPng(400, 560);
    const prompt = buildImportPrompt(page, { mimeType: "image/png", data: png.toString("base64") });
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, images: prompt.images });

    const report = parseReport({ id: "r", name: "R", version: 1, page, elements: [] });
    const result = validateImported(report, raw, page);
    expect(result.elements.length).toBeGreaterThan(0);
  }, 120_000);
});
