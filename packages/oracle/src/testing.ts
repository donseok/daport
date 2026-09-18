import { DatasetFailure, guardSql, type SqlColumn, type DatasetErrorCode } from "@daport/datasource";
import type { ManagedConnector } from "./index";

type Result = { rows: Record<string, unknown>[]; columns: SqlColumn[] };
type Script = Partial<Result> & { delayMs?: number; fail?: DatasetErrorCode | Error };
type Call = { sql: string; binds: Record<string, unknown>; opts: { timeoutMs: number; maxRows: number } };

/** 테스트·E2E용 커넥터. 실제 커넥터처럼 가드를 거치고, 쿼리별 스크립트와 호출 기록을 제공한다 */
export class FakeSqlConnector implements ManagedConnector {
  readonly calls: Call[] = [];
  private scripts: { match: string; script: Script }[] = [];
  constructor(private defaults: Script = { rows: [{ NO: "A-1", QTY: 3, DT: "2026-09-18T00:00:00.000Z" }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }, { name: "DT", type: "date" }] }) {}
  when(sqlIncludes: string, script: Script): this { this.scripts.push({ match: sqlIncludes, script }); return this; }
  async query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number }): Promise<Result> {
    guardSql(sql);
    this.calls.push({ sql, binds, opts: { timeoutMs: opts.timeoutMs, maxRows: opts.maxRows } });
    const script = this.scripts.find((s) => sql.includes(s.match))?.script ?? this.defaults;
    if (script.delayMs) await new Promise((r) => setTimeout(r, script.delayMs));
    if (script.fail) throw script.fail instanceof Error ? script.fail : new DatasetFailure(script.fail, `fake failure: ${script.fail}`);
    return { rows: script.rows ?? [], columns: script.columns ?? [] };
  }
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}
