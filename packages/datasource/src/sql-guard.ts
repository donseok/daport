import { DatasetFailure } from "./types";
import { maskSqlNoise } from "./sql-lexer";

const deny = (why: string) => new DatasetFailure("SQL_NOT_ALLOWED", why);

/**
 * 읽기 전용 가드 (4b 스펙 4.2). 단일 SELECT/WITH 문만 허용한다. 1차 방어이며 2차는 SET TRANSACTION READ ONLY,
 * 3차는 읽기 전용 DB 계정이다. direct·agent 커넥터가 실행 직전에 부른다
 */
export function guardSql(sql: string): void {
  const s = maskSqlNoise(sql);
  const first = /^\s*([A-Za-z]+)/.exec(s)?.[1]?.toUpperCase();
  if (!first) throw deny("쿼리가 비어 있습니다");
  if (first !== "SELECT" && first !== "WITH") throw deny(`SELECT 또는 WITH로 시작하는 단일 조회문만 허용합니다 (첫 키워드: ${first})`);
  if (s.includes(";")) throw deny("문장 구분자 ;는 허용하지 않습니다 (단일 문만)");
  if (/\bFOR\s+UPDATE\b/i.test(s)) throw deny("FOR UPDATE(행 잠금)는 허용하지 않습니다");
}
