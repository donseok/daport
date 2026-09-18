import type { Report, DataContext } from "@daport/core";
import { executeDatasets, createFetchHttpConnector, parseAllowList, envSecrets, type DatasetError, type SqlConnector, type SqlColumn } from "@daport/datasource";
import { connectorFor } from "@daport/oracle";
import { getConnectionStore } from "./connection-store";

export const SAMPLE_ROWS = 200;

/** 레포트가 참조하는 연결 이름마다 커넥터를 만든다 (4b 스펙 7.2). 연결·비밀값이 없으면 넣지 않아 SQL_NOT_CONFIGURED로 흐른다 */
async function sqlConnectors(report: Report): Promise<Record<string, SqlConnector>> {
  const names = [...new Set(report.datasets.filter((d) => d.type === "sql").map((d) => d.connection))];
  const out: Record<string, SqlConnector> = {};
  const secrets = envSecrets();
  for (const name of names) {
    const conn = await getConnectionStore().get(name);
    if (!conn) continue;
    try { out[name] = connectorFor(conn, secrets); } catch { /* 비밀값 없음 → 미등록 */ }
  }
  return out;
}

/** 서버 전용. 환경변수의 허용 호스트·비밀값과 저장된 연결로 데이터셋을 실행한다 */
export async function runDatasets(report: Report, input: { params?: Record<string, unknown>; data?: Record<string, unknown> }):
  Promise<{ context: DataContext; errors: DatasetError[]; columns: Record<string, SqlColumn[]> }> {
  return executeDatasets(report, {
    params: input.params ?? {},
    data: input.data,
    connectors: { http: createFetchHttpConnector({ allow: parseAllowList(process.env.DAPORT_HTTP_ALLOW) }), sql: await sqlConnectors(report) },
    secrets: envSecrets(),
  });
}
