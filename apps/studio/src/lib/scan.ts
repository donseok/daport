import sharp, { type Sharp, type Metadata, type OutputInfo } from "sharp";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const LONG_EDGE = 2000;
const DESKEW_EDGE = 1000;
const MAX_ANGLE = 10;
const ANGLE_STEP = 0.5;

/** sharp 자체 픽셀 한도는 끄고 우리 한도(MAX_IMAGE_PIXELS)로 직접 검사한다. 그래야 초과 시 sharp가
 *  먼저 예외를 던져 IMAGE_UNSUPPORTED로 오분류되지 않고, 사양대로 IMAGE_TOO_LARGE(413)로 나간다.
 *  metadata()는 헤더만 읽으므로 이 설정으로도 검사 자체는 여전히 가볍다 */
const NO_PIXEL_LIMIT = { limitInputPixels: false } as const;

/** 화질 → 크기 순으로 낮춰가며 목표 용량 안에 들도록 인코딩한다 */
const OUTPUT_STEPS: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: LONG_EDGE, quality: 80 },
  { edge: LONG_EDGE, quality: 60 },
  { edge: 1500, quality: 60 },
  { edge: 1200, quality: 45 },
  { edge: 900, quality: 35 },
];

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
 * 화질 → 크기 순으로 OUTPUT_STEPS를 훑어 maxBytes 이하가 될 때까지 JPEG로 인코딩한다.
 * 이관 라우트의 data URL 폴백과 에셋 저장소 상한이 이 한도를 전제로 하므로, 끝까지 못 줄이면
 * 애매하게 큰 파일을 돌려주는 대신 명확히 실패한다
 */
async function encodeWithinBudget(pixels: Buffer, maxBytes: number): Promise<{ data: Buffer; info: OutputInfo }> {
  let out: { data: Buffer; info: OutputInfo } | undefined;
  for (const step of OUTPUT_STEPS) {
    out = await sharp(pixels).resize({ width: step.edge, height: step.edge, fit: "inside", withoutEnlargement: true }).jpeg({ quality: step.quality }).toBuffer({ resolveWithObject: true });
    if (out.data.byteLength <= maxBytes) return out;
  }
  const mb = (maxBytes / (1024 * 1024)).toFixed(1);
  throw new ImageInputError("IMAGE_TOO_LARGE", `이미지를 압축해도 ${mb}MB 한도를 넘습니다. 더 단순하거나 작은 이미지로 다시 시도하세요`);
}

/**
 * 스캔 전처리 (스펙 4.1): EXIF 회전 → 기울기 보정 → 여백 트림 → 리사이즈 → JPEG.
 * 메타데이터는 싣지 않는다(EXIF 위치 정보가 에셋에 남지 않게)
 */
export async function preprocessScan(input: Buffer, opts?: { maxOutputBytes?: number }): Promise<ScanResult> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageInputError("IMAGE_TOO_LARGE", "이미지가 20MB를 넘습니다");

  let meta: Metadata;
  try {
    meta = await sharp(input, NO_PIXEL_LIMIT).metadata();
  } catch {
    throw new ImageInputError("IMAGE_UNSUPPORTED", "PNG 또는 JPEG 이미지만 올릴 수 있습니다");
  }
  if (meta.format !== "png" && meta.format !== "jpeg") throw new ImageInputError("IMAGE_UNSUPPORTED", "PNG 또는 JPEG 이미지만 올릴 수 있습니다");
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_IMAGE_PIXELS) throw new ImageInputError("IMAGE_TOO_LARGE", "이미지 픽셀 수가 한도를 넘습니다");

  const notes: string[] = [];
  // sharp 파이프라인은 clone한 뒤 toBuffer()할 때마다 원본 바이트부터 다시 디코드한다(중간 결과를
  // 재사용하지 않는다). 원본 해상도(최대 50MP)로 기울기 추정·트림 비교·인코딩을 각각 따로 디코드하면
  // 그 수만큼 전체 픽셀을 반복해서 들고 있게 된다. 그래서 EXIF 회전 직후 딱 한 번만 작업 해상도
  // (LONG_EDGE)로 실제 버퍼를 못박아 두고, 이후 기울기 보정·트림·트림 전후 비교는 전부 이 작은
  // 버퍼 위에서만 돈다. withoutEnlargement라 이미 더 작은 이미지는 그대로 지나간다
  const base = await sharp(input, NO_PIXEL_LIMIT)
    .rotate()   // 인자 없는 rotate가 EXIF 방향을 적용한다
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const correction = await estimateAngle(sharp(base.data, NO_PIXEL_LIMIT));
  const angle = -correction;   // 보고용 각도: 원본이 기울어진 방향과 부호가 같다

  // 회전이 필요 없으면 base를 그대로 쓴다 — 그래야 불필요한 재인코딩 한 번을 더 줄인다
  let work = { data: base.data, info: base.info };
  if (Math.abs(correction) >= ANGLE_STEP) {
    work = await sharp(base.data, NO_PIXEL_LIMIT).rotate(correction, { background: "#ffffff" }).toBuffer({ resolveWithObject: true });
    notes.push(`기울기 보정을 위해 ${correction.toFixed(1)}도 회전을 적용했습니다`);   // 실제 적용한 회전값을 남긴다(보고용 angle과 부호가 다르다)
  }

  // 트림 전 면적은 work의 info에 이미 있으므로(위에서 한 번만 materialize) 비교용으로 또 디코드할 필요가 없다
  const beforeArea = work.info.width * work.info.height;
  const trimmed = await sharp(work.data, NO_PIXEL_LIMIT).trim().toBuffer({ resolveWithObject: true }).catch(() => work);
  const trimArea = trimmed.info.width * trimmed.info.height;
  // 트림이 너무 많이 먹었으면(종이보다 어두운 배경 등) 버린다
  const chosen = trimArea >= beforeArea * 0.3 ? trimmed : work;
  if (chosen === trimmed && trimArea < beforeArea) notes.push(`바깥 여백을 잘라냈습니다 (${trimmed.info.width}×${trimmed.info.height})`);

  const out = await encodeWithinBudget(chosen.data, opts?.maxOutputBytes ?? MAX_OUTPUT_BYTES);

  return { data: out.data, mimeType: "image/jpeg", width: out.info.width, height: out.info.height, angle, notes };
}
