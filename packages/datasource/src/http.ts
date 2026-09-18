import { evaluate, interpolate, evaluateTemplateValue, type HttpDataset } from "@daport/core";
import { DatasetFailure, type Connectors, type HttpConnector, type HttpRequest, type Limits, type SecretResolver } from "./types";

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;
/** 헤더·본문에서 비밀값을 넣는 유일한 형태: 템플릿 하나가 통째로 `{{ secrets.NAME }}` */
const SECRET_TOKEN_RE = /\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g;
const SECRET_IDENT_RE = /(^|[^\w$.])secrets(?![\w$])/;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const bad = (message: string) => new DatasetFailure("BAD_PARAM", message);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** DAPORT_HTTP_ALLOW: 쉼표 구분 `host[:port][=NAME|NAME]`. 호스트 부분만 소문자로 정규화한다 (비밀값 이름은 대문자 그대로) */
export function parseAllowList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => {
    const eq = s.indexOf("=");
    return eq < 0 ? s.toLowerCase() : `${s.slice(0, eq).trim().toLowerCase()}=${s.slice(eq + 1).trim()}`;
  });
}

type AllowEntry = { host: string; port?: string; secrets: Set<string> };
const normHost = (h: string) => h.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");

function parseEntry(raw: string): AllowEntry | null {
  const eq = raw.indexOf("=");
  const hostPart = (eq < 0 ? raw : raw.slice(0, eq)).trim();
  const names = eq < 0 ? [] : raw.slice(eq + 1).split("|").map((n) => n.trim()).filter((n) => n !== "");
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPart) ?? /^([^:\[\]]+)(?::(\d+))?$/.exec(hostPart);
  return m ? { host: normHost(m[1]), port: m[2], secrets: new Set(names) } : null;
}

/** 오류 메시지에서 비밀값 문자열을 ***로 바꾼다 */
export function maskSecrets(message: string, values: string[]): string {
  let out = message;
  for (const v of values) if (v !== "") out = out.split(v).join("***");
  return out;
}

/** 헤더·본문 문자열 안의 `{{ secrets.NAME }}` 토큰 이름들 (URL에서는 비밀값을 쓸 수 없다) */
export function referencedSecrets(ds: HttpDataset, secrets: SecretResolver): Record<string, string> {
  const out: Record<string, string> = {};
  const scan = (t: string) => { for (const m of t.matchAll(SECRET_TOKEN_RE)) out[m[1]] = secrets(m[1]) ?? ""; };
  Object.values(ds.headers).forEach(scan);
  if (ds.body !== undefined) scan(ds.body);
  return out;
}

/** 템플릿 안에 토큰 형태가 아닌 secrets 참조가 있으면 BAD_PARAM. 표현식이 비밀값을 읽거나 가공할 수 없게 한다 */
function assertNoStraySecrets(template: string, where: string, allowTokens: boolean) {
  const rest = allowTokens ? template.replace(SECRET_TOKEN_RE, "") : template;
  for (const m of rest.matchAll(TEMPLATE_RE)) if (SECRET_IDENT_RE.test(m[1])) throw bad(`secrets can only be used as a whole {{ secrets.NAME }} token in headers or body (${where})`);
}

/** 문자열 템플릿을 평가한다. 비밀값 토큰은 평가가 끝난 뒤 그 자리에 넣으므로 파라미터 값이 토큰을 만들어 낼 수 없다 */
function fillString(template: string, params: Record<string, unknown>, secretObj: Record<string, string>, typed: boolean): unknown {
  const parts = template.split(SECRET_TOKEN_RE);   // [텍스트, 이름, 텍스트, 이름, ...]
  if (parts.length === 1) return typed ? evaluateTemplateValue(template, { params }) : interpolate(template, { params });
  return parts.map((p, i) => (i % 2 === 1 ? secretObj[p] ?? "" : interpolate(p, { params }))).join("");
}

function fillBody(value: unknown, params: Record<string, unknown>, secretObj: Record<string, string>): unknown {
  if (typeof value === "string") return fillString(value, params, secretObj, true);
  if (Array.isArray(value)) return value.map((v) => fillBody(v, params, secretObj));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillBody(v, params, secretObj)]));
  return value;
}

/**
 * 데이터셋 정의와 파라미터로 요청을 만든다.
 * - url: 스킴·호스트는 리터럴이어야 하고 템플릿 값은 encodeURIComponent. 경로에 `.`·`..` 조각이 생기면 BAD_PARAM. 비밀값 금지
 * - 헤더: 템플릿은 그대로 넣되 CR·LF는 BAD_PARAM. `{{ secrets.NAME }}` 토큰만 비밀값으로 치환
 * - 본문(POST): JSON이어야 하며 문자열 값 안의 템플릿만 평가한다(단독 템플릿은 원래 타입 유지)
 */
export function buildHttpRequest(ds: HttpDataset, params: Record<string, unknown>, secrets: SecretResolver): { request: HttpRequest; usedSecrets: string[] } {
  assertNoStraySecrets(ds.url, "url", false);
  Object.values(ds.headers).forEach((h) => assertNoStraySecrets(h, "headers", true));
  if (ds.body !== undefined) assertNoStraySecrets(ds.body, "body", true);

  const firstTemplate = ds.url.indexOf("{{");
  if (firstTemplate >= 0 && !/^https?:\/\/[^/?#{}\s]+[/?#]/i.test(ds.url.slice(0, firstTemplate))) throw bad("url scheme and host must be literal");
  const url = ds.url.replace(TEMPLATE_RE, (_m, expr: string) => encodeURIComponent(str(evaluate(expr, { params }))));
  const pathEnd = url.search(/[?#]/);
  const path = (pathEnd < 0 ? url : url.slice(0, pathEnd)).replace(/^[a-z]+:\/\/[^/]*/i, "");
  if (path.split("/").some((seg) => /^(\.|%2e){1,2}$/i.test(seg))) throw bad("url path must not contain . or .. segments");

  const secretObj = referencedSecrets(ds, secrets);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(ds.headers)) {
    const filled = str(fillString(v, params, secretObj, false));
    if (/[\r\n]/.test(filled)) throw bad(`header ${k} must not contain line breaks`);
    headers[k] = filled;
  }
  const request: HttpRequest = { method: ds.method, url, headers };
  if (ds.method === "POST" && ds.body !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(ds.body); } catch { throw bad("body must be JSON; put templates inside string values"); }
    request.body = JSON.stringify(fillBody(parsed, params, secretObj));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  }
  const names = Object.keys(secretObj);
  if (names.length) request.secretNames = names;
  return { request, usedSecrets: Object.values(secretObj).filter((v) => v !== "") };
}

/** rowsPath(점 경로)를 따라간 값을 행 배열로. 객체는 [객체], 그 밖은 ROWS_PATH */
export function pickRows(json: unknown, rowsPath: string | undefined): Record<string, unknown>[] {
  let v: unknown = json;
  for (const seg of (rowsPath ?? "").split(".")) {
    if (seg === "") continue;
    if (!isObject(v) || !Object.hasOwn(v, seg)) throw new DatasetFailure("ROWS_PATH", `no rows at "${rowsPath}"`);   // 상속 속성(__proto__ 등)은 따라가지 않는다
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
export async function readResponseLimited(res: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
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

/**
 * 전역 fetch 기반 커넥터. 허용 호스트, 비밀값 바인딩, 리다이렉트 거부, 타임아웃, 응답 크기 한도를 적용한다.
 * 호스트 비교: hostname(소문자, 끝 점·IPv6 괄호 제거)과 포트(없으면 스킴 기본값). 포트 없는 항목은 모든 포트 허용
 */
export function createFetchHttpConnector(opts: { allow: string[]; fetch?: typeof fetch }): HttpConnector {
  const entries = opts.allow.map(parseEntry).filter((e): e is AllowEntry => e !== null);
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async request(req, limits) {
      let url: URL;
      try { url = new URL(req.url); } catch { throw new DatasetFailure("HOST_NOT_ALLOWED", "invalid url"); }
      const scheme = url.protocol;
      const host = normHost(url.hostname);
      const port = url.port || (scheme === "https:" ? "443" : "80");
      const matching = (scheme === "http:" || scheme === "https:") && !url.username && !url.password
        ? entries.filter((e) => e.host === host && (e.port === undefined || e.port === port)) : [];
      if (matching.length === 0) throw new DatasetFailure("HOST_NOT_ALLOWED", `host not allowed: ${host}`);
      const denied = (req.secretNames ?? []).filter((n) => !matching.some((e) => e.secrets.has(n)));
      if (denied.length) throw new DatasetFailure("HOST_NOT_ALLOWED", `secret ${denied.join(", ")} is not allowed for host ${host}`);
      const signal = AbortSignal.timeout(limits.timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, { method: req.method, headers: req.headers, body: req.body, redirect: "manual", signal });
      } catch (e) {
        throw toFailure(e, signal);
      }
      if (!res.ok) throw new DatasetFailure("HTTP_STATUS", `HTTP ${res.status}`);   // 3xx도 manual이라 여기로 온다
      const text = await readResponseLimited(res, limits.maxBytes, signal);
      try { return JSON.parse(text) as unknown; } catch { throw new DatasetFailure("BAD_JSON", "response is not valid JSON"); }
    },
  };
}

export async function runHttp(ds: HttpDataset, params: Record<string, unknown>, connectors: Connectors, secrets: SecretResolver, limits: Limits): Promise<Record<string, unknown>[]> {
  if (!connectors.http) throw new DatasetFailure("HOST_NOT_ALLOWED", "http connector not configured");
  const secretObj = referencedSecrets(ds, secrets);
  // 비밀값은 헤더·본문에만 들어가지만, 본문은 JSON 문자열로 이스케이프되므로 원본과 JSON 형태를 모두 마스킹한다
  const masks = [...new Set(Object.values(secretObj).filter((v) => v !== "").flatMap((v) => [v, JSON.stringify(v).slice(1, -1)]))];
  try {
    // buildHttpRequest도 try 안에서 호출한다 — 템플릿 평가 실패 메시지도 마스킹을 거친다
    const { request } = buildHttpRequest(ds, params, secrets);
    return pickRows(await connectors.http.request(request, limits), ds.rowsPath);
  } catch (e) {
    const message = maskSecrets(e instanceof Error ? e.message : String(e), masks);
    // 커넥터·pickRows는 늘 DatasetFailure를 던진다. 그 밖(템플릿 평가 오류)은 요청을 만들지 못한 것이므로 BAD_PARAM
    throw new DatasetFailure(e instanceof DatasetFailure ? e.code : "BAD_PARAM", message);
  }
}
