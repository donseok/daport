// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { preprocessScan, ImageInputError, MAX_IMAGE_BYTES } from "../scan";

/** 흰 바탕에 검은 가로줄 여러 개를 그린 이미지. angle만큼 기울여 내보낸다 */
async function ruled(angle: number, pad = 0): Promise<Buffer> {
  const lines = Array.from({ length: 20 }, (_, i) => `<rect x="60" y="${40 + i * 40}" width="680" height="10" fill="#000"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="#fff"/>${lines}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (angle !== 0) img = img.rotate(angle, { background: "#ffffff" });
  if (pad > 0) img = img.extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" });
  return img.png().toBuffer();
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
    await expect(preprocessScan(big)).rejects.toBeInstanceOf(ImageInputError);
  });
});
