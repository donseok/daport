import type { Report, DataContext } from "@daport/core";
import { executeDatasets, createFetchHttpConnector, parseAllowList, envSecrets, type DatasetError } from "@daport/datasource";

/** 데이터셋마다 샘플로 저장하는 앞 행 수 (스펙 4.6) */
export const SAMPLE_ROWS = 200;

/** 서버 전용. 환경변수의 허용 호스트·비밀값으로 데이터셋을 실행한다. SQL 커넥터는 이후 단계 */
export function runDatasets(report: Report, input: { params?: Record<string, unknown>; data?: Record<string, unknown> }): Promise<{ context: DataContext; errors: DatasetError[] }> {
  return executeDatasets(report, {
    params: input.params ?? {},
    data: input.data,
    connectors: { http: createFetchHttpConnector({ allow: parseAllowList(process.env.DAPORT_HTTP_ALLOW) }) },
    secrets: envSecrets(),
  });
}
