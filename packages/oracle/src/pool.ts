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

// 이 프로세스에서만 유효하다: PUT/DELETE로 연결이 바뀌어도 다른 인스턴스·람다는 재활용될 때까지 옛 풀을 계속 쓴다.
// 단일 인스턴스 direct 배포를 전제로 한 타협이며, 클러스터 전체 무효화가 필요해지면 이 함수만으로는 부족하다
export async function closeConnector(name: string): Promise<void> {
  const p = pools().get(name);
  if (!p) return;
  pools().delete(name);
  try { await (await p).close(0); } catch { /* 이미 닫혔거나 생성 실패 */ }
}
