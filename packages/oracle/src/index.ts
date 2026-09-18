import { DatasetFailure, type Connection, type SecretResolver, type SqlConnector } from "@daport/datasource";
import { createDirectConnector } from "./direct";
import { createAgentConnector } from "./agent";

export type ManagedConnector = SqlConnector & { ping(): Promise<void>; close(): Promise<void> };
export * from "./convert";
export { FakeSqlConnector } from "./testing";
export { createDirectConnector } from "./direct";
export { createAgentConnector } from "./agent";
export { closeConnector } from "./pool";

/** 연결 설정과 비밀값 → 커넥터. 비밀값이 없으면 SQL_NOT_CONFIGURED (풀은 첫 쿼리에서 열리므로 여기서는 네트워크에 닿지 않는다) */
export function connectorFor(conn: Connection, secrets: SecretResolver): ManagedConnector {
  const secret = secrets(conn.secretRef);
  if (!secret) throw new DatasetFailure("SQL_NOT_CONFIGURED", `비밀값 DAPORT_SECRET_${conn.secretRef}이(가) 설정되지 않았습니다`);
  return conn.via === "direct" ? createDirectConnector(conn, secret) : createAgentConnector(conn, secret);
}
