import http from "node:http";
import https from "node:https";
import { createHash, timingSafeEqual } from "node:crypto";
import { DatasetFailure, DEFAULT_LIMITS, type DatasetErrorCode } from "@daport/datasource";
import type { ManagedConnector } from "@daport/oracle";

export type AgentOptions = { connector: ManagedConnector; token: string; version: string; maxConcurrency?: number; maxBodyBytes?: number; log?: (line: string) => void; tls?: { cert: string; key: string } };

const STATUS: Partial<Record<DatasetErrorCode, number>> = { SQL_NOT_ALLOWED: 400, BAD_PARAM: 400, TOO_MANY_ROWS: 400, TIMEOUT: 504, SQL_ERROR: 502, SQL_NOT_CONFIGURED: 502, TOO_LARGE: 502 };
const sha = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}
const fail = (res: http.ServerResponse, status: number, code: string, message?: string) => send(res, status, { error: { code, ...(message ? { message } : {}) } });

/** 본문을 maxBytes까지만 읽는다. 초과하면 null (호출자가 413) */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let total = 0;
    req.on("data", (c: Buffer) => { total += c.length; if (total > maxBytes) { resolve(null); return; } chunks.push(c); });   // req.destroy()는 응답을 쓰기 전에 소켓을 끊어버려 클라이언트가 413을 받지 못한다
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 공장 안 중계 서버 (4b 스펙 6장). SQL·바인드·토큰은 로그에 남기지 않는다 */
export function createAgentServer(opts: AgentOptions): http.Server | https.Server {
  const maxConcurrency = opts.maxConcurrency ?? 8;
  const maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
  const log = opts.log ?? ((l: string) => console.log(l));
  let inFlight = 0;

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const started = Date.now();
    let rows = 0;
    const url = new URL(req.url ?? "/", "http://agent");
    res.on("finish", () => log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms rows=${rows}`));
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !sameToken(token, opts.token)) return fail(res, 401, "UNAUTHORIZED");
    if (req.method === "GET" && url.pathname === "/health") {
      try { await opts.connector.ping(); return send(res, 200, { ok: true, version: opts.version }); }
      catch (e) { return send(res, 503, { ok: false, error: { code: e instanceof DatasetFailure ? e.code : "SQL_ERROR", message: e instanceof Error ? e.message : String(e) } }); }
    }
    if (req.method === "POST" && url.pathname === "/query") {
      if (inFlight >= maxConcurrency) return fail(res, 429, "BUSY", "동시 요청 한도를 넘었습니다");
      inFlight++;
      try {
        const text = await readBody(req, maxBodyBytes);
        if (text === null) {
          res.once("finish", () => req.destroy());   // 413을 다 쓴 뒤에 요청 소켓을 닫는다 — 먼저 닫으면 클라이언트가 리셋을 본다
          return fail(res, 413, "BAD_PARAM", `본문이 ${maxBodyBytes} 바이트를 넘습니다`);
        }
        let body: { sql?: unknown; binds?: unknown; timeoutMs?: unknown; maxRows?: unknown };
        try { body = JSON.parse(text); } catch { return fail(res, 400, "BAD_PARAM", "본문이 JSON이 아닙니다"); }
        if (!body || typeof body.sql !== "string") return fail(res, 400, "BAD_PARAM", "sql 문자열이 필요합니다");
        const binds = body.binds && typeof body.binds === "object" && !Array.isArray(body.binds) ? (body.binds as Record<string, unknown>) : {};
        const clamp = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, max) : max);
        const timeoutMs = clamp(body.timeoutMs, DEFAULT_LIMITS.timeoutMs), maxRows = clamp(body.maxRows, DEFAULT_LIMITS.maxRows);
        try {
          const result = await opts.connector.query(body.sql, binds, { timeoutMs, maxRows, signal: AbortSignal.timeout(timeoutMs) });
          rows = result.rows.length;
          return send(res, 200, result);
        } catch (e) {
          if (e instanceof DatasetFailure) return fail(res, STATUS[e.code] ?? 502, e.code, e.message);
          return fail(res, 502, "SQL_ERROR", e instanceof Error ? e.message : String(e));
        }
      } finally { inFlight--; }
    }
    return fail(res, 404, "NOT_FOUND");
  };
  const wrapped = (req: http.IncomingMessage, res: http.ServerResponse) => { handler(req, res).catch((e) => { if (!res.headersSent) fail(res, 500, "SQL_ERROR", e instanceof Error ? e.message : String(e)); }); };
  return opts.tls ? https.createServer({ cert: opts.tls.cert, key: opts.tls.key }, wrapped) : http.createServer(wrapped);
}
