import type { ComponentBody } from "@daport/core";
// 타입만 가져온다. 저장소 모듈은 DB 클라이언트를 끌어오므로 값 import를 하면 클라이언트 번들이 깨진다
import type { ComponentSummary, ComponentDetail } from "@/lib/component-store";
import type { Usage } from "@/lib/component-usage";

/** 라이브러리 패널 → 캔버스 드래그 데이터. 값은 컴포넌트 id (스펙 7.1) */
export const COMPONENT_MIME = "application/x-daport-component";

const JSON_HEADERS = { "content-type": "application/json" };
const itemPath = (id: string) => `/api/components/${encodeURIComponent(id)}`;

/** 실패하면 서버가 준 error 메시지(없으면 HTTP 상태)로 Error를 던진다. 204는 본문이 없다 */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const r = init ? await fetch(url, init) : await fetch(url);
  if (r.status === 204) return undefined as T;
  const body: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : `HTTP ${r.status}`);
  }
  return body as T;
}

export async function fetchComponents(): Promise<ComponentSummary[]> {
  return request<ComponentSummary[]>("/api/components");
}
export async function fetchComponent(id: string): Promise<ComponentDetail> {
  return request<ComponentDetail>(itemPath(id));
}
export async function createComponent(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }> {
  return request("/api/components", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id, body }) });
}
export async function saveComponent(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }> {
  return request(itemPath(id), { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ body }) });
}
export async function fetchUsage(id: string): Promise<Usage[]> {
  return request<Usage[]>(`${itemPath(id)}/usage`);
}
export async function applyLatest(id: string): Promise<{ updated: string[]; skipped: { reportId: string; error: string }[] }> {
  return request(`${itemPath(id)}/apply-latest`, { method: "POST" });
}
export async function deleteComponent(id: string): Promise<void> {
  await request<void>(itemPath(id), { method: "DELETE" });
}
