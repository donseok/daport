import { NextResponse } from "next/server";
import { parseReport, type Report } from "@daport/core";
import { buildImportPrompt, validateImported } from "@daport/ai";
import { readJsonBody } from "@/lib/body";
import { getLlmClient, importErrorResponse } from "@/lib/ai";
import { preprocessScan, MAX_IMAGE_BYTES, MAX_OUTPUT_BYTES } from "@/lib/scan";

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

const MAX_MODEL_WARNINGS = 20;
const MAX_MODEL_WARNING_LEN = 200;

/**
 * 모델이 낸 warnings(스펙 5.2·5.3: 읽지 못한 영역, 120개 초과로 버린 요소 등)를 병합한다.
 * 이미지 내용에 따라 모델이 마음대로 채우는 문자열이라 개수·길이를 방어적으로 자른다
 */
function sanitizeModelWarnings(raw: unknown): string[] {
  const list = (raw as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const w of list) {
    if (typeof w !== "string") continue;
    out.push(w.length > MAX_MODEL_WARNING_LEN ? w.slice(0, MAX_MODEL_WARNING_LEN) : w);
    if (out.length >= MAX_MODEL_WARNINGS) break;
  }
  return out;
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
    // 클라이언트가 실제로 확인한 용지 크기. 검증·클램프도 이 값 기준이고, 응답에도 그대로 실어
    // 보내 클라이언트가 자기 레포트의 기존 페이지가 아니라 이 값을 반영하게 한다(스펙 9, I1)
    const resolvedPage: Report["page"] = { ...report.page, ...page };

    const prompt = buildImportPrompt(page, { mimeType: scan.mimeType, data: scan.data.toString("base64") });
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, images: prompt.images, signal: req.signal, timeoutMs: importTimeoutMs() });
    const result = validateImported({ ...report, page: resolvedPage }, raw, page);

    // 전처리된 스캔은 대조 배경일 뿐이다. 별도 저장소에 영구히 두지 않는다 — 사용자가 제안을
    // 거절해도 지울 방법이 없어 이미지가 그대로 남기 때문이다(스펙 7 재검토, I4). preprocessScan의
    // 출력 용량 상한 안에 있으면(기본적으로 항상 그렇다 — encodeWithinBudget이 그 상한을 보장한다)
    // data URL로 바로 실어 보내고, 그렇지 않으면 배경 없이 진행한다
    const src = scan.data.byteLength <= MAX_OUTPUT_BYTES ? `data:${scan.mimeType};base64,${scan.data.toString("base64")}` : null;

    const ratio = scan.width / scan.height;
    const target = page.width / page.height;
    const warnings = [...scan.notes, ...sanitizeModelWarnings(raw), ...result.warnings];
    if (Math.abs(ratio - target) / target > 0.05) warnings.push("이미지 비율이 선택한 용지와 5% 넘게 달라 요소 위치가 늘어났을 수 있습니다");

    const explanation = typeof (raw as { explanation?: unknown }).explanation === "string" ? (raw as { explanation: string }).explanation : "";
    console.log(`[ai] ts=${new Date().toISOString()} id=${report.id} kind=import ms=${Date.now() - started} px=${scan.width}x${scan.height} elements=${result.elements.length}`);
    return NextResponse.json({ elements: result.elements, params: result.params, datasets: result.datasets, explanation, warnings, page: resolvedPage, scan: { src, angle: scan.angle } });
  } catch (e) {
    return importErrorResponse(e);
  }
}
