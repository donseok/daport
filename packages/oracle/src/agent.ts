import { guardSql, assertAgentUrl, readResponseLimited, DatasetFailure, DEFAULT_LIMITS, type AgentConnection, type DatasetErrorCode } from "@daport/datasource";
import type { ManagedConnector } from "./index";

const CODES = new Set<DatasetErrorCode>(["TIMEOUT", "SQL_NOT_ALLOWED", "SQL_ERROR", "TOO_MANY_ROWS", "BAD_PARAM", "SQL_NOT_CONFIGURED", "TOO_LARGE"]);
const NETWORK_MARGIN_MS = 5_000;

function failureFromStatus(status: number, body: unknown): DatasetFailure {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const message = err?.message ?? `에이전트 응답 HTTP ${status}`;
  if (status === 401 || status === 403) return new DatasetFailure("SQL_NOT_CONFIGURED", "에이전트가 토큰을 거부했습니다");
  if (status === 429) return new DatasetFailure("SQL_ERROR", "에이전트 과부하 (동시 요청 초과)");
  if (status === 504) return new DatasetFailure("TIMEOUT", message);
  if (err?.code && CODES.has(err.code as DatasetErrorCode)) return new DatasetFailure(err.code as DatasetErrorCode, message);
  return new DatasetFailure("SQL_ERROR", message);
}

/** 공장 안 중계 에이전트 클라이언트 (4b 스펙 5.3). 응답 형식은 SqlConnector와 같다 */
export function createAgentConnector(conn: AgentConnection, token: string, fetchImpl: typeof fetch = globalThis.fetch): ManagedConnector {
  assertAgentUrl(conn.url);
  const base = conn.url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (path: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown }> => {
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try { res = await fetchImpl(`${base}${path}`, { ...init, headers, redirect: "manual", signal }); }
    catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (signal.aborted || name === "TimeoutError" || name === "AbortError") throw new DatasetFailure("TIMEOUT", "에이전트 응답 시간 초과");
      throw new DatasetFailure("SQL_ERROR", `에이전트 연결 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    let text: string;
    try { text = await readResponseLimited(res, DEFAULT_LIMITS.maxBytes, signal); }
    catch (e) {
      if (e instanceof DatasetFailure && e.code === "HTTP_STATUS") throw new DatasetFailure("SQL_ERROR", e.message);
      throw e;
    }
    let body: unknown = null;
    if (text) { try { body = JSON.parse(text); } catch { if (res.ok) throw new DatasetFailure("SQL_ERROR", "에이전트 응답이 JSON이 아닙니다"); } }
    return { status: res.status, body };
  };
  return {
    async query(sql, binds, opts) {
      guardSql(sql);
      const { status, body } = await call("/query", { method: "POST", body: JSON.stringify({ sql, binds, timeoutMs: opts.timeoutMs, maxRows: opts.maxRows }) }, opts.timeoutMs + NETWORK_MARGIN_MS);
      if (status !== 200) throw failureFromStatus(status, body);
      const r = body as { rows?: unknown; columns?: unknown } | null;
      if (!r || !Array.isArray(r.rows) || !Array.isArray(r.columns)) throw new DatasetFailure("SQL_ERROR", "에이전트 응답 형식이 올바르지 않습니다");
      return { rows: r.rows as Record<string, unknown>[], columns: r.columns as { name: string; type: "string" | "number" | "boolean" | "date" | "object" | "array" | "null" }[] };
    },
    async ping() {
      const { status, body } = await call("/health", { method: "GET" }, 5_000);
      if (status !== 200) throw failureFromStatus(status, body);
    },
    async close() {},
  };
}
