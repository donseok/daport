import type { FieldType } from "@daport/core";

export type DatasetErrorCode =
  | "TIMEOUT" | "HOST_NOT_ALLOWED" | "HTTP_STATUS" | "BAD_JSON" | "ROWS_PATH" | "TOO_LARGE" | "TOO_MANY_ROWS"
  | "SQL_NOT_CONFIGURED" | "SQL_ERROR" | "BAD_DATA";
export type DatasetError = { dataset: string; code: DatasetErrorCode; message: string };

/** 데이터셋 하나의 실행 실패. executeDatasets가 errors 항목으로 바꾼다 */
export class DatasetFailure extends Error {
  constructor(readonly code: DatasetErrorCode, message: string) {
    super(message);
    this.name = "DatasetFailure";
  }
}

export type Limits = { timeoutMs: number; maxBytes: number; maxRows: number };
export const DEFAULT_LIMITS: Limits = { timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024, maxRows: 10_000 };

export type HttpRequest = { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string };
/** 파싱된 JSON을 돌려준다. 실패는 DatasetFailure */
export interface HttpConnector { request(req: HttpRequest, limits: Limits): Promise<unknown> }

/**
 * SQL 커넥터 규격. 결과는 순수 JSON(날짜는 ISO 8601 문자열, 큰 수는 문자열 허용)이어야 한다.
 * 직접 연결 구현과 공장 안 중계 에이전트가 같은 규격을 쓴다 (docs/superpowers/research/2026-09-17-oracle-connectivity.md)
 */
export interface SqlConnector {
  query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal }):
    Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }>;
}
export type Connectors = { http?: HttpConnector; sql?: Record<string, SqlConnector> };   // sql은 connection 이름별
export type SecretResolver = (name: string) => string | undefined;
