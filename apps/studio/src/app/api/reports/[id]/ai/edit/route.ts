import { NextResponse } from "next/server";
import { parseReport } from "@daport/core";
import { buildEditPrompt, validateEditPatch, MAX_INSTRUCTION_CHARS, type ChatTurn } from "@daport/ai";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";
import { getLlmClient, aiErrorResponse, buildContext } from "@/lib/ai";

export const maxDuration = 90;

/** 자연어 편집 (스펙 4.1, 6.1). 검증된 패치만 돌려준다. 모델은 바꾸지 않는다 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const b = parsed.body;
  const instruction = typeof b.instruction === "string" ? b.instruction.trim() : "";
  if (!instruction) return NextResponse.json({ error: "지시를 입력하세요", code: "AI_INPUT_TOO_LONG" }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTION_CHARS) return NextResponse.json({ error: `지시는 ${MAX_INSTRUCTION_CHARS}자 이하여야 합니다`, code: "AI_INPUT_TOO_LONG" }, { status: 400 });
  const client = getLlmClient();
  if (!client) return NextResponse.json({ error: "서버에 GEMINI_API_KEY를 설정하세요", code: "AI_NOT_CONFIGURED" }, { status: 503 });
  const started = Date.now();
  try {
    const report = parseReport(b.report);
    const selection = Array.isArray(b.selection) ? b.selection.filter((s): s is string => typeof s === "string") : [];
    const history = (Array.isArray(b.history) ? b.history : []).filter((t): t is ChatTurn => !!t && typeof (t as ChatTurn).text === "string" && ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant"));
    const prompt = buildEditPrompt(await buildContext(report, selection, history), instruction);
    const raw = await client.complete({ system: prompt.system, messages: prompt.messages, schema: prompt.schema, signal: req.signal });
    const { patch, warnings } = validateEditPatch(report, raw);
    const explanation = typeof (raw as { explanation?: unknown }).explanation === "string" ? (raw as { explanation: string }).explanation : "";
    console.log(`[ai] edit report=${id} ms=${Date.now() - started} ops=${patch.length}`);
    return NextResponse.json({ patch, explanation, warnings: [...prompt.truncated.map((t) => `컨텍스트를 줄였습니다: ${t}`), ...warnings] });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
