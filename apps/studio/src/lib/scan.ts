import sharp, { type Sharp, type Metadata } from "sharp";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const LONG_EDGE = 2000;
const DESKEW_EDGE = 1000;
const MAX_ANGLE = 10;
const ANGLE_STEP = 0.5;

export class ImageInputError extends Error {
  constructor(readonly code: "IMAGE_TOO_LARGE" | "IMAGE_UNSUPPORTED", message: string) {
    super(message);
    this.name = "ImageInputError";
  }
}

export type ScanResult = { data: Buffer; mimeType: "image/jpeg"; width: number; height: number; angle: number; notes: string[] };

/** 행별 어두운 픽셀 수의 분산. 글줄이 수평일 때 최대가 된다 */
function rowVariance(gray: Buffer, width: number, height: number): number {
  const sums = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) s += 255 - gray[y * width + x];
    sums[y] = s;
  }
  let mean = 0;
  for (const s of sums) mean += s;
  mean /= height;
  let v = 0;
  for (const s of sums) v += (s - mean) ** 2;
  return v / height;
}

/**
 * -10°~+10°를 0.5° 간격으로 훑어 분산이 가장 큰 각도를 고른다.
 * 반환값은 이 각도로 `rotate()`했을 때 글줄이 수평이 되는 "보정 각도"다.
 */
async function estimateAngle(base: Sharp): Promise<number> {
  const small = await base.clone().greyscale().resize({ width: DESKEW_EDGE, height: DESKEW_EDGE, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  let best = 0;
  let bestScore = -1;
  for (let a = -MAX_ANGLE; a <= MAX_ANGLE; a += ANGLE_STEP) {
    const rotated = a === 0
      ? { data: small.data, info: small.info }
      : await sharp(small.data, { raw: { width: small.info.width, height: small.info.height, channels: small.info.channels } })
          .rotate(a, { background: "#ffffff" })
          .raw()
          .toBuffer({ resolveWithObject: true });
    const score = rowVariance(rotated.data, rotated.info.width, rotated.info.height);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * 스캔 전처리 (스펙 4.1): EXIF 회전 → 기울기 보정 → 여백 트림 → 리사이즈 → JPEG.
 * 메타데이터는 싣지 않는다(EXIF 위치 정보가 에셋에 남지 않게)
 */
export async function preprocessScan(input: Buffer): Promise<ScanResult> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageInputError("IMAGE_TOO_LARGE", "이미지가 20MB를 넘습니다");

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw new ImageInputError("IMAGE_UNSUPPORTED", "PNG 또는 JPEG 이미지만 올릴 수 있습니다");
  }
  if (meta.format !== "png" && meta.format !== "jpeg") throw new ImageInputError("IMAGE_UNSUPPORTED", "PNG 또는 JPEG 이미지만 올릴 수 있습니다");
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_IMAGE_PIXELS) throw new ImageInputError("IMAGE_TOO_LARGE", "이미지 픽셀 수가 한도를 넘습니다");

  const notes: string[] = [];
  const upright = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();   // 인자 없는 rotate가 EXIF 방향을 적용한다
  const correction = await estimateAngle(upright);
  const angle = -correction;   // 보고용 각도: 원본이 기울어진 방향과 부호가 같다

  let work = upright.clone();
  if (Math.abs(correction) >= ANGLE_STEP) {
    work = work.rotate(correction, { background: "#ffffff" });
    notes.push(`기울기 ${angle.toFixed(1)}도를 보정했습니다`);
  }

  const beforeTrim = await work.clone().toBuffer({ resolveWithObject: true });
  const trimmed = await work.clone().trim().toBuffer({ resolveWithObject: true }).catch(() => beforeTrim);
  const beforeArea = beforeTrim.info.width * beforeTrim.info.height;
  const trimArea = trimmed.info.width * trimmed.info.height;
  // 트림이 너무 많이 먹었으면(종이보다 어두운 배경 등) 버린다
  const chosen = trimArea >= beforeArea * 0.3 ? trimmed : beforeTrim;
  if (chosen === trimmed && trimArea < beforeArea) notes.push(`바깥 여백을 잘라냈습니다 (${trimmed.info.width}×${trimmed.info.height})`);

  const resized = sharp(chosen.data).resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true });
  let out = await resized.clone().jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (out.data.byteLength > MAX_OUTPUT_BYTES) out = await resized.clone().jpeg({ quality: 60 }).toBuffer({ resolveWithObject: true });
  if (out.data.byteLength > MAX_OUTPUT_BYTES) {
    out = await sharp(chosen.data).resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer({ resolveWithObject: true });
  }

  return { data: out.data, mimeType: "image/jpeg", width: out.info.width, height: out.info.height, angle, notes };
}
