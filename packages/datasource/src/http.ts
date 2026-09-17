import { evaluate, interpolate, type HttpDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type HttpConnector, type HttpRequest, type Limits, type SecretResolver } from "./types";

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;
const SECRET_REF_RE = /\bsecrets\.([A-Za-z0-9_]+)/g;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** DAPORT_HTTP_ALLOW: 쉼표 구분 host 또는 host:port. 소문자로 정규화 */
export function parseAllowList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
}

/** 오류 메시지에서 비밀값 문자열을 ***로 바꾼다 */
export function maskSecrets(message: string, values: string[]): string {
  let out = message;
  for (const v of values) if (v !== "") out = out.split(v).join("***");
  return out;
}

/**
 * 데이터셋 정의와 파라미터로 요청을 만든다. URL 템플릿 값은 encodeURIComponent, 헤더·본문은 그대로.
 * secrets는 템플릿에 나오는 이름만 미리 읽어 평탄한 객체로 넣는다(레이아웃 컨텍스트에는 절대 들어가지 않는다)
 */
export function buildHttpRequest(ds: HttpDataset, params: Record<string, unknown>, secrets: SecretResolver): { request: HttpRequest; usedSecrets: string[] } {
  const templates = [ds.url, ...Object.values(ds.headers), ds.body ?? ""];
  const secretObj: Record<string, string> = {};
  for (const t of templates) for (const m of t.matchAll(SECRET_REF_RE)) secretObj[m[1]] = secrets(m[1]) ?? "";
  const tctx = { params, secrets: secretObj };
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const url = ds.url.replace(TEMPLATE_RE, (_m, expr: string) => encodeURIComponent(str(evaluate(expr, tctx))));
  const headers = Object.fromEntries(Object.entries(ds.headers).map(([k, v]) => [k, interpolate(v, tctx)]));
  const request: HttpRequest = { method: ds.method, url, headers };
  if (ds.method === "POST" && ds.body !== undefined) request.body = interpolate(ds.body, tctx);
  return { request, usedSecrets: Object.values(secretObj).filter((v) => v !== "") };
}

/** rowsPath(점 경로)를 따라간 값을 행 배열로. 객체는 [객체], 그 밖은 ROWS_PATH */
export function pickRows(json: unknown, rowsPath: string | undefined): Record<string, unknown>[] {
  let v: unknown = json;
  for (const seg of (rowsPath ?? "").split(".")) {
    if (seg === "") continue;
    if (!isObject(v)) throw new DatasetFailure("ROWS_PATH", `no rows at "${rowsPath}"`);
    v = v[seg];
  }
  if (Array.isArray(v)) {
    if (!v.every(isObject)) throw new DatasetFailure("ROWS_PATH", "rows are not objects");
    return v;
  }
  if (isObject(v)) return [v];
  throw new DatasetFailure("ROWS_PATH", `no rows at "${rowsPath ?? ""}"`);
}

function toFailure(e: unknown, signal: AbortSignal): DatasetFailure {
  if (e instanceof DatasetFailure) return e;
  const name = (e as { name?: string } | null)?.name;
  if (signal.aborted || name === "TimeoutError" || name === "AbortError") return new DatasetFailure("TIMEOUT", "request timed out");
  return new DatasetFailure("HTTP_STATUS", e instanceof Error ? e.message : String(e));
}

/** 응답 본문을 스트림으로 읽으며 maxBytes를 넘으면 중단한다 */
async function readLimited(res: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new DatasetFailure("TOO_LARGE", `response larger than ${maxBytes} bytes`); }
      chunks.push(value);
    }
  } catch (e) {
    throw toFailure(e, signal);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** 전역 fetch 기반 커넥터. 허용 호스트, 리다이렉트 거부, 타임아웃, 응답 크기 한도를 적용한다 */
export function createFetchHttpConnector(opts: { allow: string[]; fetch?: typeof fetch }): HttpConnector {
  const allowed = new Set(opts.allow.map((h) => h.toLowerCase()));
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async request(req, limits) {
      let url: URL;
      try { url = new URL(req.url); } catch { throw new DatasetFailure("HOST_NOT_ALLOWED", `invalid url: ${req.url}`); }
      const okScheme = url.protocol === "http:" || url.protocol === "https:";
      if (!okScheme || !(allowed.has(url.host.toLowerCase()) || allowed.has(url.hostname.toLowerCase()))) {
        throw new DatasetFailure("HOST_NOT_ALLOWED", `host not allowed: ${url.host}`);
      }
      const signal = AbortSignal.timeout(limits.timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, { method: req.method, headers: req.headers, body: req.body, redirect: "manual", signal });
      } catch (e) {
        throw toFailure(e, signal);
      }
      if (!res.ok) throw new DatasetFailure("HTTP_STATUS", `HTTP ${res.status}`);   // 3xx도 manual이라 여기로 온다
      const text = await readLimited(res, limits.maxBytes, signal);
      try { return JSON.parse(text) as unknown; } catch { throw new DatasetFailure("BAD_JSON", "response is not valid JSON"); }
    },
  };
}

export async function runHttp(ds: HttpDataset, params: Record<string, unknown>, connectors: Connectors, secrets: SecretResolver, limits: Limits): Promise<Record<string, unknown>[]> {
  if (!connectors.http) throw new DatasetFailure("HOST_NOT_ALLOWED", "http connector not configured");
  const { request, usedSecrets } = buildHttpRequest(ds, params, secrets);
  try {
    return pickRows(await connectors.http.request(request, limits), ds.rowsPath);
  } catch (e) {
    const message = maskSecrets(e instanceof Error ? e.message : String(e), usedSecrets);
    throw new DatasetFailure(e instanceof DatasetFailure ? e.code : "HTTP_STATUS", message);
  }
}
