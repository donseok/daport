import { NextResponse } from "next/server";

export const MAX_BODY_BYTES = 20 * 1024 * 1024;   // 스펙 6.5

type Parsed = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };
const fail = (status: number, error: string): Parsed => ({ ok: false, response: NextResponse.json({ error }, { status }) });

/**
 * JSON 객체 본문을 읽는다. content-length 선검사와 읽은 바이트 검사로 413, 구문 오류·객체 아님은 400.
 * 빈 본문과 JSON null은 {}로 본다 (1단계 라우트와 같은 규칙)
 */
export async function readJsonBody(req: Request, maxBytes: number): Promise<Parsed> {
  const tooLarge = () => fail(413, `요청 본문이 ${maxBytes} 바이트를 넘습니다`);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  let text = "";
  if (req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return tooLarge(); }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    text = new TextDecoder().decode(all);
  }
  let parsed: unknown = {};
  if (text.trim() !== "") {
    try { parsed = JSON.parse(text); } catch { return fail(400, "요청 본문이 올바른 JSON이 아닙니다"); }
  }
  if (parsed === null) parsed = {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "요청 본문은 JSON 객체여야 합니다");
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** 본문의 선택 객체 필드. 객체가 아니면 undefined */
export function objectField(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = body[key];
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
