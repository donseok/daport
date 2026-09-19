import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { buildImportPrompt, validateImported } from "@daport/ai";
import { readJsonBody } from "@/lib/body";
import { getLlmClient, importErrorResponse } from "@/lib/ai";
import { preprocessScan, MAX_IMAGE_BYTES } from "@/lib/scan";
import { assetStorageEnabled, putAsset } from "@/lib/asset-io";
import { randomUUID } from "node:crypto";

export const maxDuration = 120;

// base64 인코딩은 원본보다 약 4/3배 부풀고 JSON 본문이 그걸 감싼다. readJsonBody의 공용 상한(MAX_BODY_BYTES)을
// 그대로 쓰면 한도를 살짝 넘는 이미지가 preprocessScan의 IMAGE_TOO_LARGE가 아니라 본문 파싱 단계에서
// 코드 없는 413으로 막혀버린다. 이 라우트만 이미지 상한에 맞춰 넉넉히 잡는다
const MAX_IMPORT_BODY_BYTES = MAX_IMAGE_BYTES * 2;

const DEFAULT_IMPORT_TIMEOUT_MS = 90_000;

/** 이관 요청에만 적용할 타임아웃(스펙 5.2). 이미지 인식은 편집·생성보다 오래 걸린다 */
function importTimeoutMs(): number {
  const v = Number(process.env.AI_IMPORT_TIMEOUT_MS);
  return v > 0 ? v : DEFAULT_IMPORT_TIMEOUT_MS;
}

/** 스캔 이미지 → 요소 제안 (스펙 7장). 빈 레포트에서만 시작한다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await params;   // 라우트 서명을 맞추려고 받는다 — 레포트 id는 본문의 report.id를 쓴다
  const parsed = await readJsonBody(req, MAX_IMPORT_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;
  const client = getLlmClient();
  if (!client) return NextResponse.json({ error: "서버에 GEMINI_API_KEY를 설정하세요", code: "AI_NOT_CONFIGURED" }, { status: 503 });

  const started = Date.now();
  try {
    const report = parseReport(b.report);
    if (report.elements.length > 0) return NextResponse.json({ error: "빈 레포트에서만 이관할 수 있습니다", code: "AI_NOT_EMPTY" }, { status: 400 });

    const image = b.image as { dataBase64?: unknown } | undefined;
    if (!image || typeof image.dataBase64 !== "string") return NextResponse.json({ error: "이미지를 올리세요", code: "IMAGE_UNSUPPORTED" }, { status: 415 });
    const scan = await preprocessScan(Buffer.from(image.dataBase64, "base64"));

    const preset = b.preset as { width?: unknown; height?: unknown } | undefined;
    const page = {
      width: typeof preset?.width === "number" && preset.width > 0 ? preset.width : report.page.width,
      height: typeof preset?.height === "number" && preset.height > 0 ? preset.height : report.page.height,
    };

    const prompt = buildImportPrompt(page, { mimeType: scan.mimeType, data: scan.data.toString("base64") });
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, images: prompt.images, signal: req.signal, timeoutMs: importTimeoutMs() });
    const result = validateImported({ ...report, page: { ...report.page, ...page } }, raw, page);

    // 에셋 저장소는 Blob 토큰이 있을 때만 쓴다. 개발·E2E에는 토큰이 없어 작은 이미지는 data URL로 돌려준다.
    // 저장 자체(일시적 5xx, 쿼터 초과 등)가 실패해도 이미 검증을 통과한 요소·파라미터를 버리면 안 된다 —
    // 스캔은 대조용 배경일 뿐이라 저장에 실패하면 배경 없이 200으로 돌려주고 경고만 남긴다
    let src: string | null;
    let storeFailed = false;
    try {
      src = await storeScan(scan);
    } catch (e) {
      console.warn("[ai] 스캔 배경 저장 실패", e);
      src = null;
      storeFailed = true;
    }
    const ratio = scan.width / scan.height;
    const target = page.width / page.height;
    const warnings = [...scan.notes, ...result.warnings];
    if (storeFailed) warnings.push("스캔 배경 이미지를 저장하지 못해 대조 화면 없이 진행합니다");
    if (Math.abs(ratio - target) / target > 0.05) warnings.push("이미지 비율이 선택한 용지와 5% 넘게 달라 요소 위치가 늘어났을 수 있습니다");

    const explanation = typeof (raw as { explanation?: unknown }).explanation === "string" ? (raw as { explanation: string }).explanation : "";
    console.log(`[ai] ts=${new Date().toISOString()} id=${report.id} kind=import ms=${Date.now() - started} px=${scan.width}x${scan.height} elements=${result.elements.length}`);
    return NextResponse.json({ elements: result.elements, params: result.params, datasets: result.datasets, explanation, warnings, scan: { src, angle: scan.angle } });
  } catch (e) {
    return importErrorResponse(e);
  }
}

const MAX_DATA_URL_BYTES = 1024 * 1024;

/** 전처리본을 어디에 둘지 정한다. Blob 토큰이 있으면 에셋으로, 없으면 작은 이미지에 한해 data URL로 */
async function storeScan(scan: { data: Buffer; mimeType: "image/jpeg" }): Promise<string | null> {
  if (assetStorageEnabled()) {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    await putAsset({ id, name: "scan.jpg", mime: scan.mimeType, data: new Uint8Array(scan.data) });
    return `asset://${id}`;
  }
  if (scan.data.byteLength <= MAX_DATA_URL_BYTES) return `data:${scan.mimeType};base64,${scan.data.toString("base64")}`;
  return null;   // 저장할 곳이 없고 본문에 싣기엔 크다 — 대조 배경 없이 진행한다
}
