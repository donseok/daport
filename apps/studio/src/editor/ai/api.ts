import { failureMessage } from "../failure-message";

export type PostAiResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; message: string };

/** /api/reports/:id/ai/{edit,generate}에 POST한다. 비정상 응답은 상태·코드·메시지로 감싸 돌려준다(던지지 않는다) */
export async function postAi<T>(reportId: string, kind: "edit" | "generate", body: unknown, signal?: AbortSignal): Promise<PostAiResult<T>> {
  const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/ai/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const forCode = res.clone();
    const message = await failureMessage(res, "AI 요청");
    const parsed: unknown = await forCode.json().catch(() => null);
    const code = parsed && typeof parsed === "object" && typeof (parsed as { code?: unknown }).code === "string" ? (parsed as { code: string }).code : undefined;
    return { ok: false, status: res.status, code, message };
  }
  return { ok: true, data: (await res.json()) as T };
}
