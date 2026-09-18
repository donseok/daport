/// <reference path="./oracledb.d.ts" /> 소비자 tsconfig의 include와 무관하게 앰비언트 선언을 끌어들인다
import oracledb from "oracledb";
import type { DirectConnection } from "@daport/datasource";

type Holder = { __daportOraclePools?: Map<string, Promise<oracledb.Pool>> };
const holder = globalThis as typeof globalThis & Holder;
const pools = () => (holder.__daportOraclePools ??= new Map());

/** 연결 이름마다 풀 하나. Next의 모듈 이중 로딩에도 프로세스에 한 번만 만든다. 세션 시간대는 UTC */
export function poolFor(conn: DirectConnection, password: string): Promise<oracledb.Pool> {
  let p = pools().get(conn.name);
  if (!p) {
    p = oracledb.createPool({
      user: conn.user, password, connectString: `${conn.host}:${conn.port}/${conn.service}`,
      poolMin: 0, poolMax: 4, poolTimeout: 60,
      sessionCallback: async (c: oracledb.Connection, _tag: string, cb: (err?: Error) => void) => {
        try { await c.execute("ALTER SESSION SET TIME_ZONE = 'UTC'"); cb(); } catch (e) { cb(e as Error); }
      },
    });
    p.catch(() => pools().delete(conn.name));   // 생성 실패는 캐시하지 않는다
    pools().set(conn.name, p);
  }
  return p;
}

export async function closeConnector(name: string): Promise<void> {
  const p = pools().get(name);
  if (!p) return;
  pools().delete(name);
  try { await (await p).close(0); } catch { /* 이미 닫혔거나 생성 실패 */ }
}
