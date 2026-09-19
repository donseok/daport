// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { preprocessScan, ImageInputError, MAX_IMAGE_BYTES, MAX_OUTPUT_BYTES } from "../scan";

/** 흰 바탕에 검은 가로줄 여러 개를 그린 이미지. angle만큼 기울여 내보낸다 */
async function ruled(angle: number, pad = 0): Promise<Buffer> {
  const lines = Array.from({ length: 20 }, (_, i) => `<rect x="60" y="${40 + i * 40}" width="680" height="10" fill="#000"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="#fff"/>${lines}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (angle !== 0) img = img.rotate(angle, { background: "#ffffff" });
  if (pad > 0) img = img.extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" });
  return img.png().toBuffer();
}

/** 완전 무작위 픽셀로 채운 PNG. JPEG 압축이 가장 안 먹는(고엔트로피) 케이스를 흉내낸다 */
async function randomNoisePng(width: number, height: number): Promise<Buffer> {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

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
 * IHDR에만 거대한 width/height를 적어 넣은, 실제 픽셀 데이터는 몇 바이트뿐인 가짜 PNG.
 * sharp의 metadata()는 헤더만 읽으므로 이 파일로 "전체 디코드 없이" 픽셀 한도 초과를
 * 판정하는지 검증할 수 있다(IDAT은 완전한 이미지를 담고 있지 않아도 metadata() 통과에는 문제없다)
 */
function fakeOversizedPng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: RGB
  const idat = zlib.deflateSync(Buffer.from([0]));   // 완전하지 않은 압축 데이터 — 헤더만 읽으면 문제되지 않는다
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

describe("preprocessScan", () => {
  it("기울어진 스캔의 각도를 1도 안쪽으로 잡아 되돌린다", async () => {
    const res = await preprocessScan(await ruled(3));
    expect(Math.abs(res.angle - 3)).toBeLessThanOrEqual(1);
    expect(res.mimeType).toBe("image/jpeg");
    expect(res.notes.join(" ")).toContain("기울기");
  }, 30_000);

  it("기울지 않은 이미지는 회전하지 않는다", async () => {
    const res = await preprocessScan(await ruled(0));
    expect(Math.abs(res.angle)).toBeLessThan(0.5);
  }, 30_000);

  it("흰 여백을 잘라내고 긴 변을 2000px 이하로 줄인다", async () => {
    const res = await preprocessScan(await ruled(0, 120));
    expect(res.width).toBeLessThanOrEqual(2000);
    expect(res.height).toBeLessThanOrEqual(2000);
    expect(res.height).toBeLessThan(900 + 240);      // 여백이 남지 않았다
  }, 30_000);

  it("이미지가 아니면 IMAGE_UNSUPPORTED", async () => {
    await expect(preprocessScan(Buffer.from("not an image"))).rejects.toMatchObject({ code: "IMAGE_UNSUPPORTED" });
  });

  it("한도를 넘는 바이트는 IMAGE_TOO_LARGE", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    await expect(preprocessScan(big)).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("픽셀 수가 한도를 넘으면 전체를 디코드하지 않고도 IMAGE_TOO_LARGE로 거절한다", async () => {
    const huge = fakeOversizedPng(10_000, 10_000);   // 1억 픽셀 선언, 실제 파일은 수십 바이트뿐
    const started = Date.now();
    await expect(preprocessScan(huge)).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(Date.now() - started).toBeLessThan(2_000);   // 헤더만 읽고 거절했다면 순식간에 끝난다
  });

  it("압축해도 출력 목표 용량을 못 맞추면 IMAGE_TOO_LARGE로 실패한다", async () => {
    const img = await ruled(0);
    await expect(preprocessScan(img, { maxOutputBytes: 500 })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  }, 30_000);

  it("고엔트로피 이미지도 출력 바이트가 용량 상한을 넘지 않는다", async () => {
    const noisy = await randomNoisePng(2000, 2000);
    const res = await preprocessScan(noisy);
    expect(res.data.byteLength).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  }, 30_000);
});
