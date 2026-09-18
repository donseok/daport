import type http from "node:http";
import type https from "node:https";
import type { ManagedConnector } from "@daport/oracle";

/**
 * 환경변수를 양의 정수로 읽는다. 비어 있거나 정수가 아니거나 0 이하면 fallback을 쓴다.
 * `Number(env.X ?? 8)`은 빈 문자열이나 잘못된 값에 NaN/0을 돌려주고, 그 NaN이 동시성 상한(`inFlight >= NaN`)이나
 * 포트(`listen(NaN)`)에 그대로 흘러들어가 보호 기능이 조용히 꺼진다 — 그래서 모든 정수 환경변수는 이 한 곳을 거친다
 */
export function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

type Server = http.Server | https.Server;

/**
 * SIGTERM/SIGINT 종료 절차 (스펙 6.4). `server.close()`만으로는 살아있는 keep-alive 커넥션이 있는 동안
 * 콜백이 영원히 안 불릴 수 있어 `closeAllConnections()`로 즉시 끊고, 그래도 5초 안에 못 끝나면
 * `exit`을 강제로 불러 재시작 신호를 받은 프로세스가 무한정 떠 있지 않게 한다
 */
export function shutdown(server: Server, connector: ManagedConnector, exit: (code: number) => void): void {
  server.close(() => { connector.close().finally(() => exit(0)); });
  server.closeAllConnections();
  setTimeout(() => exit(0), 5_000).unref();
}
