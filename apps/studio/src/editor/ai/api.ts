import type { Element, Report } from "@daport/core";
import { failureMessage } from "../failure-message";

export type PostAiResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; message: string };

/** 한 번에 넘길 청크 크기(문자 코드 수). 큰 파일을 통째로 스프레드하면(String.fromCharCode(...bytes)) 스택을 넘긴다 */
const BASE64_CHUNK_SIZE = 8192;

/** 브라우저에는 Buffer가 없다. Uint8Array를 청크로 나눠 base64 문자열로 인코딩한다 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

/** /api/reports/:id/ai/{edit,generate,import}에 POST한다. 비정상 응답은 상태·코드·메시지로 감싸 돌려준다(던지지 않는다) */
export async function postAi<T>(reportId: string, kind: "edit" | "generate" | "import", body: unknown, signal?: AbortSignal): Promise<PostAiResult<T>> {
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

export type ImportResponse = {
  elements: Element[];
  params: Report["params"];
  datasets: Report["datasets"];
  explanation: string;
  warnings: string[];
  scan: { src: string | null; angle: number };
};

/** file.arrayBuffer()는 jsdom(테스트 환경)에 없다. FileReader는 jsdom·모든 브라우저가 지원한다 */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 이미지를 base64로 실어 이관을 요청한다. 파일을 그대로 보내지 않는 이유는 라우트가 JSON content-type 검사를 공유하기 때문이다.
 * report는 라우트가 빈 레포트 확인(AI_NOT_EMPTY)과 결과 병합에 쓴다 — edit·generate처럼 함께 실어 보낸다
 */
export async function postImport(reportId: string, report: Report, file: File, preset: { width: number; height: number }, signal?: AbortSignal) {
  const dataBase64 = bytesToBase64(await readFileBytes(file));
  return postAi<ImportResponse>(reportId, "import", { report, image: { mimeType: file.type, dataBase64 }, preset }, signal);
}
