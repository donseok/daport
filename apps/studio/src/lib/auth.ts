import { NextResponse } from "next/server";
import { getApiKeyStore, type ApiKeyInfo, type ApiKeyStore } from "./api-key-store";

export type AuthResult = { ok: true; key: ApiKeyInfo } | { ok: false; response: Response };

export function allowsReport(key: ApiKeyInfo, reportId: string): boolean {
  return key.allowedReportIds === null || key.allowedReportIds.includes(reportId);
}

/**
 * X-API-Key 검사 (4단계 스펙 5.2, 8장). 401은 키·레포트 존재 여부를 드러내지 않는다.
 * 레포트가 있는지는 호출자가 인증 통과 뒤에 확인한다
 */
export async function authorize(req: Request, reportId: string, store: ApiKeyStore = getApiKeyStore()): Promise<AuthResult> {
  const raw = req.headers.get("x-api-key");
  const key = raw ? await store.verify(raw) : null;
  if (!key) return { ok: false, response: NextResponse.json({ error: "인증 실패", code: "UNAUTHORIZED" }, { status: 401 }) };
  if (!allowsReport(key, reportId)) return { ok: false, response: NextResponse.json({ error: "이 키로는 접근할 수 없는 레포트입니다", code: "FORBIDDEN" }, { status: 403 }) };
  return { ok: true, key };
}
