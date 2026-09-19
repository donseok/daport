import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { buildGeneratePrompt, validateGenerated, estimateTokens, MAX_BRIEF_CHARS } from "@daport/ai";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { getLlmClient, aiErrorResponse, buildContext } from "@/lib/ai";
import { getComponentStore } from "@/lib/component-store";

export const maxDuration = 90;

/** 빈 레포트에서 페이지 전체를 만드는 생성 (스펙 4.2, 6.1). 요소가 있으면 거부한다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;
  const brief = typeof b.brief === "string" ? b.brief.trim() : "";
  if (!brief) return NextResponse.json({ error: "요청 내용을 입력하세요", code: "AI_INPUT_EMPTY" }, { status: 400 });
  if (brief.length > MAX_BRIEF_CHARS) return NextResponse.json({ error: `요청은 ${MAX_BRIEF_CHARS}자 이하여야 합니다`, code: "AI_INPUT_TOO_LONG" }, { status: 400 });
  const client = getLlmClient();
  if (!client) return NextResponse.json({ error: "서버에 GEMINI_API_KEY를 설정하세요", code: "AI_NOT_CONFIGURED" }, { status: 503 });
  const started = Date.now();
  try {
    const report = parseReport(b.report);
    if (report.elements.length > 0) return NextResponse.json({ error: "요소가 있는 레포트는 생성 대상이 아닙니다", code: "AI_NOT_EMPTY" }, { status: 400 });
    const prompt = buildGeneratePrompt(await buildContext(report, [], []), brief);
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, signal: req.signal });
    const lookup = async (componentId: string) => {
      const d = await getComponentStore().get(componentId);
      return d ? { version: d.summary.latestVersion, body: d.latest } : null;
    };
    const { elements, components, warnings } = await validateGenerated(report, raw, lookup);
    const explanation = typeof (raw as { explanation?: unknown }).explanation === "string" ? (raw as { explanation: string }).explanation : "";
    // 스펙 6.1: 시각·레포트 id·종류·경과 시간·추정 토큰·요소 수만 남긴다. brief·레포트 내용은 절대 로그에 넣지 않는다
    const tokens = estimateTokens(prompt.system + prompt.messages.map((m) => m.text).join(""));
    console.log(`[ai] ts=${new Date().toISOString()} id=${id} kind=generate ms=${Date.now() - started} tokens=${tokens} elements=${elements.length}`);
    return NextResponse.json({ elements, components, explanation, warnings: [...prompt.truncated.map((t) => `컨텍스트를 줄였습니다: ${t}`), ...warnings] });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
