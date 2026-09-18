/** 실패 응답의 오류 메시지. 프록시·서버 오류 페이지는 JSON이 아니고, error가 문자열이 아닐 수도 있어 HTTP 상태로 대신한다 */
export async function failureMessage(r: Response, label: string): Promise<string> {
  const body: unknown = await r.json().catch(() => null);
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  return typeof error === "string" ? error : `${label} 실패 (HTTP ${r.status})`;
}
