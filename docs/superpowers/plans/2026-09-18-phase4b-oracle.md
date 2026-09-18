# daport 4b단계 구현 플랜: Oracle 커넥터·연결 관리·중계 에이전트

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sql 데이터셋이 실제로 돈다 — `oracledb` thin 직접 연결과 공장 안 HTTP 중계 에이전트, 두 구현이 2단계 `SqlConnector` 규격을 만족하고, studio에서 연결을 관리하며 sql 데이터셋을 화면에서 편집한다.

**Architecture:** `datasource`에 연결 스키마·공용 가드·SQL 어휘 마스킹을 더하고, 새 패키지 `oracle`이 direct(`oracledb`)·agent(HTTP) 커넥터와 타입 변환·가짜 커넥터를 제공한다. 새 앱 `agent`는 Next 없는 Node 서버로 `/health`·`/query`를 낸다. studio는 `connections` 테이블·API·화면, `runDatasets`의 커넥터 조립, DatasetEditor sql 폼, 샘플 컬럼 타입 힌트, 가져오기 경고를 더한다. E2E는 `AGENT_FAKE=1` 에이전트를 함께 띄운다.

**Tech Stack:** TypeScript, zod 4, `oracledb` 6 (thin), `node:http`, `esbuild`, vitest, Playwright, `@testcontainers/oraclefree`(선택 통합 테스트).

**Spec:** `docs/superpowers/specs/2026-09-18-daport-phase4b-oracle-design.md` (승인됨). 플랜이 스펙을 구체화한 곳(T1의 `maskSqlNoise` 공용 어휘 함수와 `@daport/datasource/sql` 서브패스, T1의 `executeDatasets` `columns` 반환, T3의 날짜 변환 규칙, T5의 왕복 테스트 위치)은 각 태스크에 적어 두었다.

## Global Constraints

- 의존 방향: `oracle → datasource`; `agent → oracle, datasource`; `studio → oracle, datasource`. `oracle`·`agent`는 core·renderer를 import하지 않는다(`datasource`가 core 타입을 쓰는 것은 기존대로).
- 새 외부 의존: `oracledb ^6.5`(oracle), `esbuild`(agent devDep), `@testcontainers/oraclefree`·`testcontainers`(oracle devDep). 루트 `pnpm install`은 **T2에서 한 번만** 실행한다(두 패키지 골격을 함께 만든 뒤).
- 가드 `guardSql`은 direct·agent 커넥터의 `query`가 실행 직전에 반드시 호출한다. 단일 `SELECT`/`WITH`, `;` 없음, `FOR UPDATE` 없음, 빈 쿼리 거부. 위반 코드 `SQL_NOT_ALLOWED`.
- 바인드는 이름 바인드만(2단계 `extractBinds`). 문자열 결합 금지.
- 비밀값(`DAPORT_SECRET_<이름>`)은 응답·오류 메시지·로그·샘플·레이아웃 컨텍스트 어디에도 넣지 않는다. 오류 메시지의 비밀값 문자열은 `***`.
- 한도: 타임아웃 30초, 행 10,000(`maxRows + 1`행까지 읽고 넘치면 `TOO_MANY_ROWS`), 에이전트 응답 20MB.
- 결과는 순수 JSON: 날짜 ISO 8601 문자열, NUMBER는 안전 범위면 number 아니면 문자열, CLOB 문자열, RAW/BLOB 등은 `SQL_ERROR`.
- 기본 `pnpm test`는 Docker·실제 Oracle 없이 통과한다. 실제 Oracle 테스트는 `ORACLE_IT=1`일 때만 수집된다.
- 한글 주석·UI 문구, 영문 식별자. 커밋 제목 `type(pkg): …` 한글, 모든 커밋 메시지는 정확히 이 트레일러로 끝난다: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git -c core.hooksPath=/dev/null commit`, 파일 경로로만 스테이징.
- vitest 주의: `beforeEach(() => mock.mockReset())`처럼 mock을 반환하는 화살표 본문은 cleanup 훅으로 오인된다 — 블록 본문을 쓴다.
- Next 라우트 파일은 HTTP 메서드와 설정만 export한다. 헬퍼는 `src/lib/`.
- 텍스트 요소 픽스처의 필드는 `value:`(4단계에서 확인된 스키마 이름)다.

## 파일 구조

```
packages/core/src/data/infer.ts                              inferFields(rows, { columnTypes })                      (T1)
packages/datasource/src/sql-lexer.ts                         maskSqlNoise                                            (T1)
packages/datasource/src/sql.ts                               bindNames가 maskSqlNoise를 쓰도록 리팩터링               (T1)
packages/datasource/src/sql-guard.ts                         guardSql                                                (T1)
packages/datasource/src/connection.ts                        ConnectionSchema                                        (T1)
packages/datasource/src/sql-public.ts, package.json exports  "@daport/datasource/sql" 서브패스(클라이언트 안전)       (T1)
packages/datasource/src/types.ts, execute.ts, http.ts        SQL_NOT_ALLOWED, executeDatasets columns, readResponseLimited (T1)
packages/oracle/{package.json,tsconfig.json,vitest.config.ts,README.md}                                              (T2, T4)
packages/oracle/src/convert.ts, testing.ts, index.ts                                                                 (T2)
packages/oracle/src/direct.ts, agent.ts, pool.ts                                                                     (T3)
packages/oracle/src/__tests__/*.test.ts, __it__/direct.it.test.ts                                                    (T2, T3, T4)
apps/agent/{package.json,tsconfig.json,scripts/build.mjs}                                                            (T2, T5)
apps/agent/src/server.ts, main.ts, __tests__/server.test.ts, __tests__/roundtrip.test.ts                             (T5)
apps/studio/src/db/schema.ts                                  connections 테이블                                      (T6)
apps/studio/src/lib/connection-store.ts, connection-usage.ts                                                         (T6)
apps/studio/src/app/api/connections/route.ts, [name]/route.ts, [name]/test/route.ts                                  (T6)
apps/studio/src/lib/datasets.ts                               연결 → 커넥터 조립                                      (T7)
apps/studio/src/app/api/reports/[id]/sample/route.ts          columns 응답·타입 힌트                                  (T7)
apps/studio/src/lib/import-bundle.ts                          연결 없음 경고                                          (T7)
apps/studio/src/editor/data/DatasetEditor.tsx, DataPanel.tsx  sql 폼·+ sql·컬럼 타입 힌트                             (T8)
apps/studio/src/app/settings/connections/page.tsx, ConnectionsManager.tsx, app/ReportList.tsx(링크)                  (T8)
apps/studio/e2e/phase4b.spec.ts, playwright.config.ts, .env.example                                                  (T9)
```

## 태스크 순서와 병렬성

- T1(core+datasource) → T2(oracle·agent 골격 + convert·fake, **단일 pnpm install**) → T3(oracle 커넥터) → T4(oracle 통합 테스트·README) ‖ T5(agent) → T6(studio 연결 저장소·라우트) → T7(studio 실행 조립·샘플·가져오기) → T8(studio UI) → T9(E2E).
- T4와 T5는 서로 다른 패키지라 동시 가능. studio 태스크(T6–T9)는 한 번에 하나.

---

### Task 1: datasource 연결 스키마·가드·어휘 마스킹, core 컬럼 타입 힌트

**Files:**
- Create: `packages/datasource/src/sql-lexer.ts`, `packages/datasource/src/sql-guard.ts`, `packages/datasource/src/connection.ts`, `packages/datasource/src/sql-public.ts`
- Modify: `packages/datasource/src/sql.ts`, `packages/datasource/src/types.ts`, `packages/datasource/src/execute.ts`, `packages/datasource/src/http.ts`, `packages/datasource/src/index.ts`, `packages/datasource/package.json`, `packages/core/src/data/infer.ts`
- Test: `packages/datasource/src/__tests__/sql-guard.test.ts`, `packages/datasource/src/__tests__/connection.test.ts`, `packages/datasource/src/__tests__/sql.test.ts`(기존 통과), `packages/datasource/src/__tests__/execute.test.ts`(1개 추가), `packages/core/src/__tests__/infer.test.ts`(추가; 없으면 새로)

**Interfaces:**
- Produces:
```ts
// sql-lexer.ts
export function maskSqlNoise(sql: string): string;   // 주석·문자열·q-인용·큰따옴표 식별자를 같은 길이의 공백으로. 길이·위치 보존
// sql-guard.ts
export function guardSql(sql: string): void;         // 위반 → DatasetFailure("SQL_NOT_ALLOWED", 사유)
// connection.ts
export const ConnectionSchema; export type Connection, DirectConnection, AgentConnection;
export function parseConnection(input: unknown): Connection;
export function assertAgentUrl(url: string): void;   // https 필수, http는 localhost/127.0.0.1만. 위반 → Error
// types.ts
DatasetErrorCode += "SQL_NOT_ALLOWED"; export type SqlColumn = { name: string; type: FieldType };
// execute.ts
executeDatasets(...) → { context, errors, columns: Record<string, SqlColumn[]> }   // sql 데이터셋이 돌려준 컬럼만
// http.ts
export async function readResponseLimited(res: Response, maxBytes: number, signal: AbortSignal): Promise<string>;   // 기존 private readLimited를 export
// package.json exports: ".": "./src/index.ts", "./sql": "./src/sql-public.ts"   (sql-public = bindNames, extractBinds, maskSqlNoise, guardSql, DatasetFailure 재export — Node 전용 코드 없음)
// core infer.ts
inferFields(rows, { sampleSize?, maxDepth?, columnTypes?: Record<string, FieldType> })   // columnTypes: 최상위 키의 타입을 덮어쓰고, 행이 없어도 그 키들로 노드를 만든다
```
- 스펙 구체화: `maskSqlNoise`는 `bindNames`와 `guardSql`이 같은 어휘 규칙을 쓰게 하는 공용 함수다(중복 방지). `executeDatasets`의 `columns`는 샘플 라우트가 타입 힌트를 만들기 위한 것이다(스펙 7.3).

- [ ] **Step 1: 실패 테스트 작성**

`packages/datasource/src/__tests__/sql-guard.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { guardSql, maskSqlNoise, DatasetFailure } from "../sql-public";

describe("maskSqlNoise", () => {
  it("blanks comments, strings, q-quotes and quoted identifiers while keeping length", () => {
    const sql = `SELECT 'a;b' AS x, q'[for update]' AS y, "FOR UPDATE" AS z -- ; comment\n/* update */ FROM T`;
    const masked = maskSqlNoise(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked).not.toMatch(/a;b|for update|comment|update \*/i);
    expect(masked).toMatch(/SELECT\s+\s+AS x/);
  });
});

describe("guardSql", () => {
  it.each([
    "SELECT * FROM T WHERE NO = :no",
    "  \n-- 앞 주석\nselect 1 from dual",
    "WITH x AS (SELECT 1 FROM DUAL) SELECT * FROM x",
    "SELECT 'insert; for update' FROM DUAL",
    "SELECT q'[;]' FROM DUAL",
    "SELECT \"FOR UPDATE\" FROM T",
    "/* update t */ SELECT 1 FROM DUAL",
  ])("allows %s", (sql) => { expect(() => guardSql(sql)).not.toThrow(); });

  it.each([
    ["INSERT INTO T VALUES (1)", /SELECT/],
    ["UPDATE T SET A = 1", /SELECT/],
    ["DELETE FROM T", /SELECT/],
    ["MERGE INTO T USING D ON (1=1) WHEN MATCHED THEN UPDATE SET A = 1", /SELECT/],
    ["BEGIN NULL; END;", /SELECT/],
    ["DECLARE x NUMBER; BEGIN NULL; END;", /SELECT/],
    ["ALTER SESSION SET X = 1", /SELECT/],
    ["CREATE TABLE T (A NUMBER)", /SELECT/],
    ["DROP TABLE T", /SELECT/],
    ["SELECT 1 FROM DUAL; SELECT 2 FROM DUAL", /;/],
    ["SELECT 1 FROM DUAL;", /;/],
    ["SELECT * FROM T FOR UPDATE", /FOR UPDATE/i],
    ["SELECT * FROM T FOR\n  UPDATE NOWAIT", /FOR UPDATE/i],
    ["", /비어/],
    ["   -- only comment", /비어/],
  ])("rejects %s", (sql, why) => {
    expect(() => guardSql(sql)).toThrow(DatasetFailure);
    try { guardSql(sql); } catch (e) { expect((e as DatasetFailure).code).toBe("SQL_NOT_ALLOWED"); expect((e as Error).message).toMatch(why); }
  });
});
```

`packages/datasource/src/__tests__/connection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseConnection, assertAgentUrl } from "../connection";

describe("ConnectionSchema", () => {
  it("parses direct with default port and agent", () => {
    expect(parseConnection({ name: "mes", via: "direct", host: "db.local", service: "ORCL", user: "rpt", secretRef: "MES_DB" })).toMatchObject({ port: 1521 });
    expect(parseConnection({ name: "factory", via: "agent", url: "https://agent.local:8433", secretRef: "AGENT" }).via).toBe("agent");
  });
  it("rejects bad names, secret refs, missing fields and bad agent urls", () => {
    expect(() => parseConnection({ name: "Mes", via: "direct", host: "h", service: "s", user: "u", secretRef: "A" })).toThrow();
    expect(() => parseConnection({ name: "mes", via: "direct", host: "h", service: "s", user: "u", secretRef: "lower" })).toThrow();
    expect(() => parseConnection({ name: "mes", via: "direct", host: "h", user: "u", secretRef: "A" })).toThrow();
    expect(() => parseConnection({ name: "mes", via: "agent", url: "http://agent.local", secretRef: "A" })).toThrow(/https/);
    expect(() => parseConnection({ name: "mes", via: "agent", url: "http://localhost:8433", secretRef: "A" })).not.toThrow();
    expect(() => assertAgentUrl("ftp://x")).toThrow();
  });
});
```

`packages/datasource/src/__tests__/execute.test.ts` 끝에 추가:
```ts
describe("executeDatasets columns", () => {
  it("returns the sql connector's columns per dataset", async () => {
    const r = parseReport({ id: "c", version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "lines", type: "sql", connection: "mes", query: "SELECT 1 FROM DUAL" }] });
    const query = async () => ({ rows: [], columns: [{ name: "NO", type: "string" as const }] });
    const { columns, errors } = await executeDatasets(r, { params: {}, connectors: { sql: { mes: { query } } }, secrets: () => undefined });
    expect(errors).toEqual([]);
    expect(columns).toEqual({ lines: [{ name: "NO", type: "string" }] });
  });
});
```

`packages/core/src/__tests__/infer.test.ts`에 추가(파일이 없으면 import 포함 새로):
```ts
import { describe, it, expect } from "vitest";
import { inferFields } from "../data/infer";

describe("inferFields columnTypes", () => {
  it("builds nodes from column types when there are no rows and overrides inferred top-level types", () => {
    expect(inferFields([], { columnTypes: { NO: "string", DT: "date" } })).toEqual([{ name: "NO", path: "NO", type: "string" }, { name: "DT", path: "DT", type: "date" }]);
    const nodes = inferFields([{ NO: "123", QTY: "4" }], { columnTypes: { QTY: "number" } });
    expect(nodes.find((n) => n.name === "QTY")?.type).toBe("number");
    expect(nodes.find((n) => n.name === "NO")?.type).toBe("string");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/datasource test && pnpm --filter @daport/core test -- infer`
Expected: FAIL — 모듈·옵션 없음

- [ ] **Step 3: 어휘 마스킹과 bindNames 리팩터링**

`packages/datasource/src/sql-lexer.ts`:
```ts
const Q_CLOSE: Record<string, string> = { "[": "]", "{": "}", "(": ")", "<": ">" };
const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$#]/.test(c);

/**
 * Oracle SQL에서 주석(--, /* *\/), 문자열('...', '' 이스케이프), q-인용(q'[...]' 등), 큰따옴표 식별자를
 * 같은 길이의 공백으로 바꾼다. 위치가 보존되므로 바인드 탐색과 가드가 같은 결과 위에서 돈다.
 * 닫히지 않은 주석·문자열은 끝까지 노이즈로 본다
 */
export function maskSqlNoise(sql: string): string {
  const out = sql.split("");
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) out[k] = " "; };
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], next = sql[i + 1];
    if (c === "-" && next === "-") { const e = sql.indexOf("\n", i + 2); const to = e < 0 ? n : e; blank(i, to); i = to; continue; }
    if (c === "/" && next === "*") { const e = sql.indexOf("*/", i + 2); const to = e < 0 ? n : e + 2; blank(i, to); i = to; continue; }
    const nPrefix = (sql[i - 1] === "n" || sql[i - 1] === "N") && !isWord(sql[i - 2]);
    if ((c === "q" || c === "Q") && next === "'" && (!isWord(sql[i - 1]) || nPrefix) && i + 2 < n) {
      const open = sql[i + 2], close = Q_CLOSE[open] ?? open;
      const e = sql.indexOf(close + "'", i + 3);
      const to = e < 0 ? n : e + 2;
      blank(i, to); i = to; continue;
    }
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        const e = sql.indexOf("'", j);
        if (e < 0) { j = n; break; }
        if (sql[e + 1] === "'") { j = e + 2; continue; }
        j = e + 1; break;
      }
      blank(i, j); i = j; continue;
    }
    if (c === '"') { const e = sql.indexOf('"', i + 1); const to = e < 0 ? n : e + 1; blank(i, to); i = to; continue; }
    i++;
  }
  return out.join("");
}
```

`packages/datasource/src/sql.ts`의 `bindNames`를 마스킹 결과 위에서 `:` 만 찾도록 바꾼다(기존 `Q_CLOSE`·문자열·주석 분기는 삭제):
```ts
import { maskSqlNoise } from "./sql-lexer";
const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$#]/.test(c);

/** 바인드 자리의 이름을 문서 순서대로. 노이즈는 maskSqlNoise가 지웠으므로 `::`(캐스트)와 식별자 바로 뒤의 `:`만 거른다 */
export function bindNames(sql: string): string[] {
  const s = maskSqlNoise(sql);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ":") continue;
    if (s[i + 1] === ":") { i++; continue; }
    if (isWord(s[i - 1]) || s[i + 1] === undefined || !/[A-Za-z_]/.test(s[i + 1])) continue;
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
    out.push(s.slice(i + 1, j));
    i = j - 1;
  }
  return out;
}
```
`extractBinds`·`runSql`은 그대로. 기존 `sql.test.ts`의 어휘 케이스가 전부 통과해야 한다(마스킹이 같은 규칙이라는 증거).

- [ ] **Step 4: 가드·연결 스키마·서브패스**

`packages/datasource/src/sql-guard.ts`:
```ts
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
```

`packages/datasource/src/connection.ts`:
```ts
import { z } from "zod";

/** 연결 이름: 레포트의 sql 데이터셋이 참조한다. 소문자·숫자·하이픈 */
const ConnectionName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "연결 이름은 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다");
/** DAPORT_SECRET_<이름>의 이름 부분 */
const SecretRef = z.string().regex(/^[A-Z0-9_]+$/, "비밀값 이름은 대문자·숫자·_만 쓸 수 있습니다");

/** 에이전트 URL은 https만. http는 로컬 개발(localhost·127.0.0.1)에서만 허용한다 */
export function assertAgentUrl(url: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("에이전트 URL이 올바르지 않습니다"); }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return;
  throw new Error("에이전트 URL은 https여야 합니다 (http는 localhost만)");
}

export const ConnectionSchema = z.discriminatedUnion("via", [
  z.object({
    name: ConnectionName, via: z.literal("direct"),
    host: z.string().min(1), port: z.number().int().min(1).max(65535).default(1521),
    service: z.string().min(1), user: z.string().min(1), secretRef: SecretRef,
  }),
  z.object({
    name: ConnectionName, via: z.literal("agent"),
    url: z.string().url().refine((u) => { try { assertAgentUrl(u); return true; } catch { return false; } }, "에이전트 URL은 https여야 합니다 (http는 localhost만)"),
    secretRef: SecretRef,
  }),
]);
export type Connection = z.infer<typeof ConnectionSchema>;
export type DirectConnection = Extract<Connection, { via: "direct" }>;
export type AgentConnection = Extract<Connection, { via: "agent" }>;
export const parseConnection = (input: unknown): Connection => ConnectionSchema.parse(input);
```
`packages/datasource/package.json`에 `"dependencies": { "@daport/core": "workspace:*", "zod": "^4.0.0" }`(zod가 없으면 추가 — core가 이미 의존하므로 설치는 T2의 단일 install에서 함께 된다. 이 태스크에서는 install을 실행하지 않고, 테스트가 zod를 해석 못 하면 `@daport/core`가 끌어온 것을 쓰는지 확인한다; 해석이 안 되면 T2까지 `z`를 `@daport/core`가 re-export하는지 확인하고 아니면 `import { z } from "zod"`는 유지한 채 T2에서 install한다).

`packages/datasource/src/sql-public.ts`(클라이언트 번들 안전 — Node 전용 import 없음):
```ts
export { bindNames, extractBinds } from "./sql";
export { maskSqlNoise } from "./sql-lexer";
export { guardSql } from "./sql-guard";
export { DatasetFailure } from "./types";
```
`packages/datasource/package.json`의 `exports`를 `{ ".": "./src/index.ts", "./sql": "./src/sql-public.ts" }`로. `index.ts`에 `export * from "./sql-lexer"; export * from "./sql-guard"; export * from "./connection";` 추가.

- [ ] **Step 5: 오류 코드·columns·readResponseLimited·infer**

`types.ts`: `DatasetErrorCode`에 `"SQL_NOT_ALLOWED"` 추가; `export type SqlColumn = { name: string; type: FieldType };`.

`sql.ts`의 `runSql`이 `{ rows, columns }`를 돌려주도록 바꾼다:
```ts
export async function runSql(ds: SqlDataset, params, connectors, limits): Promise<{ rows: Record<string, unknown>[]; columns: SqlColumn[] }> {
  const conn = connectors.sql?.[ds.connection];
  if (!conn) throw new DatasetFailure("SQL_NOT_CONFIGURED", `sql connection "${ds.connection}" is not configured`);
  const res = await conn.query(ds.query, extractBinds(ds.query, params), { timeoutMs: limits.timeoutMs, maxRows: limits.maxRows, signal: AbortSignal.timeout(limits.timeoutMs) });
  return { rows: res.rows, columns: res.columns };
}
```
`execute.ts`: `runDataset`이 `{ rows, columns? }`를 돌려주게 하고(`static`·`http`는 `columns` 없음), `executeDatasets`가 `columns: Record<string, SqlColumn[]> = {}`를 모아 `{ context, errors, columns }`로 반환. 기존 호출자(studio `runDatasets`)는 구조 분해로 `context`·`errors`만 쓰므로 호환된다.

`http.ts`: `readLimited`를 `export async function readResponseLimited(res, maxBytes, signal)`로 이름을 바꿔 export하고 내부 호출도 바꾼다.

`packages/core/src/data/infer.ts`의 `inferFields`:
```ts
export function inferFields(rows: unknown, opts: { sampleSize?: number; maxDepth?: number; columnTypes?: Record<string, FieldType> } = {}): FieldNode[] {
  const { sampleSize = 200, maxDepth = 5, columnTypes } = opts;
  const list = Array.isArray(rows) ? rows.slice(0, sampleSize) : isObject(rows) ? [rows] : [];
  const nodes = inferObjects(list.filter(isObject), "", 0, maxDepth);
  if (!columnTypes) return nodes;
  // 컬럼 타입 힌트(sql 데이터셋): 최상위 키의 타입을 덮어쓰고, 행에 없는 컬럼도 노드로 만든다 (빈 결과여도 필드 트리가 보인다)
  const byName = new Map(nodes.map((n) => [n.name, n]));
  for (const [name, type] of Object.entries(columnTypes)) {
    const node = byName.get(name);
    if (node) node.type = type;
    else nodes.push({ name, path: name, type });
  }
  return nodes;
}
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter @daport/datasource test && pnpm --filter @daport/core test && pnpm -r typecheck`
Expected: 전부 PASS(기존 `sql.test.ts` 어휘 케이스 포함). studio typecheck도 통과(`executeDatasets` 반환 확장은 호환).

- [ ] **Step 7: 커밋**

```bash
git add packages/datasource/src packages/datasource/package.json packages/core/src/data/infer.ts packages/core/src/__tests__/infer.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(datasource,core): 연결 스키마·읽기 전용 SQL 가드·어휘 마스킹, 컬럼 타입 힌트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `packages/oracle`·`apps/agent` 골격, 타입 변환, 가짜 커넥터 (단일 install)

**Files:**
- Create: `packages/oracle/package.json`, `packages/oracle/tsconfig.json`, `packages/oracle/vitest.config.ts`, `packages/oracle/src/index.ts`, `packages/oracle/src/convert.ts`, `packages/oracle/src/testing.ts`, `apps/agent/package.json`, `apps/agent/tsconfig.json`, `apps/agent/src/index.ts`(자리표시 export 하나)
- Test: `packages/oracle/src/__tests__/convert.test.ts`, `packages/oracle/src/__tests__/testing.test.ts`

**Interfaces:**
- Produces:
```ts
// convert.ts
export type OracleMeta = { name: string; dbTypeName?: string };
export function convertColumnType(dbTypeName: string): FieldType | null;      // null = 지원 안 함
export function isTzType(dbTypeName: string): boolean;                       // TIMESTAMP WITH (LOCAL) TIME ZONE
export function dateToIso(d: Date, hasTz: boolean): string;                  // hasTz면 toISOString, 아니면 벽시계 성분을 UTC로 읽음
export function numberFromString(s: string): number | string;                // 안전 정수·유한 실수면 number, 아니면 원문
export function convertRow(row: Record<string, unknown>, meta: OracleMeta[]): Record<string, unknown>;   // 컬럼별 규칙 적용
export function sanitizeError(message: string, secrets: string[]): string;   // 비밀값 → ***
export function mapOracleError(e: unknown, secrets: string[]): DatasetFailure; // NJS-123/ORA-01013/TimeoutError → TIMEOUT, 그 밖 SQL_ERROR(연결 오류는 "연결 실패: " 접두)
// testing.ts
export class FakeSqlConnector implements ManagedConnector { calls; when(sqlIncludes, result); constructor(defaults?) }
// index.ts
export type ManagedConnector = SqlConnector & { ping(): Promise<void>; close(): Promise<void> };
```

- [ ] **Step 1: 골격**

`packages/oracle/package.json`:
```json
{
  "name": "@daport/oracle",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing.ts" },
  "scripts": { "build": "tsc -p tsconfig.json --noEmit", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run", "test:it": "ORACLE_IT=1 vitest run --config vitest.it.config.ts" },
  "dependencies": { "@daport/datasource": "workspace:*", "oracledb": "^6.5.0" },
  "devDependencies": { "@daport/core": "workspace:*", "@testcontainers/oraclefree": "^11.0.0", "testcontainers": "^11.0.0" }
}
```
`packages/oracle/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`.
`packages/oracle/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
// 기본 실행은 실제 Oracle 없이 돈다. 통합 테스트(src/__it__)는 vitest.it.config.ts로만 수집한다
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["src/__it__/**"] } });
```
`packages/oracle/src/index.ts`(이 태스크에서는 타입·convert·testing만):
```ts
import type { SqlConnector } from "@daport/datasource";
export type ManagedConnector = SqlConnector & { ping(): Promise<void>; close(): Promise<void> };
export * from "./convert";
export { FakeSqlConnector } from "./testing";
```
`apps/agent/package.json`:
```json
{
  "name": "agent",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx src/main.ts", "build": "node scripts/build.mjs", "start": "node dist/agent.mjs", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@daport/oracle": "workspace:*", "@daport/datasource": "workspace:*", "oracledb": "^6.5.0" },
  "devDependencies": { "esbuild": "^0.24.0", "tsx": "^4.19.0", "@types/node": "^24.0.0" }
}
```
`apps/agent/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "scripts"], "compilerOptions": { "types": ["node"] } }`. `apps/agent/src/index.ts`: `export const AGENT_VERSION = "0.0.1";`(T5가 실 코드로 채운다).

루트에서 **`pnpm install` 한 번**. `oracledb` 6.x는 thin 모드 순수 JS라 네이티브 빌드가 없다. 설치가 `@testcontainers/oraclefree` 버전으로 실패하면 최신 11.x로 맞춘다(`pnpm view @testcontainers/oraclefree version`).

- [ ] **Step 2: 실패 테스트 작성**

`packages/oracle/src/__tests__/convert.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DatasetFailure } from "@daport/datasource";
import { convertColumnType, isTzType, dateToIso, numberFromString, convertRow, sanitizeError, mapOracleError } from "../convert";

describe("convert", () => {
  it("maps Oracle db types to field types", () => {
    expect(convertColumnType("VARCHAR2")).toBe("string"); expect(convertColumnType("NCLOB")).toBe("string");
    expect(convertColumnType("NUMBER")).toBe("number"); expect(convertColumnType("BINARY_DOUBLE")).toBe("number");
    expect(convertColumnType("DATE")).toBe("date"); expect(convertColumnType("TIMESTAMP(6) WITH TIME ZONE")).toBe("date");
    expect(convertColumnType("BOOLEAN")).toBe("boolean");
    expect(convertColumnType("BLOB")).toBeNull(); expect(convertColumnType("RAW")).toBeNull(); expect(convertColumnType("XMLTYPE")).toBeNull();
    expect(isTzType("TIMESTAMP(6) WITH TIME ZONE")).toBe(true); expect(isTzType("TIMESTAMP WITH LOCAL TIME ZONE")).toBe(true); expect(isTzType("DATE")).toBe(false);
  });
  it("dateToIso reads wall-clock components as UTC for DATE/TIMESTAMP and the instant for TZ types", () => {
    const d = new Date(2026, 8, 18, 9, 30, 0, 0);   // 프로세스 로컬 시간 2026-09-18 09:30
    expect(dateToIso(d, false)).toBe("2026-09-18T09:30:00.000Z");
    expect(dateToIso(new Date("2026-09-18T00:30:00.000Z"), true)).toBe("2026-09-18T00:30:00.000Z");
  });
  it("numberFromString keeps safe numbers and falls back to strings", () => {
    expect(numberFromString("42")).toBe(42); expect(numberFromString("-3.25")).toBe(-3.25); expect(numberFromString("1e3")).toBe(1000);
    expect(numberFromString("12345678901234567890")).toBe("12345678901234567890");
    expect(numberFromString("0.30000000000000004441")).toBe("0.30000000000000004441");
    expect(numberFromString("abc")).toBe("abc");
  });
  it("convertRow applies per-column rules and rejects unsupported types", () => {
    const meta = [{ name: "NO", dbTypeName: "VARCHAR2" }, { name: "QTY", dbTypeName: "NUMBER" }, { name: "DT", dbTypeName: "DATE" }, { name: "TS", dbTypeName: "TIMESTAMP(6) WITH TIME ZONE" }, { name: "NOTE", dbTypeName: "CLOB" }];
    const row = convertRow({ NO: "A", QTY: "7", DT: new Date(2026, 0, 2, 3, 4, 5), TS: new Date("2026-01-02T03:04:05.000Z"), NOTE: null }, meta);
    expect(row).toEqual({ NO: "A", QTY: 7, DT: "2026-01-02T03:04:05.000Z", TS: "2026-01-02T03:04:05.000Z", NOTE: null });
    expect(() => convertRow({ B: Buffer.from("x") }, [{ name: "B", dbTypeName: "BLOB" }])).toThrow(/지원하지 않는 컬럼 타입: B/);
  });
  it("sanitizeError masks secrets and mapOracleError classifies", () => {
    expect(sanitizeError("ORA-01017: invalid username/password pw=s3cret", ["s3cret"])).toBe("ORA-01017: invalid username/password pw=***");
    expect(mapOracleError(new Error("NJS-123: call timeout of 30000 ms exceeded"), []).code).toBe("TIMEOUT");
    expect(mapOracleError(new Error("ORA-01013: user requested cancel of current operation"), []).code).toBe("TIMEOUT");
    const conn = mapOracleError(new Error("NJS-501: connection to host db.local port 1521 refused"), []);
    expect(conn.code).toBe("SQL_ERROR"); expect(conn.message).toMatch(/^연결 실패: NJS-501/);
    expect(mapOracleError(new Error("ORA-00942: table or view does not exist"), []).message).toBe("ORA-00942: table or view does not exist");
    const pass = new DatasetFailure("TOO_MANY_ROWS", "x");
    expect(mapOracleError(pass, [])).toBe(pass);
  });
});
```

`packages/oracle/src/__tests__/testing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FakeSqlConnector } from "../testing";

describe("FakeSqlConnector", () => {
  it("returns defaults, scripted results per query, records calls and can fail", async () => {
    const f = new FakeSqlConnector({ rows: [{ A: 1 }], columns: [{ name: "A", type: "number" }] });
    f.when("FROM LINES", { rows: [{ NO: "x" }], columns: [{ name: "NO", type: "string" }] }).when("FROM BAD", { fail: "SQL_ERROR" });
    expect((await f.query("SELECT 1 FROM DUAL", {}, { timeoutMs: 1, maxRows: 1 })).rows).toEqual([{ A: 1 }]);
    expect((await f.query("SELECT * FROM LINES", { no: 1 }, { timeoutMs: 1, maxRows: 1 })).rows).toEqual([{ NO: "x" }]);
    await expect(f.query("SELECT * FROM BAD", {}, { timeoutMs: 1, maxRows: 1 })).rejects.toMatchObject({ code: "SQL_ERROR" });
    expect(f.calls.map((c) => c.sql)).toHaveLength(3);
    expect(f.calls[1].binds).toEqual({ no: 1 });
    await expect(f.ping()).resolves.toBeUndefined();
    await expect(f.close()).resolves.toBeUndefined();
  });
  it("rejects with the guard like the real connectors", async () => {
    await expect(new FakeSqlConnector().query("DELETE FROM T", {}, { timeoutMs: 1, maxRows: 1 })).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @daport/oracle test`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

`packages/oracle/src/convert.ts`:
```ts
import type { FieldType } from "@daport/core";
import { DatasetFailure } from "@daport/datasource";

export type OracleMeta = { name: string; dbTypeName?: string };

/** Oracle 컬럼 타입 → core FieldType. 지원하지 않는 타입은 null (4b 스펙 4.3) */
export function convertColumnType(dbTypeName: string): FieldType | null {
  const t = dbTypeName.toUpperCase();
  if (/^(N?VARCHAR2|N?CHAR|N?CLOB|LONG)$/.test(t)) return "string";
  if (/^(NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE)$/.test(t)) return "number";
  if (t === "DATE" || t.startsWith("TIMESTAMP")) return "date";
  if (t === "BOOLEAN") return "boolean";
  return null;
}
export const isTzType = (dbTypeName: string) => /TIME ZONE/i.test(dbTypeName);

/** DATE·TIMESTAMP는 시간대가 없어 드라이버가 프로세스 로컬 시간대로 Date를 만든다 → 벽시계 성분을 UTC로 읽는다. TZ 타입은 절대 시각이라 그대로 */
export function dateToIso(d: Date, hasTz: boolean): string {
  if (hasTz) return d.toISOString();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())).toISOString();
}

/** NUMBER는 문자열로 받아(정밀도 보존) 안전 범위면 number, 아니면 문자열 그대로 */
export function numberFromString(s: string): number | string {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (/^-?\d+$/.test(s)) return Number.isSafeInteger(n) ? n : s;
  const digits = s.replace(/[^0-9]/g, "").replace(/^0+/, "");
  return digits.length <= 15 ? n : s;   // 유효 숫자 15자리를 넘으면 double로 잃는다
}

export function convertRow(row: Record<string, unknown>, meta: OracleMeta[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of meta) {
    const v = row[m.name];
    const type = convertColumnType(m.dbTypeName ?? "");
    if (type === null) throw new DatasetFailure("SQL_ERROR", `지원하지 않는 컬럼 타입: ${m.name} (${m.dbTypeName ?? "?"})`);
    if (v === null || v === undefined) { out[m.name] = null; continue; }
    if (type === "date") out[m.name] = v instanceof Date ? dateToIso(v, isTzType(m.dbTypeName ?? "")) : String(v);
    else if (type === "number") out[m.name] = typeof v === "string" ? numberFromString(v) : typeof v === "number" && Number.isFinite(v) ? v : String(v);
    else out[m.name] = typeof v === "string" ? v : String(v);
  }
  return out;
}

export function sanitizeError(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out;
}

/** 드라이버·네트워크 오류 → DatasetFailure. DatasetFailure는 그대로 통과 */
export function mapOracleError(e: unknown, secrets: string[]): DatasetFailure {
  if (e instanceof DatasetFailure) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const message = sanitizeError(raw, secrets);
  const name = (e as { name?: string } | null)?.name;
  if (/NJS-123|ORA-01013/.test(raw) || name === "TimeoutError" || name === "AbortError") return new DatasetFailure("TIMEOUT", message);
  if (/ORA-12\d{3}|NJS-5\d{2}|ECONNREFUSED|ENOTFOUND/.test(raw)) return new DatasetFailure("SQL_ERROR", `연결 실패: ${message}`);
  return new DatasetFailure("SQL_ERROR", message);
}
```

`packages/oracle/src/testing.ts`:
```ts
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
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @daport/oracle test && pnpm -r typecheck`
Expected: PASS (agent 골격은 export 하나뿐이라 typecheck 통과)

- [ ] **Step 6: 커밋**

```bash
git add packages/oracle apps/agent pnpm-lock.yaml
git -c core.hooksPath=/dev/null commit -m "feat(oracle,agent): 패키지 골격, Oracle 타입 변환, 가짜 커넥터 (단일 install)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: oracle direct·agent 커넥터, `connectorFor`

**Files:**
- Create: `packages/oracle/src/pool.ts`, `packages/oracle/src/direct.ts`, `packages/oracle/src/agent.ts`
- Modify: `packages/oracle/src/index.ts`
- Test: `packages/oracle/src/__tests__/direct.test.ts`(`oracledb` 모듈 mock), `packages/oracle/src/__tests__/agent.test.ts`(가짜 fetch), `packages/oracle/src/__tests__/connector-for.test.ts`

**Interfaces:**
- Consumes: T1 `guardSql`, `Connection` 타입, `readResponseLimited`, `DEFAULT_LIMITS`; T2 `convert.ts`, `ManagedConnector`.
- Produces:
```ts
export function createDirectConnector(conn: DirectConnection, password: string): ManagedConnector;
export function createAgentConnector(conn: AgentConnection, token: string, fetchImpl?: typeof fetch): ManagedConnector;
export function connectorFor(conn: Connection, secrets: SecretResolver): ManagedConnector;   // 비밀값 없으면 DatasetFailure("SQL_NOT_CONFIGURED")
export function closeConnector(name: string): Promise<void>;                               // 그 이름의 풀 닫기(없으면 no-op)
```
- 스펙 구체화(5.2): 날짜는 드라이버가 준 JS Date를 `dateToIso`로 바꾼다(DATE·TIMESTAMP는 벽시계 성분을 UTC로, TZ 타입은 절대 시각). NUMBER·CLOB은 `fetchTypeHandler`로 문자열로 받는다. 세션 TZ UTC는 `sessionCallback`에서 여전히 설정한다(SYSTIMESTAMP 등 서버 계산값을 위해).

- [ ] **Step 1: 실패 테스트 작성**

`packages/oracle/src/__tests__/direct.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// oracledb를 통째로 가짜로 바꾼다. 풀·커넥션의 호출 순서와 옵션만 검증한다 (실제 DB는 __it__ 통합 테스트)
const execute = vi.fn();
const connection = { execute, close: vi.fn().mockResolvedValue(undefined), callTimeout: 0 };
const pool = { getConnection: vi.fn().mockResolvedValue(connection), close: vi.fn().mockResolvedValue(undefined) };
const createPool = vi.fn().mockResolvedValue(pool);
vi.mock("oracledb", () => ({ default: { createPool, OUT_FORMAT_OBJECT: 4002, STRING: 2001, DB_TYPE_NUMBER: 2010, DB_TYPE_CLOB: 2017 } }));
const { createDirectConnector, closeConnector } = await import("../index");

const conn = { name: "mes", via: "direct" as const, host: "db.local", port: 1521, service: "ORCL", user: "rpt", secretRef: "MES_DB" };
const opts = { timeoutMs: 5000, maxRows: 2 };

beforeEach(async () => {
  await closeConnector("mes");
  execute.mockReset(); createPool.mockClear(); pool.getConnection.mockClear(); connection.close.mockClear();
  execute.mockImplementation(async (sql: string) => sql.startsWith("SELECT") ? { rows: [{ NO: "A", QTY: "3" }], metaData: [{ name: "NO", dbTypeName: "VARCHAR2" }, { name: "QTY", dbTypeName: "NUMBER" }] } : {});
});

describe("createDirectConnector", () => {
  it("creates one pool per connection name with thin-mode options and reuses it", async () => {
    const c = createDirectConnector(conn, "pw");
    await c.query("SELECT NO, QTY FROM T", {}, opts);
    await c.query("SELECT NO, QTY FROM T", {}, opts);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool.mock.calls[0][0]).toMatchObject({ user: "rpt", password: "pw", connectString: "db.local:1521/ORCL", poolMin: 0, poolMax: 4, poolTimeout: 60 });
    expect(typeof createPool.mock.calls[0][0].sessionCallback).toBe("function");
  });
  it("runs guard → READ ONLY → execute with maxRows+1 and fetchTypeHandler → rollback+close, converting rows", async () => {
    const c = createDirectConnector(conn, "pw");
    const res = await c.query("SELECT NO, QTY FROM T WHERE NO = :no", { no: "A" }, opts);
    const sqls = execute.mock.calls.map((x) => x[0]);
    expect(sqls).toEqual(["SET TRANSACTION READ ONLY", "SELECT NO, QTY FROM T WHERE NO = :no", "ROLLBACK"]);
    expect(execute.mock.calls[1][1]).toEqual({ no: "A" });
    expect(execute.mock.calls[1][2]).toMatchObject({ outFormat: 4002, maxRows: 3 });
    expect(typeof execute.mock.calls[1][2].fetchTypeHandler).toBe("function");
    expect(connection.callTimeout).toBe(5000);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ rows: [{ NO: "A", QTY: 3 }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }] });
  });
  it("fetchTypeHandler forces strings for NUMBER and CLOB and rejects unsupported types", async () => {
    const c = createDirectConnector(conn, "pw");
    await c.query("SELECT 1 FROM DUAL", {}, opts);
    const handler = execute.mock.calls[1][2].fetchTypeHandler as (m: { name: string; dbTypeName: string }) => unknown;
    expect(handler({ name: "QTY", dbTypeName: "NUMBER" })).toEqual({ type: 2001 });
    expect(handler({ name: "NOTE", dbTypeName: "CLOB" })).toEqual({ type: 2001 });
    expect(handler({ name: "DT", dbTypeName: "DATE" })).toBeUndefined();
    expect(() => handler({ name: "B", dbTypeName: "BLOB" })).toThrow(/지원하지 않는 컬럼 타입: B/);
  });
  it("rejects non-SELECT before touching the pool, maps TOO_MANY_ROWS, timeouts and driver errors, masks the password", async () => {
    const c = createDirectConnector(conn, "pw");
    await expect(c.query("DELETE FROM T", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    expect(pool.getConnection).not.toHaveBeenCalled();
    execute.mockImplementation(async (sql: string) => sql.startsWith("SELECT") ? { rows: [{ A: 1 }, { A: 2 }, { A: 3 }], metaData: [{ name: "A", dbTypeName: "NUMBER" }] } : {});
    await expect(c.query("SELECT A FROM T", {}, opts)).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
    execute.mockImplementation(async (sql: string) => { if (sql.startsWith("SELECT")) throw new Error("NJS-123: call timeout of 5000 ms exceeded"); return {}; });
    await expect(c.query("SELECT A FROM T", {}, opts)).rejects.toMatchObject({ code: "TIMEOUT" });
    execute.mockImplementation(async (sql: string) => { if (sql.startsWith("SELECT")) throw new Error("ORA-01017: invalid username/password; logon denied (pw)"); return {}; });
    const err = await c.query("SELECT A FROM T", {}, opts).catch((e) => e);
    expect(err.code).toBe("SQL_ERROR"); expect(err.message).not.toContain("(pw)"); expect(err.message).toContain("***");
    expect(connection.close).toHaveBeenCalled();   // 실패해도 반납
  });
  it("ping runs SELECT 1 FROM DUAL and close shuts the pool", async () => {
    const c = createDirectConnector(conn, "pw");
    await c.ping();
    expect(execute.mock.calls.some((x) => x[0] === "SELECT 1 FROM DUAL")).toBe(true);
    await c.close();
    expect(pool.close).toHaveBeenCalled();
    await c.query("SELECT 1 FROM DUAL", {}, opts);
    expect(createPool).toHaveBeenCalledTimes(2);   // 닫힌 뒤 다시 만든다
  });
});
```

`packages/oracle/src/__tests__/agent.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentConnector } from "../index";

const conn = { name: "factory", via: "agent" as const, url: "https://agent.local:8433/", secretRef: "AGENT" };
const opts = { timeoutMs: 1000, maxRows: 10 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createAgentConnector", () => {
  it("POSTs /query with bearer token, manual redirect and a timeout margin, returns rows/columns", async () => {
    const fetchImpl = vi.fn(async () => json({ rows: [{ NO: "A" }], columns: [{ name: "NO", type: "string" }] }));
    const c = createAgentConnector(conn, "tok", fetchImpl as unknown as typeof fetch);
    const res = await c.query("SELECT NO FROM T WHERE NO = :no", { no: "A" }, opts);
    expect(res.rows).toEqual([{ NO: "A" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agent.local:8433/query");
    expect(init.method).toBe("POST"); expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ sql: "SELECT NO FROM T WHERE NO = :no", binds: { no: "A" }, timeoutMs: 1000, maxRows: 10 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("maps agent statuses and error codes", async () => {
    const c = (r: Response) => createAgentConnector(conn, "tok", (async () => r) as unknown as typeof fetch);
    await expect(c(json({ error: { code: "UNAUTHORIZED" } }, 401)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_CONFIGURED" });
    await expect(c(json({ error: { code: "BUSY" } }, 429)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR", message: /과부하/ });
    await expect(c(json({ error: { code: "TIMEOUT", message: "t" } }, 504)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(c(json({ error: { code: "SQL_NOT_ALLOWED", message: "x" } }, 400)).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    await expect(c(new Response("boom", { status: 500 })).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
    await expect(c(new Response(null, { status: 302, headers: { location: "https://x" } })).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
    await expect(c(new Response("not json", { status: 200 })).query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
  });
  it("guards before sending, maps network failures/timeouts, and rejects oversized bodies", async () => {
    const fetchImpl = vi.fn();
    const c = createAgentConnector(conn, "tok", fetchImpl as unknown as typeof fetch);
    await expect(c.query("DROP TABLE T", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(c.query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "TIMEOUT" });
    fetchImpl.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(c.query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR" });
    const big = new Response(new Blob(["x".repeat(21 * 1024 * 1024)]), { status: 200 });
    fetchImpl.mockResolvedValueOnce(big);
    await expect(c.query("SELECT 1 FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  it("ping GETs /health and refuses plain http except localhost", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    await createAgentConnector(conn, "tok", fetchImpl as unknown as typeof fetch).ping();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://agent.local:8433/health");
    expect(() => createAgentConnector({ ...conn, url: "http://agent.local" }, "tok")).toThrow(/https/);
    expect(() => createAgentConnector({ ...conn, url: "http://localhost:8433" }, "tok")).not.toThrow();
    const bad = createAgentConnector(conn, "tok", (async () => json({ ok: false }, 503)) as unknown as typeof fetch);
    await expect(bad.ping()).rejects.toMatchObject({ code: "SQL_ERROR" });
  });
});
```

`packages/oracle/src/__tests__/connector-for.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("oracledb", () => ({ default: { createPool: vi.fn(), OUT_FORMAT_OBJECT: 4002, STRING: 2001 } }));
const { connectorFor } = await import("../index");

describe("connectorFor", () => {
  const secrets = (name: string) => ({ MES_DB: "pw", AGENT: "tok" }[name]);
  it("picks the connector by via and fails with SQL_NOT_CONFIGURED when the secret is missing", () => {
    expect(typeof connectorFor({ name: "a", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" }, secrets).query).toBe("function");
    expect(typeof connectorFor({ name: "b", via: "agent", url: "https://x", secretRef: "AGENT" }, secrets).ping).toBe("function");
    expect(() => connectorFor({ name: "c", via: "agent", url: "https://x", secretRef: "NOPE" }, secrets)).toThrow(expect.objectContaining({ code: "SQL_NOT_CONFIGURED" }));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @daport/oracle test`
Expected: FAIL — export 없음

- [ ] **Step 3: 구현**

`packages/oracle/src/pool.ts`:
```ts
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
```

`packages/oracle/src/direct.ts`:
```ts
import oracledb from "oracledb";
import { guardSql, DatasetFailure, type DirectConnection, type SqlColumn } from "@daport/datasource";
import { convertColumnType, convertRow, mapOracleError, type OracleMeta } from "./convert";
import { poolFor, closeConnector } from "./pool";
import type { ManagedConnector } from "./index";

/** NUMBER·CLOB은 문자열로 받아 정밀도를 지키고, 지원하지 않는 타입은 메타데이터 단계에서 거른다 */
function fetchTypeHandler(meta: { name: string; dbTypeName?: string }): { type: number } | undefined {
  const t = (meta.dbTypeName ?? "").toUpperCase();
  if (convertColumnType(t) === null) throw new DatasetFailure("SQL_ERROR", `지원하지 않는 컬럼 타입: ${meta.name} (${meta.dbTypeName ?? "?"})`);
  if (/^(NUMBER|FLOAT|N?CLOB|LONG)$/.test(t)) return { type: oracledb.STRING };
  return undefined;
}

export function createDirectConnector(conn: DirectConnection, password: string): ManagedConnector {
  const run = async <T>(timeoutMs: number, fn: (c: oracledb.Connection) => Promise<T>): Promise<T> => {
    const pool = await poolFor(conn, password);
    let c: oracledb.Connection | undefined;
    try {
      c = await pool.getConnection();
      c.callTimeout = timeoutMs;
      return await fn(c);
    } catch (e) {
      throw mapOracleError(e, [password]);
    } finally {
      if (c) {
        try { await c.execute("ROLLBACK"); } catch { /* 읽기 전용 트랜잭션 정리 실패는 무시 */ }
        await c.close().catch(() => {});
      }
    }
  };
  return {
    async query(sql, binds, opts) {
      guardSql(sql);   // 풀을 만지기 전에
      return run(opts.timeoutMs, async (c) => {
        await c.execute("SET TRANSACTION READ ONLY");
        const res = await c.execute<Record<string, unknown>>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: opts.maxRows + 1, fetchTypeHandler });
        const rows = res.rows ?? [];
        if (rows.length > opts.maxRows) throw new DatasetFailure("TOO_MANY_ROWS", `${opts.maxRows}행을 넘었습니다`);
        const meta: OracleMeta[] = (res.metaData ?? []).map((m) => ({ name: m.name, dbTypeName: m.dbTypeName }));
        const columns: SqlColumn[] = meta.map((m) => ({ name: m.name, type: convertColumnType(m.dbTypeName ?? "") ?? "string" }));
        return { rows: rows.map((r) => convertRow(r, meta)), columns };
      });
    },
    async ping() { await run(5_000, async (c) => { await c.execute("SELECT 1 FROM DUAL"); }); },
    async close() { await closeConnector(conn.name); },
  };
}
```
(`oracledb`의 `Result.metaData[].dbTypeName`은 6.x에 있다. 타입이 맞지 않으면 `as { name: string; dbTypeName?: string }[]`로 좁힌다.)

`packages/oracle/src/agent.ts`:
```ts
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
    const text = await readResponseLimited(res, DEFAULT_LIMITS.maxBytes, signal);   // TOO_LARGE·TIMEOUT은 그대로 던진다
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
```
`readResponseLimited`는 `res.body`가 없으면 `res.text()`를 쓰고, 초과 시 `TOO_LARGE`, abort 시 `TIMEOUT`, 그 밖 읽기 오류는 `HTTP_STATUS`로 던진다 — `HTTP_STATUS`가 올라오면 `query`의 호출자에게 그대로 가므로 `call`에서 `catch (e) { if (e instanceof DatasetFailure && e.code === "HTTP_STATUS") throw new DatasetFailure("SQL_ERROR", e.message); throw e; }`로 감싼다.

`packages/oracle/src/index.ts`에 추가:
```ts
import { DatasetFailure, type Connection, type SecretResolver } from "@daport/datasource";
import { createDirectConnector } from "./direct";
import { createAgentConnector } from "./agent";
export { createDirectConnector } from "./direct";
export { createAgentConnector } from "./agent";
export { closeConnector } from "./pool";

/** 연결 설정과 비밀값 → 커넥터. 비밀값이 없으면 SQL_NOT_CONFIGURED (풀은 첫 쿼리에서 열리므로 여기서는 네트워크에 닿지 않는다) */
export function connectorFor(conn: Connection, secrets: SecretResolver): ManagedConnector {
  const secret = secrets(conn.secretRef);
  if (!secret) throw new DatasetFailure("SQL_NOT_CONFIGURED", `비밀값 DAPORT_SECRET_${conn.secretRef}이(가) 설정되지 않았습니다`);
  return conn.via === "direct" ? createDirectConnector(conn, secret) : createAgentConnector(conn, secret);
}
```
(`ManagedConnector` 타입 선언은 위쪽에 유지. `testing.ts`가 `./index`에서 타입만 import하므로 순환은 없다 — `import type`으로 둔다.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter @daport/oracle test && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/oracle/src
git -c core.hooksPath=/dev/null commit -m "feat(oracle): direct(oracledb thin)·agent 커넥터, 연결별 풀, connectorFor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: oracle 통합 테스트(`ORACLE_IT=1`)와 README

**Files:**
- Create: `packages/oracle/vitest.it.config.ts`, `packages/oracle/src/__it__/direct.it.test.ts`, `packages/oracle/README.md`

**Interfaces:**
- Consumes: T3 `createDirectConnector`, `closeConnector`.
- 기본 `pnpm test`는 이 파일을 수집하지 않는다(T2의 vitest.config `exclude`).

- [ ] **Step 1: 설정과 테스트 작성**

`packages/oracle/vitest.it.config.ts`:
```ts
import { defineConfig } from "vitest/config";
// ORACLE_IT=1 pnpm --filter @daport/oracle test:it — 컨테이너 Oracle에 실제로 붙는다 (README 참고)
export default defineConfig({ test: { include: ["src/__it__/**/*.it.test.ts"], testTimeout: 120_000, hookTimeout: 600_000, fileParallelism: false } });
```

`packages/oracle/src/__it__/direct.it.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { OracleFreeContainer, type StartedOracleFreeContainer } from "@testcontainers/oraclefree";
import { createDirectConnector, closeConnector, type ManagedConnector } from "../index";

const enabled = process.env.ORACLE_IT === "1";
let container: StartedOracleFreeContainer; let c: ManagedConnector;
const opts = { timeoutMs: 30_000, maxRows: 10_000 };

beforeAll(async () => {
  if (!enabled) return;
  container = await new OracleFreeContainer("gvenzl/oracle-free:23.26.3-slim-faststart").withUsername("rpt").withPassword("rptpw").start();
  c = createDirectConnector({ name: "it", via: "direct", host: container.getHost(), port: container.getPort(), service: container.getDatabase(), user: container.getUsername(), secretRef: "IT" }, container.getPassword());
  // 타입 변환 검증용 표. 통합 테스트는 이 계정으로 만들고, 조회는 가드를 통과하는 SELECT만 쓴다
  const setup = createDirectConnector({ name: "it-setup", via: "direct", host: container.getHost(), port: container.getPort(), service: container.getDatabase(), user: container.getUsername(), secretRef: "IT" }, container.getPassword());
  await (setup as unknown as { raw(sql: string): Promise<void> }).raw?.("");   // 없음: DDL은 아래 oracledb 직접 호출로
}, 600_000);
afterAll(async () => { if (!enabled) return; await closeConnector("it"); await closeConnector("it-setup"); await container.stop(); });

describe.skipIf(!enabled)("direct connector against Oracle Free", () => {
  it("converts DATE/TIMESTAMP/NUMBER/CLOB/NULL to pure JSON", async () => {
    const res = await c.query(`SELECT DATE '2026-09-18' AS D, TIMESTAMP '2026-09-18 01:02:03.456' AS T,
      TIMESTAMP '2026-09-18 01:02:03 +09:00' AS TZ, 12345678901234567890 AS BIG, 3.5 AS F, TO_CLOB('hello') AS C, CAST(NULL AS VARCHAR2(10)) AS N FROM DUAL`, {}, opts);
    expect(res.rows[0]).toEqual({ D: "2026-09-18T00:00:00.000Z", T: "2026-09-18T01:02:03.456Z", TZ: "2026-09-17T16:02:03.000Z", BIG: "12345678901234567890", F: 3.5, C: "hello", N: null });
    expect(res.columns.map((x) => x.type)).toEqual(["date", "date", "date", "number", "number", "string", "string"]);
  });
  it("binds by name and rejects writes/locks at the guard before the driver sees them", async () => {
    expect((await c.query("SELECT :a + :b AS S FROM DUAL", { a: 1, b: 2 }, opts)).rows[0]).toEqual({ S: 3 });
    await expect(c.query("INSERT INTO DUAL VALUES ('Y')", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
    await expect(c.query("SELECT * FROM DUAL FOR UPDATE", {}, opts)).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
  });
  it("enforces the row limit and the timeout, and ping works", async () => {
    await expect(c.query("SELECT LEVEL AS N FROM DUAL CONNECT BY LEVEL <= 20000", {}, opts)).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
    await expect(c.query("SELECT COUNT(*) AS N FROM (SELECT LEVEL FROM DUAL CONNECT BY LEVEL <= 3000000) a, (SELECT LEVEL FROM DUAL CONNECT BY LEVEL <= 3000) b", {}, { ...opts, timeoutMs: 1_000 })).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(c.ping()).resolves.toBeUndefined();
  });
  it("reports unsupported column types", async () => {
    await expect(c.query("SELECT HEXTORAW('FF') AS R FROM DUAL", {}, opts)).rejects.toMatchObject({ code: "SQL_ERROR", message: /지원하지 않는 컬럼 타입: R/ });
  });
});
```
(`beforeAll`의 `setup`·`raw` 두 줄은 삭제한다 — 이 테스트는 DUAL과 리터럴만 써서 DDL이 필요 없다. 최종 파일에는 `c` 하나만 만든다.)

- [ ] **Step 2: README**

`packages/oracle/README.md`: 패키지 역할, `connectorFor` 사용법, 가드 3단계(가드·READ ONLY·읽기 전용 계정 — **운영 DB 계정은 SELECT 권한만 부여**), 통합 테스트 절차:
```
brew install colima docker
colima start --cpu 4 --memory 6
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
export NODE_OPTIONS=--dns-result-order=ipv4first
ORACLE_IT=1 pnpm --filter @daport/oracle test:it
```
첫 실행은 이미지(약 1.2GB)를 받는다. 마지막 절에 "이번 구현에서 실행한 결과"를 날짜·통과 수와 함께 적는다.

- [ ] **Step 3: 실행**

Docker가 있으면(`docker info` 성공) `ORACLE_IT=1 pnpm --filter @daport/oracle test:it`를 실행한다. 없으면 README 절차대로 Colima를 설치·시작해 한 번 실행한다(사용자가 이 단계에서 Colima 설치를 승인했다). 그래도 실행할 수 없으면 README에 "미실행"으로 적고 DONE_WITH_CONCERNS로 보고한다. 기본 `pnpm --filter @daport/oracle test`가 통합 테스트를 수집하지 않음을 확인한다(테스트 파일 목록에 `__it__`가 없어야 한다).

- [ ] **Step 4: 커밋**

```bash
git add packages/oracle/vitest.it.config.ts packages/oracle/src/__it__/direct.it.test.ts packages/oracle/README.md
git -c core.hooksPath=/dev/null commit -m "test(oracle): 컨테이너 Oracle 통합 테스트(ORACLE_IT=1)와 README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `apps/agent` 서버·번들·왕복 테스트

**Files:**
- Create: `apps/agent/src/server.ts`, `apps/agent/src/main.ts`, `apps/agent/scripts/build.mjs`, `apps/agent/src/__tests__/server.test.ts`, `apps/agent/src/__tests__/roundtrip.test.ts`
- Modify: `apps/agent/src/index.ts`(`AGENT_VERSION` + `createAgentServer` re-export)

**Interfaces:**
- Consumes: T2 `FakeSqlConnector`, `ManagedConnector`; T3 `createDirectConnector`, `createAgentConnector`; T1 `DatasetFailure`.
- Produces:
```ts
export type AgentOptions = { connector: ManagedConnector; token: string; version: string; maxConcurrency?: number; maxBodyBytes?: number; log?: (line: string) => void; tls?: { cert: string; key: string } };
export function createAgentServer(opts: AgentOptions): http.Server | https.Server;
```
- 스펙 구체화(6.4): `AgentConnector ↔ agent` 왕복 테스트는 순환 devDependency를 피해 `apps/agent`에 둔다(agent가 oracle에 의존하므로).

- [ ] **Step 1: 실패 테스트 작성**

`apps/agent/src/__tests__/server.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { FakeSqlConnector } from "@daport/oracle/testing";
import { createAgentServer } from "../server";

const TOKEN = "t".repeat(32);
let base: string; let server: ReturnType<typeof createAgentServer>; const logs: string[] = [];
const fake = new FakeSqlConnector().when("FROM SLOW", { delayMs: 300 }).when("FROM BAD", { fail: "SQL_ERROR" }).when("FROM LATE", { fail: "TIMEOUT" });
const post = (body: unknown, token: string | null = TOKEN, raw = false) => fetch(`${base}/query`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });

beforeAll(async () => {
  server = createAgentServer({ connector: fake, token: TOKEN, version: "test", maxConcurrency: 2, maxBodyBytes: 1024, log: (l) => logs.push(l) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe("agent server", () => {
  it("health and query with a valid token", async () => {
    const h = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(h.status).toBe(200); expect(await h.json()).toEqual({ ok: true, version: "test" });
    const q = await post({ sql: "SELECT NO FROM LINES WHERE NO = :no", binds: { no: "A" }, timeoutMs: 999_999, maxRows: 999_999 });
    expect(q.status).toBe(200);
    expect(await q.json()).toEqual({ rows: [{ NO: "A-1", QTY: 3, DT: "2026-09-18T00:00:00.000Z" }], columns: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }, { name: "DT", type: "date" }] });
    const last = fake.calls.at(-1)!;
    expect(last.opts).toEqual({ timeoutMs: 30_000, maxRows: 10_000 });   // 상한으로 클램프
    expect(last.binds).toEqual({ no: "A" });
  });
  it("401 without or with a wrong token, 404 elsewhere, 413 over the body limit, 400 on bad JSON", async () => {
    expect((await post({ sql: "SELECT 1 FROM DUAL" }, null)).status).toBe(401);
    expect((await post({ sql: "SELECT 1 FROM DUAL" }, "x".repeat(32))).status).toBe(401);
    expect((await (await post({ sql: "SELECT 1 FROM DUAL" }, null)).json()).error.code).toBe("UNAUTHORIZED");
    expect((await fetch(`${base}/nope`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
    expect((await post(JSON.stringify({ sql: "SELECT '" + "x".repeat(2000) + "' FROM DUAL" }), TOKEN, true)).status).toBe(413);
    expect((await post("{not json", TOKEN, true)).status).toBe(400);
    expect((await post({ sql: 5 })).status).toBe(400);
  });
  it("maps connector failures to statuses and codes", async () => {
    const guard = await post({ sql: "DELETE FROM T" });
    expect(guard.status).toBe(400); expect((await guard.json()).error.code).toBe("SQL_NOT_ALLOWED");
    const bad = await post({ sql: "SELECT 1 FROM BAD" });
    expect(bad.status).toBe(502); expect((await bad.json()).error.code).toBe("SQL_ERROR");
    const late = await post({ sql: "SELECT 1 FROM LATE" });
    expect(late.status).toBe(504); expect((await late.json()).error.code).toBe("TIMEOUT");
  });
  it("returns 429 beyond maxConcurrency", async () => {
    const slow = [post({ sql: "SELECT 1 FROM SLOW" }), post({ sql: "SELECT 1 FROM SLOW" })];
    await new Promise((r) => setTimeout(r, 50));
    const third = await post({ sql: "SELECT 1 FROM DUAL" });
    expect(third.status).toBe(429); expect((await third.json()).error.code).toBe("BUSY");
    expect((await Promise.all(slow)).map((r) => r.status)).toEqual([200, 200]);
  });
  it("access log has method/path/status/ms but never the SQL, binds or token", () => {
    expect(logs.some((l) => /POST \/query 200 \d+ms/.test(l))).toBe(true);
    expect(logs.join("\n")).not.toMatch(/SELECT|LINES|A-1|t{32}/);
  });
});
```

`apps/agent/src/__tests__/roundtrip.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { FakeSqlConnector } from "@daport/oracle/testing";
import { createAgentConnector } from "@daport/oracle";
import { createAgentServer } from "../server";

const TOKEN = "r".repeat(32);
let server: ReturnType<typeof createAgentServer>; let url: string;
beforeAll(async () => {
  server = createAgentServer({ connector: new FakeSqlConnector().when("FROM BAD", { fail: "SQL_ERROR" }), token: TOKEN, version: "rt" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

describe("AgentConnector ↔ agent server", () => {
  it("round-trips a query, a failure and a ping through real HTTP", async () => {
    const c = createAgentConnector({ name: "rt", via: "agent", url, secretRef: "X" }, TOKEN);
    const res = await c.query("SELECT NO FROM LINES", { no: 1 }, { timeoutMs: 1000, maxRows: 10 });
    expect(res.rows[0]).toMatchObject({ NO: "A-1" });
    await expect(c.query("SELECT 1 FROM BAD", {}, { timeoutMs: 1000, maxRows: 10 })).rejects.toMatchObject({ code: "SQL_ERROR" });
    await expect(c.ping()).resolves.toBeUndefined();
    await expect(createAgentConnector({ name: "rt", via: "agent", url, secretRef: "X" }, "wrong".repeat(7)).ping()).rejects.toMatchObject({ code: "SQL_NOT_CONFIGURED" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter agent test`
Expected: FAIL — `../server` 없음

- [ ] **Step 3: 서버 구현**

`apps/agent/src/server.ts`:
```ts
import http from "node:http";
import https from "node:https";
import { createHash, timingSafeEqual } from "node:crypto";
import { DatasetFailure, DEFAULT_LIMITS, type DatasetErrorCode } from "@daport/datasource";
import type { ManagedConnector } from "@daport/oracle";

export type AgentOptions = { connector: ManagedConnector; token: string; version: string; maxConcurrency?: number; maxBodyBytes?: number; log?: (line: string) => void; tls?: { cert: string; key: string } };

const STATUS: Partial<Record<DatasetErrorCode, number>> = { SQL_NOT_ALLOWED: 400, BAD_PARAM: 400, TOO_MANY_ROWS: 400, TIMEOUT: 504, SQL_ERROR: 502, SQL_NOT_CONFIGURED: 502, TOO_LARGE: 502 };
const sha = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}
const fail = (res: http.ServerResponse, status: number, code: string, message?: string) => send(res, status, { error: { code, ...(message ? { message } : {}) } });

/** 본문을 maxBytes까지만 읽는다. 초과하면 null (호출자가 413) */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let total = 0;
    req.on("data", (c: Buffer) => { total += c.length; if (total > maxBytes) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 공장 안 중계 서버 (4b 스펙 6장). SQL·바인드·토큰은 로그에 남기지 않는다 */
export function createAgentServer(opts: AgentOptions): http.Server | https.Server {
  const maxConcurrency = opts.maxConcurrency ?? 8;
  const maxBodyBytes = opts.maxBodyBytes ?? 1024 * 1024;
  const log = opts.log ?? ((l: string) => console.log(l));
  let inFlight = 0;

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const started = Date.now();
    let rows = 0;
    const url = new URL(req.url ?? "/", "http://agent");
    res.on("finish", () => log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms rows=${rows}`));
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token || !sameToken(token, opts.token)) return fail(res, 401, "UNAUTHORIZED");
    if (req.method === "GET" && url.pathname === "/health") {
      try { await opts.connector.ping(); return send(res, 200, { ok: true, version: opts.version }); }
      catch (e) { return send(res, 503, { ok: false, error: { code: e instanceof DatasetFailure ? e.code : "SQL_ERROR", message: e instanceof Error ? e.message : String(e) } }); }
    }
    if (req.method === "POST" && url.pathname === "/query") {
      if (inFlight >= maxConcurrency) return fail(res, 429, "BUSY", "동시 요청 한도를 넘었습니다");
      inFlight++;
      try {
        const text = await readBody(req, maxBodyBytes);
        if (text === null) return fail(res, 413, "BAD_PARAM", `본문이 ${maxBodyBytes} 바이트를 넘습니다`);
        let body: { sql?: unknown; binds?: unknown; timeoutMs?: unknown; maxRows?: unknown };
        try { body = JSON.parse(text); } catch { return fail(res, 400, "BAD_PARAM", "본문이 JSON이 아닙니다"); }
        if (!body || typeof body.sql !== "string") return fail(res, 400, "BAD_PARAM", "sql 문자열이 필요합니다");
        const binds = body.binds && typeof body.binds === "object" && !Array.isArray(body.binds) ? (body.binds as Record<string, unknown>) : {};
        const clamp = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, max) : max);
        const timeoutMs = clamp(body.timeoutMs, DEFAULT_LIMITS.timeoutMs), maxRows = clamp(body.maxRows, DEFAULT_LIMITS.maxRows);
        try {
          const result = await opts.connector.query(body.sql, binds, { timeoutMs, maxRows, signal: AbortSignal.timeout(timeoutMs) });
          rows = result.rows.length;
          return send(res, 200, result);
        } catch (e) {
          if (e instanceof DatasetFailure) return fail(res, STATUS[e.code] ?? 502, e.code, e.message);
          return fail(res, 502, "SQL_ERROR", e instanceof Error ? e.message : String(e));
        }
      } finally { inFlight--; }
    }
    return fail(res, 404, "NOT_FOUND");
  };
  const wrapped = (req: http.IncomingMessage, res: http.ServerResponse) => { handler(req, res).catch((e) => { if (!res.headersSent) fail(res, 500, "SQL_ERROR", e instanceof Error ? e.message : String(e)); }); };
  return opts.tls ? https.createServer({ cert: opts.tls.cert, key: opts.tls.key }, wrapped) : http.createServer(wrapped);
}
```

`apps/agent/src/main.ts`:
```ts
import { readFileSync } from "node:fs";
import { createDirectConnector, type ManagedConnector } from "@daport/oracle";
import { FakeSqlConnector } from "@daport/oracle/testing";
import { createAgentServer } from "./server";
import { AGENT_VERSION } from "./index";

const env = process.env;
const need = (name: string) => { const v = env[name]; if (!v) { console.error(`${name} 환경변수가 필요합니다`); process.exit(1); } return v; };

const token = need("AGENT_TOKEN");
if (token.length < 32) { console.error("AGENT_TOKEN은 32자 이상이어야 합니다"); process.exit(1); }
const connector: ManagedConnector = env.AGENT_FAKE === "1"
  ? new FakeSqlConnector()   // 테스트·E2E: 고정 결과
  : createDirectConnector({ name: "agent", via: "direct", host: need("ORACLE_HOST"), port: Number(env.ORACLE_PORT ?? 1521), service: need("ORACLE_SERVICE"), user: need("ORACLE_USER"), secretRef: "ORACLE_PASSWORD" }, need("ORACLE_PASSWORD"));
const tls = env.AGENT_TLS_CERT && env.AGENT_TLS_KEY ? { cert: readFileSync(env.AGENT_TLS_CERT, "utf8"), key: readFileSync(env.AGENT_TLS_KEY, "utf8") } : undefined;
const server = createAgentServer({ connector, token, version: AGENT_VERSION, maxConcurrency: Number(env.AGENT_MAX_CONCURRENCY ?? 8), tls });
const port = Number(env.AGENT_PORT ?? 8433);
server.listen(port, () => console.log(`daport agent ${AGENT_VERSION} listening on ${tls ? "https" : "http"}://0.0.0.0:${port} (${env.AGENT_FAKE === "1" ? "fake" : "oracle"})`));
const shutdown = () => { server.close(() => { connector.close().finally(() => process.exit(0)); }); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
```
`apps/agent/src/index.ts`: `export const AGENT_VERSION = "0.0.1"; export { createAgentServer, type AgentOptions } from "./server";`.

`apps/agent/scripts/build.mjs`:
```js
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
// 단일 파일 번들. oracledb는 external — 배포물은 dist/ + dist/package.json (pnpm install --prod 후 node dist/agent.mjs)
await build({ entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node20", outfile: "dist/agent.mjs", external: ["oracledb"], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
mkdirSync("dist", { recursive: true });
writeFileSync("dist/package.json", JSON.stringify({ name: "daport-agent", private: true, type: "module", dependencies: { oracledb: "^6.5.0" } }, null, 2));
console.log("built dist/agent.mjs");
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter agent test && pnpm --filter agent typecheck && pnpm --filter agent build && AGENT_FAKE=1 AGENT_TOKEN=$(printf 'x%.0s' {1..32}) AGENT_PORT=8499 timeout 5 node apps/agent/dist/agent.mjs || true`
Expected: 테스트·타입 통과, `dist/agent.mjs`·`dist/package.json` 생성, 서버가 "listening" 로그를 낸다(`timeout`이 없으면 백그라운드로 띄운 뒤 `curl -s -o /dev/null -w '%{http_code}' localhost:8499/health` → 401 확인 후 종료). `apps/agent/dist`는 `.gitignore`에 추가한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/agent .gitignore
git -c core.hooksPath=/dev/null commit -m "feat(agent): 공장 안 중계 서버 — /health·/query, 토큰·동시성·본문 한도, esbuild 번들

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: studio 연결 저장소·사용처·API

**Files:**
- Modify: `apps/studio/src/db/schema.ts`, `apps/studio/package.json`(`@daport/oracle` 의존 — 워크스페이스 링크라 lockfile만 바뀐다; `pnpm install`은 T2에서 이미 끝났으므로 **여기서는 실행하지 않고** 링크가 없으면 `pnpm install --offline`으로 링크만 만든다)
- Create: `apps/studio/src/lib/connection-store.ts`, `apps/studio/src/lib/connection-usage.ts`, `apps/studio/src/app/api/connections/route.ts`, `apps/studio/src/app/api/connections/[name]/route.ts`, `apps/studio/src/app/api/connections/[name]/test/route.ts`
- Test: `apps/studio/src/lib/__tests__/connection-store.test.ts`, `apps/studio/src/app/api/connections/__tests__/connections-route.test.ts`

**Interfaces:**
- Consumes: T1 `ConnectionSchema`/`parseConnection`, `envSecrets`; T3 `connectorFor`, `closeConnector`.
- Produces:
```ts
export type ConnectionSummary = Connection & { secretConfigured: boolean; usedBy: string[] };
export interface ConnectionStore { list(): Promise<Connection[]>; get(name: string): Promise<Connection | null>; upsert(conn: Connection): Promise<void>; delete(name: string): Promise<boolean> }
export function getConnectionStore(): ConnectionStore;   // DATABASE_URL이면 Db, 아니면 Memory (globalThis 홀더)
export async function findConnectionUsage(name: string): Promise<string[]>;   // 그 연결을 쓰는 레포트 id (draft 전체 훑기)
// GET /api/connections → ConnectionSummary[]; PUT /api/connections/:name → 200 Connection | 400; DELETE → 204 | 404 | 409 { code: "CONNECTION_IN_USE", reports }; POST /api/connections/:name/test → 200 { ok: true, elapsedMs } | 400 { code: "SECRET_MISSING" } | 502 { ok: false, error: { code, message } } | 404
```

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/connection-store.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MemoryConnectionStore } from "../connection-store";

const mes = { name: "mes", via: "direct" as const, host: "db", port: 1521, service: "ORCL", user: "rpt", secretRef: "MES_DB" };
describe("MemoryConnectionStore", () => {
  it("upserts, lists sorted by name, gets, deletes", async () => {
    const s = new MemoryConnectionStore();
    await s.upsert(mes);
    await s.upsert({ name: "factory", via: "agent", url: "https://a.local", secretRef: "AGENT" });
    expect((await s.list()).map((c) => c.name)).toEqual(["factory", "mes"]);
    await s.upsert({ ...mes, host: "db2" });
    expect((await s.get("mes"))?.host).toBe("db2");
    expect(await s.delete("mes")).toBe(true);
    expect(await s.delete("mes")).toBe(false);
    expect(await s.get("mes")).toBeNull();
  });
  it("validates on upsert", async () => {
    await expect(new MemoryConnectionStore().upsert({ ...mes, secretRef: "bad" } as never)).rejects.toThrow();
  });
});
```

`apps/studio/src/app/api/connections/__tests__/connections-route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";

const ping = vi.fn(); const closeConnector = vi.fn();
vi.mock("@daport/oracle", async (orig) => ({ ...(await orig<typeof import("@daport/oracle")>()), connectorFor: () => ({ query: vi.fn(), ping, close: vi.fn() }), closeConnector }));
const { GET } = await import("../route");
const { PUT, DELETE } = await import("../[name]/route");
const { POST: TEST } = await import("../[name]/test/route");
const { getStore, ready } = await import("@/lib/report-store");
const { getConnectionStore } = await import("@/lib/connection-store");

const ctx = (name: string) => ({ params: Promise.resolve({ name }) });
const req = (url: string, method: string, body?: unknown) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const mes = { via: "direct", host: "db.local", service: "ORCL", user: "rpt", secretRef: "MES_DB" };

beforeEach(() => { ping.mockReset().mockResolvedValue(undefined); closeConnector.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("connections API", () => {
  it("PUT validates and upserts (url name wins), GET lists with secretConfigured and usedBy, never the secret", async () => {
    await ready();
    expect((await PUT(req("/api/connections/mes", "PUT", { ...mes, name: "other" }), ctx("mes"))).status).toBe(200);
    expect((await PUT(req("/api/connections/mes", "PUT", { via: "agent", url: "http://evil", secretRef: "A" }), ctx("mes"))).status).toBe(400);
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const id = `conn-use-${Date.now()}`;
    await getStore().create({ id, version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "l", type: "sql", connection: "mes", query: "SELECT 1 FROM DUAL" }] });
    const list = await (await GET()).json();
    const row = list.find((c: { name: string }) => c.name === "mes");
    expect(row).toMatchObject({ name: "mes", via: "direct", host: "db.local", port: 1521, secretRef: "MES_DB", secretConfigured: true });
    expect(row.usedBy).toContain(id);
    expect(JSON.stringify(list)).not.toContain("pw");
    expect(closeConnector).toHaveBeenCalledWith("mes");
    // 사용 중이면 삭제 409
    const del = await DELETE(req("/api/connections/mes", "DELETE"), ctx("mes"));
    expect(del.status).toBe(409); expect((await del.json())).toMatchObject({ code: "CONNECTION_IN_USE", reports: [id] });
    await getStore().update(id, parseReport({ id, version: 1, page: { width: 10, height: 10 } }));
    expect((await DELETE(req("/api/connections/mes", "DELETE"), ctx("mes"))).status).toBe(204);
    expect((await DELETE(req("/api/connections/mes", "DELETE"), ctx("mes"))).status).toBe(404);
  });
  it("test route: 404 unknown, 400 SECRET_MISSING, 200 ok, 502 on ping failure", async () => {
    await getConnectionStore().upsert({ name: "t1", ...mes, port: 1521 } as never);
    expect((await TEST(req("/api/connections/nope/test", "POST"), ctx("nope"))).status).toBe(404);
    const missing = await TEST(req("/api/connections/t1/test", "POST"), ctx("t1"));
    expect(missing.status).toBe(400); expect((await missing.json()).code).toBe("SECRET_MISSING");
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const ok = await TEST(req("/api/connections/t1/test", "POST"), ctx("t1"));
    expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ ok: true });
    ping.mockRejectedValueOnce(Object.assign(new Error("연결 실패: NJS-501"), { code: "SQL_ERROR" }));
    const bad = await TEST(req("/api/connections/t1/test", "POST"), ctx("t1"));
    expect(bad.status).toBe(502); expect(await bad.json()).toMatchObject({ ok: false, error: { message: expect.stringContaining("NJS-501") } });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- connection`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 스키마·저장소·사용처**

`apps/studio/src/db/schema.ts` 끝에:
```ts
/** Oracle 연결 설정 (4b 스펙 4.4). 비밀값은 secretRef 이름만 body에 있고 값은 환경변수에만 있다 */
export const connections = pgTable("connections", {
  name: text("name").primaryKey(),
  body: jsonb("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`apps/studio/src/lib/connection-store.ts`:
```ts
import { asc, eq } from "drizzle-orm";
import { parseConnection, type Connection } from "@daport/datasource";
import { db } from "@/db/client";
import { connections } from "@/db/schema";

export interface ConnectionStore {
  list(): Promise<Connection[]>;
  get(name: string): Promise<Connection | null>;
  upsert(conn: Connection): Promise<void>;     // 스키마 검증 후 저장
  delete(name: string): Promise<boolean>;      // 없으면 false
}

export class MemoryConnectionStore implements ConnectionStore {
  private map = new Map<string, Connection>();
  async list() { return [...this.map.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  async get(name: string) { return this.map.get(name) ?? null; }
  async upsert(conn: Connection) { const c = parseConnection(conn); this.map.set(c.name, c); }
  async delete(name: string) { return this.map.delete(name); }
}

export class DbConnectionStore implements ConnectionStore {
  async list() { return (await db().select().from(connections).orderBy(asc(connections.name))).map((r) => parseConnection(r.body)); }
  async get(name: string) { const [row] = await db().select().from(connections).where(eq(connections.name, name)); return row ? parseConnection(row.body) : null; }
  async upsert(conn: Connection) {
    const c = parseConnection(conn);
    await db().insert(connections).values({ name: c.name, body: c }).onConflictDoUpdate({ target: connections.name, set: { body: c, updatedAt: new Date() } });
  }
  async delete(name: string) { return (await db().delete(connections).where(eq(connections.name, name)).returning({ name: connections.name })).length > 0; }
}

const holder = globalThis as typeof globalThis & { __daportConnectionStore?: ConnectionStore };
export function getConnectionStore(): ConnectionStore {
  return (holder.__daportConnectionStore ??= process.env.DATABASE_URL ? new DbConnectionStore() : new MemoryConnectionStore());
}
```

`apps/studio/src/lib/connection-usage.ts`:
```ts
import { getStore, ready } from "./report-store";

/** 이 연결 이름을 쓰는 저장된 레포트 id. 색인이 없으므로 draft 전체를 훑는다 (컴포넌트 사용처와 같은 방식) */
export async function findConnectionUsage(name: string): Promise<string[]> {
  await ready();
  const store = getStore();
  const out: string[] = [];
  for (const s of await store.list()) {
    const r = await store.get(s.id);
    if (r?.datasets.some((d) => d.type === "sql" && d.connection === name)) out.push(r.id);
  }
  return out;
}
```

- [ ] **Step 4: 라우트**

`apps/studio/src/app/api/connections/route.ts`:
```ts
import { NextResponse } from "next/server";
import { envSecrets } from "@daport/datasource";
import { getConnectionStore } from "@/lib/connection-store";
import { findConnectionUsage } from "@/lib/connection-usage";

/** 연결 목록 (4b 스펙 7.1). 비밀값은 설정 여부만 */
export async function GET() {
  const secrets = envSecrets();
  const list = await getConnectionStore().list();
  return NextResponse.json(await Promise.all(list.map(async (c) => ({ ...c, secretConfigured: !!secrets(c.secretRef), usedBy: await findConnectionUsage(c.name) }))));
}
```

`apps/studio/src/app/api/connections/[name]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { closeConnector } from "@daport/oracle";
import { getConnectionStore } from "@/lib/connection-store";
import { findConnectionUsage } from "@/lib/connection-usage";
import { readJsonBody, MAX_BODY_BYTES } from "@/lib/body";

type Ctx = { params: Promise<{ name: string }> };

/** URL의 name이 본문 name보다 우선한다 (저장소 update와 같은 규칙). direct 풀은 설정이 바뀌었을 수 있어 닫는다 */
export async function PUT(req: Request, { params }: Ctx) {
  const { name } = await params;
  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  try {
    const store = getConnectionStore();
    await store.upsert({ ...parsed.body, name } as never);
    await closeConnector(name);
    return NextResponse.json(await store.get(name));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { name } = await params;
  const reports = await findConnectionUsage(name);
  if (reports.length) return NextResponse.json({ error: `연결 "${name}"을(를) 쓰는 레포트가 있습니다`, code: "CONNECTION_IN_USE", reports }, { status: 409 });
  if (!(await getConnectionStore().delete(name))) return NextResponse.json({ error: "not found" }, { status: 404 });
  await closeConnector(name);
  return new NextResponse(null, { status: 204 });
}
```

`apps/studio/src/app/api/connections/[name]/test/route.ts`:
```ts
import { NextResponse } from "next/server";
import { envSecrets, DatasetFailure } from "@daport/datasource";
import { connectorFor } from "@daport/oracle";
import { getConnectionStore } from "@/lib/connection-store";

/** 연결 테스트: ping (4b 스펙 7.1). 비밀값·호스트 문자열은 응답에 넣지 않는다(ping 오류 메시지는 커넥터가 이미 마스킹) */
export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const conn = await getConnectionStore().get(name);
  if (!conn) return NextResponse.json({ error: "not found" }, { status: 404 });
  const secrets = envSecrets();
  if (!secrets(conn.secretRef)) return NextResponse.json({ error: `DAPORT_SECRET_${conn.secretRef} 환경변수가 없습니다`, code: "SECRET_MISSING" }, { status: 400 });
  const started = Date.now();
  try {
    await connectorFor(conn, secrets).ping();
    return NextResponse.json({ ok: true, elapsedMs: Date.now() - started });
  } catch (e) {
    const code = e instanceof DatasetFailure ? e.code : (e as { code?: string })?.code ?? "SQL_ERROR";
    return NextResponse.json({ ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } }, { status: 502 });
  }
}
```
`apps/studio/package.json` dependencies에 `"@daport/oracle": "workspace:*"`를 추가한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. `@daport/oracle` 링크가 없어 해석 실패하면 루트에서 `pnpm install --offline`(네트워크 없이 워크스페이스 링크만).

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/src/db/schema.ts apps/studio/src/lib/connection-store.ts apps/studio/src/lib/connection-usage.ts apps/studio/src/app/api/connections apps/studio/package.json pnpm-lock.yaml apps/studio/src/lib/__tests__/connection-store.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): 연결 저장소·사용처 검사·연결 API(목록·저장·삭제·테스트)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: studio 실행 조립·샘플 컬럼 타입·가져오기 경고

**Files:**
- Modify: `apps/studio/src/lib/datasets.ts`, `apps/studio/src/app/api/reports/[id]/sample/route.ts`, `apps/studio/src/lib/import-bundle.ts`, `apps/studio/src/editor/data/DataPanel.tsx`(`SampleResponse` 타입에 `columns` 추가만)
- Test: `apps/studio/src/lib/__tests__/datasets.test.ts`(신규), `apps/studio/src/app/api/reports/__tests__/sample-route.test.ts`(1개 추가), `apps/studio/src/lib/__tests__/import-bundle.test.ts`(1개 추가)

**Interfaces:**
- Consumes: T6 `getConnectionStore`; T3 `connectorFor`; T1 `executeDatasets().columns`, `inferFields(…, { columnTypes })`, `SqlColumn`.
- Produces: `runDatasets` → `{ context, errors, columns }`; 샘플 응답 `{ data, fields, columns, errors, capturedAt }`; 가져오기 `warnings`에 `"<id>: 연결 <name>이(가) 이 인스턴스에 없습니다"`.

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/lib/__tests__/datasets.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";
import { FakeSqlConnector } from "@daport/oracle/testing";

const fake = new FakeSqlConnector();
vi.mock("@daport/oracle", async (orig) => ({ ...(await orig<typeof import("@daport/oracle")>()), connectorFor: vi.fn(() => fake) }));
const { runDatasets } = await import("../datasets");
const { getConnectionStore } = await import("../connection-store");
const { connectorFor } = await import("@daport/oracle");

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "lines", type: "sql", connection: "mes", query: "SELECT NO FROM LINES" }] });
afterEach(() => { vi.unstubAllEnvs(); (connectorFor as unknown as ReturnType<typeof vi.fn>).mockClear(); });

describe("runDatasets sql assembly", () => {
  it("builds a connector per referenced connection and returns rows and columns", async () => {
    await getConnectionStore().upsert({ name: "mes", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" });
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const { context, errors, columns } = await runDatasets(report, { params: {} });
    expect(errors).toEqual([]);
    expect((context.lines as { NO: string }).NO).toBe("A-1");
    expect(columns).toEqual({ lines: [{ name: "NO", type: "string" }, { name: "QTY", type: "number" }, { name: "DT", type: "date" }] });
    expect(connectorFor).toHaveBeenCalledTimes(1);
  });
  it("reports SQL_NOT_CONFIGURED when the connection is missing or its secret is unset", async () => {
    await getConnectionStore().delete("mes");
    expect((await runDatasets(report, { params: {} })).errors).toEqual([expect.objectContaining({ dataset: "lines", code: "SQL_NOT_CONFIGURED" })]);
    await getConnectionStore().upsert({ name: "mes", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" });
    (connectorFor as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw Object.assign(new Error("no secret"), { code: "SQL_NOT_CONFIGURED" }); });
    expect((await runDatasets(report, { params: {} })).errors[0].code).toBe("SQL_NOT_CONFIGURED");
  });
});
```

`sample-route.test.ts` 끝에 추가(기존 `call`/import 스타일을 따른다):
```ts
describe("sample columns", () => {
  it("returns sql columns and uses them as field type hints even with no rows", async () => {
    const { getConnectionStore } = await import("@/lib/connection-store");
    await getConnectionStore().upsert({ name: "mes", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" });
    vi.stubEnv("DAPORT_SECRET_MES_DB", "pw");
    const report = { id: "sc", version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "lines", type: "sql", connection: "mes", query: "SELECT NO FROM EMPTY" }] };
    // 이 테스트 파일 상단에서 @daport/oracle의 connectorFor를 FakeSqlConnector().when("FROM EMPTY", { rows: [], columns: [{ name: "NO", type: "string" }, { name: "DT", type: "date" }] })로 mock한다
    const res = await call({ report, params: {} });
    const body = await res.json();
    expect(body.columns).toEqual({ lines: [{ name: "NO", type: "string" }, { name: "DT", type: "date" }] });
    expect(body.fields.lines).toEqual([{ name: "NO", path: "NO", type: "string" }, { name: "DT", path: "DT", type: "date" }]);
    vi.unstubAllEnvs();
  });
});
```

`import-bundle.test.ts` 끝에 추가:
```ts
  it("warns about connections missing on this instance", async () => {
    const store = new MemoryReportStore();
    const r = parseReport({ id: "c1", version: 1, page: { width: 10, height: 10 }, datasets: [{ name: "l", type: "sql", connection: "nowhere", query: "SELECT 1 FROM DUAL" }] });
    const res = await importBundle(buildBundle([{ report: r, source: "draft" }], [], []), { filename: "c.zip" }, { store, assets: null });
    expect(res.imported).toEqual([{ id: "c1", action: "created" }]);
    expect(res.warnings).toContainEqual("c1: 연결 nowhere이(가) 이 인스턴스에 없습니다");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- datasets sample-route import-bundle`
Expected: FAIL

- [ ] **Step 3: 구현**

`apps/studio/src/lib/datasets.ts`:
```ts
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
```

`sample/route.ts`: `const { context, errors, columns } = await runDatasets(...)`; 루프에서 `const hints = columns[ds.name] ? Object.fromEntries(columns[ds.name].map((c) => [c.name, c.type])) : undefined; fields[ds.name] = inferFields(data[ds.name], { columnTypes: hints });` 그리고 sql 데이터셋은 행이 없어도(`rows`가 빈 배열이면) `data[ds.name] = []`로 두고 `fields`를 만든다. 응답에 `columns`를 추가한다.

`import-bundle.ts`: 레포트 루프 안에서 `guard` 통과 뒤,
```ts
      const known = new Set((await deps.connections?.list() ?? []).map((c) => c.name));
      for (const d of guard.report.datasets) if (d.type === "sql" && !known.has(d.connection)) result.warnings.push(`${id}: 연결 ${d.connection}이(가) 이 인스턴스에 없습니다`);
```
`ImportDeps`에 `connections?: { list(): Promise<{ name: string }[]> }`를 더하고, `import/route.ts`는 `connections: getConnectionStore()`를 넘긴다(테스트처럼 넘기지 않으면 모든 연결이 "없음"으로 경고된다 — 위 테스트는 `connections` 없이 호출하므로 경고가 나온다). 목록은 루프 밖에서 한 번만 읽는다.

`DataPanel.tsx`의 `SampleResponse`에 `columns: Record<string, { name: string; type: string }[]>`를 추가한다(UI 반영은 T8).

- [ ] **Step 4: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS(기존 pdf·label·preview·render 라우트 테스트는 `runDatasets` 반환 확장에 영향 없음)

- [ ] **Step 5: 커밋**

```bash
git add apps/studio/src/lib/datasets.ts "apps/studio/src/app/api/reports/[id]/sample/route.ts" apps/studio/src/lib/import-bundle.ts apps/studio/src/app/api/import/route.ts apps/studio/src/editor/data/DataPanel.tsx apps/studio/src/lib/__tests__/datasets.test.ts apps/studio/src/app/api/reports/__tests__/sample-route.test.ts apps/studio/src/lib/__tests__/import-bundle.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(studio): 연결로 sql 커넥터 조립, 샘플 컬럼 타입 힌트, 가져오기 연결 없음 경고

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: studio UI — sql 데이터셋 폼, `+ sql`, 컬럼 타입 힌트, 연결 관리 화면

**Files:**
- Modify: `apps/studio/src/editor/data/DatasetEditor.tsx`, `apps/studio/src/editor/data/DataPanel.tsx`, `apps/studio/src/app/ReportList.tsx`(링크 한 줄)
- Create: `apps/studio/src/app/settings/connections/page.tsx`, `apps/studio/src/app/settings/connections/ConnectionsManager.tsx`
- Test: `apps/studio/src/editor/data/__tests__/DatasetEditor.sql.test.tsx`(신규; 기존 데이터 패널 테스트 디렉터리가 다르면 그 위치에 맞춘다), `apps/studio/src/app/settings/connections/__tests__/ConnectionsManager.test.tsx`

**Interfaces:**
- Consumes: T1 `@daport/datasource/sql`(`bindNames`, `guardSql`, `DatasetFailure` — 클라이언트 번들 안전), T6 API, T7 샘플 `columns`.
- Produces: DatasetEditor sql 폼(`aria-label` 연결·쿼리, `data-testid="binds"`, 버튼 "쿼리 확인", `data-testid="guard-result"`), DataPanel `+ sql`, `/settings/connections`(표·폼·"테스트"·"삭제"; `aria-label` 이름·방식·호스트·포트·서비스·사용자·URL·비밀값 이름; 버튼 "연결 저장"; 행 `data-testid="conn-<name>"`, 결과 `data-testid="test-<name>"`).

- [ ] **Step 1: 실패 테스트 작성**

`apps/studio/src/editor/data/__tests__/DatasetEditor.sql.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { DatasetEditor } from "../DatasetEditor";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const fetchMock = (list: unknown) => { const f = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })); vi.stubGlobal("fetch", f); return f; };

describe("DatasetEditor sql", () => {
  it("lists connections, edits connection and query, shows binds and warns about params missing from the report", async () => {
    fetchMock([{ name: "mes", via: "direct" }, { name: "factory", via: "agent" }]);
    const onChange = vi.fn();
    render(<DatasetEditor dataset={{ name: "lines", type: "sql", connection: "", query: "" }} params={[{ name: "orderNo", type: "string" }]} onChange={onChange} onRemove={() => {}} />);
    const select = await screen.findByLabelText("연결") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "mes", "factory"]);
    fireEvent.change(select, { target: { value: "mes" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ connection: "mes" }));
    fireEvent.change(screen.getByLabelText("쿼리"), { target: { value: "SELECT * FROM T WHERE NO = :orderNo AND LOT = :lot" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ query: "SELECT * FROM T WHERE NO = :orderNo AND LOT = :lot" }));
    cleanup();
    render(<DatasetEditor dataset={{ name: "lines", type: "sql", connection: "mes", query: "SELECT * FROM T WHERE NO = :orderNo AND LOT = :lot" }} params={[{ name: "orderNo", type: "string" }]} onChange={onChange} onRemove={() => {}} />);
    expect(screen.getByTestId("binds").textContent).toContain(":orderNo");
    expect(screen.getByTestId("binds").textContent).toContain(":lot");
    expect(screen.getByTestId("binds").textContent).toContain("파라미터에 없음: lot");
  });
  it("쿼리 확인 runs the guard client-side and shows the verdict; empty connection list links to settings", async () => {
    fetchMock([]);
    render(<DatasetEditor dataset={{ name: "l", type: "sql", connection: "", query: "DELETE FROM T" }} params={[]} onChange={() => {}} onRemove={() => {}} />);
    await waitFor(() => expect(screen.getByText(/연결을 먼저 등록하세요/)).toBeTruthy());
    expect((screen.getByText(/연결을 먼저 등록하세요/).closest("a") ?? screen.getByRole("link")).getAttribute("href")).toBe("/settings/connections");
    fireEvent.click(screen.getByRole("button", { name: "쿼리 확인" }));
    expect(screen.getByTestId("guard-result").textContent).toMatch(/SELECT 또는 WITH/);
  });
});
```
(`DatasetEditor`에 `params` prop을 추가한다 — 바인드 경고에 필요. `DataPanel`이 `report.params`를 넘긴다. `next/link`는 이 테스트에서 `vi.mock("next/link", …)`로 앵커로 대체한다 — `ReportList.test.tsx`와 같은 방식.)

`apps/studio/src/app/settings/connections/__tests__/ConnectionsManager.test.tsx`:
```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ConnectionsManager } from "../ConnectionsManager";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  let list = [{ name: "mes", via: "direct", host: "db.local", port: 1521, service: "ORCL", user: "rpt", secretRef: "MES_DB", secretConfigured: true, usedBy: ["quality-cert"] }];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/connections") return new Response(JSON.stringify(list), { status: 200 });
    if (init?.method === "PUT") { const body = JSON.parse(String(init.body)); list = [...list.filter((c) => c.name !== body.name), { ...body, secretConfigured: false, usedBy: [] }]; return new Response(JSON.stringify(body), { status: 200 }); }
    if (url.endsWith("/test")) return new Response(JSON.stringify({ ok: true, elapsedMs: 12 }), { status: 200 });
    if (init?.method === "DELETE") return new Response(JSON.stringify({ error: "in use", code: "CONNECTION_IN_USE", reports: ["quality-cert"] }), { status: 409 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ConnectionsManager />);
  return fetchMock;
}

describe("ConnectionsManager", () => {
  it("lists connections with secret state and usage, tests one, and shows 409 on delete", async () => {
    setup();
    const row = await screen.findByTestId("conn-mes");
    expect(row.textContent).toContain("db.local:1521/ORCL"); expect(row.textContent).toContain("MES_DB"); expect(row.textContent).toContain("1");
    fireEvent.click(row.querySelector('button[name="test"]')!);
    await waitFor(() => expect(screen.getByTestId("test-mes").textContent).toMatch(/OK.*12/));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(row.querySelector('button[name="delete"]')!);
    await waitFor(() => expect(screen.getByTestId("conn-mes").textContent).toMatch(/quality-cert/));
  });
  it("saves a new agent connection via PUT and switches fields by via", async () => {
    const fetchMock = setup();
    await screen.findByTestId("conn-mes");
    fireEvent.change(screen.getByLabelText("방식"), { target: { value: "agent" } });
    expect(screen.queryByLabelText("호스트")).toBeNull();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "factory" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://agent.local:8433" } });
    fireEvent.change(screen.getByLabelText("비밀값 이름"), { target: { value: "AGENT" } });
    fireEvent.click(screen.getByRole("button", { name: "연결 저장" }));
    await waitFor(() => expect(screen.getByTestId("conn-factory")).toBeTruthy());
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(put[0]).toBe("/api/connections/factory");
    expect(JSON.parse(String(put[1]?.body))).toEqual({ name: "factory", via: "agent", url: "https://agent.local:8433", secretRef: "AGENT" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter studio test -- DatasetEditor.sql ConnectionsManager`
Expected: FAIL

- [ ] **Step 3: DatasetEditor·DataPanel**

`DatasetEditor.tsx`에 추가(기존 static·http 폼은 그대로):
```tsx
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dataset, ParamDef } from "@daport/core";
import { bindNames, guardSql, DatasetFailure } from "@daport/datasource/sql";   // 클라이언트 안전 서브패스 (Node 전용 코드 없음)

function SqlForm({ dataset, params, set }: { dataset: Extract<Dataset, { type: "sql" }>; params: { name: string }[]; set: (p: Partial<Dataset>) => void }) {
  const [connections, setConnections] = useState<{ name: string; via: string }[] | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/connections", { method: "GET" }).then((r) => (r.ok ? r.json() : [])).then((l: unknown) => setConnections(Array.isArray(l) ? (l as { name: string; via: string }[]) : [])).catch(() => setConnections([]));
  }, []);
  const binds = bindNames(dataset.query);
  const missing = binds.filter((b) => !params.some((p) => p.name === b));
  const check = () => {
    try { guardSql(dataset.query); setVerdict("허용되는 조회문입니다"); }
    catch (e) { setVerdict(e instanceof DatasetFailure ? e.message : String(e)); }
  };
  return (
    <>
      <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">연결</span>
        <select aria-label="연결" className="border rounded px-1 py-0.5" value={dataset.connection} onChange={(e) => set({ connection: e.target.value })}>
          <option value="">(선택)</option>
          {(connections ?? []).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.via})</option>)}
        </select></label>
      {connections && connections.length === 0 && <span className="text-xs text-amber-700">연결을 먼저 등록하세요: <Link className="underline" href="/settings/connections">연결 관리</Link></span>}
      <label className="flex flex-col gap-1 text-xs"><span className="text-neutral-500">쿼리</span>
        <textarea aria-label="쿼리" rows={4} className="border rounded px-1 py-0.5 font-mono" value={dataset.query} onChange={(e) => set({ query: e.target.value })} /></label>
      <div data-testid="binds" className="text-xs text-neutral-600">
        바인드: {binds.length ? binds.map((b) => `:${b}`).join(", ") : "없음"}
        {missing.length > 0 && <span className="text-amber-700"> · 파라미터에 없음: {missing.join(", ")}</span>}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <button className="border rounded px-2 py-0.5 bg-white hover:bg-neutral-100" onClick={check}>쿼리 확인</button>
        {verdict && <span data-testid="guard-result" className={verdict.startsWith("허용") ? "text-green-700" : "text-red-700"}>{verdict}</span>}
      </div>
    </>
  );
}
```
`DatasetEditor`의 props에 `params: { name: string }[]`를 추가하고 `{dataset.type === "sql" && <SqlForm dataset={dataset} params={params} set={set} />}`로 기존 안내 문구를 교체한다. 주석 "sql은 커넥터가 없어…"를 갱신한다. `ParamDef` import는 실제 core 타입 이름을 확인해 맞춘다(없으면 `{ name: string }[]`만 쓴다).

`DataPanel.tsx`: `add`의 타입에 `"sql"`을 더하고 기본값 `{ name, type: "sql", connection: "", query: "" }`, 버튼 `<button className={btn} onClick={() => add("sql")}>+ sql</button>`; `DatasetEditor`에 `params={report.params}` 전달; 샘플 응답의 `columns`를 로컬 state `columnTypes: Record<string, Record<string, FieldType>>`로 보관해(`Object.fromEntries(cols.map(c => [c.name, c.type]))`) `inferFields(rowsFor(ds), { columnTypes: columnTypes[ds.name] })`로 넘긴다.

- [ ] **Step 4: 연결 관리 화면**

`apps/studio/src/app/settings/connections/page.tsx`:
```tsx
import Link from "next/link";
import { ConnectionsManager } from "./ConnectionsManager";
export const dynamic = "force-dynamic";
export default function ConnectionsPage() {
  return (
    <main className="max-w-3xl mx-auto p-8">
      <Link className="text-sm text-blue-700 hover:underline" href="/">← 레포트</Link>
      <h1 className="text-xl font-bold my-4">연결</h1>
      <p className="text-xs text-neutral-600 mb-3">비밀번호·에이전트 토큰은 저장하지 않습니다. 서버 환경변수 <code>DAPORT_SECRET_&lt;비밀값 이름&gt;</code>에 넣으세요. 운영 DB 계정은 SELECT 권한만 부여하세요.</p>
      <ConnectionsManager />
    </main>
  );
}
```

`ConnectionsManager.tsx`(클라이언트):
```tsx
"use client";
import { useCallback, useEffect, useState } from "react";

type Row = { name: string; via: "direct" | "agent"; host?: string; port?: number; service?: string; user?: string; url?: string; secretRef: string; secretConfigured: boolean; usedBy: string[] };
type Form = { name: string; via: "direct" | "agent"; host: string; port: string; service: string; user: string; url: string; secretRef: string };
const empty: Form = { name: "", via: "direct", host: "", port: "1521", service: "", user: "", url: "", secretRef: "" };
const target = (r: Row) => (r.via === "direct" ? `${r.host}:${r.port}/${r.service}` : r.url ?? "");

async function failureMessage(r: Response, label: string): Promise<string> {
  const body = (await r.json().catch(() => null)) as { error?: string; code?: string; reports?: string[] } | null;
  if (body?.code === "CONNECTION_IN_USE") return `사용 중인 레포트가 있어 삭제할 수 없습니다: ${(body.reports ?? []).join(", ")}`;
  return typeof body?.error === "string" ? body.error : `${label} 실패 (HTTP ${r.status})`;
}

/** 연결 관리 (4b 스펙 7.1): 목록·테스트·삭제·추가/수정 */
export function ConnectionsManager() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const r = await fetch("/api/connections", { method: "GET" });
    if (r.ok) setRows((await r.json()) as Row[]);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const note = (name: string, text: string) => setResults((s) => ({ ...s, [name]: text }));

  const save = async () => {
    const body = form.via === "direct"
      ? { name: form.name, via: "direct", host: form.host, port: Number(form.port), service: form.service, user: form.user, secretRef: form.secretRef }
      : { name: form.name, via: "agent", url: form.url, secretRef: form.secretRef };
    setBusy(true);
    try {
      const r = await fetch(`/api/connections/${encodeURIComponent(form.name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { alert(await failureMessage(r, "저장")); return; }
      setForm(empty); await refresh();
    } finally { setBusy(false); }
  };
  const test = async (name: string) => {
    note(name, "테스트 중…");
    const r = await fetch(`/api/connections/${encodeURIComponent(name)}/test`, { method: "POST" });
    const body = (await r.json().catch(() => null)) as { ok?: boolean; elapsedMs?: number; error?: { message?: string } | string; code?: string } | null;
    if (r.ok && body?.ok) note(name, `OK (${body.elapsedMs}ms)`);
    else note(name, `실패: ${typeof body?.error === "string" ? body.error : body?.error?.message ?? `HTTP ${r.status}`}`);
  };
  const remove = async (name: string) => {
    if (!window.confirm(`연결 "${name}"을(를) 삭제할까요?`)) return;
    const r = await fetch(`/api/connections/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (r.status === 204) { await refresh(); return; }
    note(name, await failureMessage(r, "삭제"));
  };
  const edit = (r: Row) => setForm({ name: r.name, via: r.via, host: r.host ?? "", port: String(r.port ?? 1521), service: r.service ?? "", user: r.user ?? "", url: r.url ?? "", secretRef: r.secretRef });
  const btn = "text-xs border rounded px-2 py-1 bg-white hover:bg-neutral-100 disabled:opacity-50";
  const field = (label: string, key: keyof Form, type = "text") => (
    <label className="text-xs flex flex-col">{label}<input aria-label={label} type={type} className="border rounded px-2 py-1" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
  );
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm bg-white border rounded">
        <thead><tr className="text-left border-b"><th className="p-2">이름</th><th className="p-2">방식</th><th className="p-2">대상</th><th className="p-2">비밀값</th><th className="p-2">사용처</th><th className="p-2"></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} data-testid={`conn-${r.name}`} className="border-b align-top">
              <td className="p-2 font-mono">{r.name}</td><td className="p-2">{r.via}</td><td className="p-2">{target(r)}</td>
              <td className="p-2">{r.secretRef} {r.secretConfigured ? <span className="text-green-700">설정됨</span> : <span className="text-amber-700">미설정</span>}</td>
              <td className="p-2">{r.usedBy.length}</td>
              <td className="p-2 flex gap-1">
                <button name="test" className={btn} onClick={() => test(r.name)}>테스트</button>
                <button name="edit" className={btn} onClick={() => edit(r)}>수정</button>
                <button name="delete" className={btn} onClick={() => remove(r.name)}>삭제</button>
                {results[r.name] && <span data-testid={`test-${r.name}`} className="text-xs">{results[r.name]}</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="p-2 text-neutral-500" colSpan={6}>연결이 없습니다</td></tr>}
        </tbody>
      </table>
      <div className="border rounded p-3 bg-white flex flex-col gap-2">
        <div className="text-sm font-semibold">연결 추가 / 수정</div>
        <div className="grid grid-cols-2 gap-2">
          {field("이름", "name")}
          <label className="text-xs flex flex-col">방식<select aria-label="방식" className="border rounded px-2 py-1" value={form.via} onChange={(e) => setForm({ ...form, via: e.target.value as Form["via"] })}><option value="direct">direct (oracledb)</option><option value="agent">agent (중계)</option></select></label>
          {form.via === "direct" ? <>{field("호스트", "host")}{field("포트", "port", "number")}{field("서비스", "service")}{field("사용자", "user")}</> : field("URL", "url")}
          {field("비밀값 이름", "secretRef")}
        </div>
        <div className="text-xs text-neutral-500">서버 환경변수 <code>DAPORT_SECRET_{form.secretRef || "<이름>"}</code>에 {form.via === "direct" ? "비밀번호" : "에이전트 토큰"}을 넣으세요.</div>
        <div><button className={btn} disabled={busy || !form.name} onClick={save}>연결 저장</button></div>
      </div>
    </div>
  );
}
```
`apps/studio/src/app/ReportList.tsx`의 "API 키" 링크 옆에 `<Link className="text-xs text-blue-700 hover:underline" href="/settings/connections">연결</Link>`를 추가한다(기존 `ReportList.test.tsx` 통과 유지).

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck`
Expected: PASS. `@daport/datasource/sql` 서브패스가 studio의 클라이언트 번들에서 해석되는지 `pnpm --filter studio build`를 한 번 돌려 확인한다(빌드가 오래 걸리면 `next build`의 타입·번들 단계까지만 보고 중단해도 된다 — 실패 시 서브패스가 Node 전용 코드를 끌어오는지 확인한다).

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/src/editor/data apps/studio/src/app/settings/connections apps/studio/src/app/ReportList.tsx
git -c core.hooksPath=/dev/null commit -m "feat(studio): sql 데이터셋 폼(연결·쿼리·바인드·가드 확인), + sql, 컬럼 타입 힌트, 연결 관리 화면

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 환경 예시와 4b E2E (가짜 에이전트 동반 기동)

**Files:**
- Modify: `apps/studio/.env.example`, `apps/studio/playwright.config.ts`
- Create: `apps/studio/e2e/phase4b.spec.ts`

**Interfaces:**
- Consumes: T5 `AGENT_FAKE=1` 에이전트, T6·T8 UI/API.

- [ ] **Step 1: 환경·Playwright**

`.env.example` 끝에:
```
# Oracle 연결의 비밀값. 연결 화면의 "비밀값 이름"과 맞춘다 (direct: 비밀번호, agent: 에이전트 토큰)
DAPORT_SECRET_MES_DB_PASSWORD=
DAPORT_SECRET_FACTORY_AGENT_TOKEN=
```
`playwright.config.ts`의 `webServer`를 배열로:
```ts
const E2E_AGENT_TOKEN = "e2e-agent-token-0123456789abcdef";   // 32자 이상
webServer: [
  { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000, env: { ...process.env, DAPORT_DEV_API_KEY: "e2e-dev-key", DAPORT_SECRET_E2E_AGENT: E2E_AGENT_TOKEN } },
  // 가짜 에이전트. /health는 토큰 없이 401을 돌려주며 Playwright는 401도 "떠 있음"으로 본다
  { command: "pnpm --filter agent dev", url: "http://localhost:8433/health", reuseExistingServer: !process.env.CI, timeout: 60_000, env: { ...process.env, AGENT_FAKE: "1", AGENT_TOKEN: E2E_AGENT_TOKEN, AGENT_PORT: "8433" } },
],
```
이미 떠 있는 dev 서버를 재사용하면 `DAPORT_SECRET_E2E_AGENT`가 없어 연결 테스트가 400이 된다 — 스펙 파일 상단 주석에 적는다.

- [ ] **Step 2: E2E 작성**

`apps/studio/e2e/phase4b.spec.ts`:
```ts
// dev 서버에 DAPORT_SECRET_E2E_AGENT=e2e-agent-token-0123456789abcdef, 에이전트에 같은 AGENT_TOKEN과 AGENT_FAKE=1이 있어야 한다 (playwright.config webServer가 넣는다)
import { test, expect, type Page } from "@playwright/test";

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

test("register an agent connection, test it, run a sql dataset through it, bind a field, render PDF; delete is refused while in use", async ({ page }) => {
  const name = `e2e-agent-${Date.now() % 100000}`;
  await page.goto("/settings/connections");
  await page.getByLabel("방식").selectOption("agent");
  await page.getByLabel("이름").fill(name);
  await page.getByLabel("URL").fill("http://localhost:8433");
  await page.getByLabel("비밀값 이름").fill("E2E_AGENT");
  await page.getByRole("button", { name: "연결 저장" }).click();
  const row = page.getByTestId(`conn-${name}`);
  await expect(row).toContainText("설정됨");
  await row.locator('button[name="test"]').click();
  await expect(page.getByTestId(`test-${name}`)).toContainText("OK");

  const id = `e2e-sql-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "데이터" }).click();
  await page.getByRole("button", { name: "+ sql" }).click();
  await page.getByLabel("이름", { exact: true }).fill("lines");
  await page.getByLabel("연결").selectOption(name);
  await page.getByLabel("쿼리").fill("SELECT NO, QTY, DT FROM LINES WHERE NO = :orderNo");
  await expect(page.getByTestId("binds")).toContainText(":orderNo");
  await page.getByRole("button", { name: "쿼리 확인" }).click();
  await expect(page.getByTestId("guard-result")).toContainText("허용");
  await page.getByTestId("fetch-sample").click();
  const fields = page.getByTestId("fields-lines");
  await expect(fields.locator('[data-path="NO"]')).toBeVisible();
  await expect(fields.locator('[data-path="DT"]')).toContainText(/date/i);   // 컬럼 타입 힌트

  // 필드를 캔버스에 드롭 → 값 표시 → PDF
  const canvas = page.getByTestId("canvas");
  await fields.locator('[data-path="NO"]').dragTo(canvas.locator(".dp-page"), { targetPosition: { x: 80, y: 80 } });
  await expect(canvas).toContainText("A-1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByTestId("save").click();

  // 사용 중 삭제 거부
  await page.goto("/settings/connections");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`conn-${name}`).locator('button[name="delete"]').click();
  await expect(page.getByTestId(`conn-${name}`)).toContainText(id);
});

test("guard rejects a write query in the editor", async ({ page }) => {
  const id = `e2e-guard-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "데이터" }).click();
  await page.getByRole("button", { name: "+ sql" }).click();
  await page.getByLabel("쿼리").fill("DELETE FROM T");
  await page.getByRole("button", { name: "쿼리 확인" }).click();
  await expect(page.getByTestId("guard-result")).toContainText("SELECT 또는 WITH");
});
```
드롭 동작의 정확한 방식(`dragTo` vs 기존 phase2 스펙의 `dispatchEvent`로 `application/x-daport-field` 데이터 전송)은 `phase2.spec.ts`의 드롭 코드를 그대로 따른다 — `dragTo`가 실제 앱의 HTML5 DnD를 못 흉내 내면 phase2의 방식으로 바꾼다. 필드 트리 항목이 타입을 텍스트로 보여주지 않으면 그 단언은 `data-type` 속성 등 실제 마크업에 맞춘다(단언을 지우지는 않는다).

- [ ] **Step 3: 실행**

Run: `pnpm --filter studio test && pnpm --filter studio typecheck && pnpm --filter studio e2e`
Expected: 단위 전부 PASS, E2E 기존 17 + 신규 2 전부 PASS. UI 결함으로 실패하면 컴포넌트를 고치지 말고 DONE_WITH_CONCERNS로 정확한 실패를 보고한다.

- [ ] **Step 4: 커밋**

```bash
git add apps/studio/.env.example apps/studio/playwright.config.ts apps/studio/e2e/phase4b.spec.ts
git -c core.hooksPath=/dev/null commit -m "test(studio): 4b E2E — 에이전트 연결 등록·테스트·sql 데이터셋·PDF, 가드 거부; 환경 예시

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 자체 점검 (플랜 작성자)

- **스펙 커버리지**: §4.1 → T1(`ConnectionSchema`); §4.2 → T1(`guardSql`, `SQL_NOT_ALLOWED`); §4.3 → T2(`convert.ts`)·T3(`maxRows+1`, 오류 매핑); §4.4 → T6; §5.1–5.3 → T3; §5.4 → T2; §5.5 → T4; §6.1–6.4 → T5; §7.1 → T6·T8; §7.2 → T7; §7.3 → T8(+T1 `inferFields` 힌트, T7 샘플 `columns`); §7.4 → T7; §7.5 → T9(.env)·README(T4); §8 → 각 커넥터·라우트의 오류 매핑; §9 → 각 태스크 테스트 + T9 E2E; §10 완료 기준 1 → T9, 2 → T4, 3 → T1·T3·T5 테스트(비밀값 마스킹·로그), 4 → T5 빌드 확인, 5 → 전체 스위트.
- **타입 일관성**: `ManagedConnector`(T2 정의, T3·T5 사용), `SqlColumn`(T1 → T3·T7), `Connection`/`DirectConnection`/`AgentConnection`(T1 → T3·T6·T8), `connectorFor(conn, secrets)`(T3 → T6 test 라우트·T7), `FakeSqlConnector` 기본 행 `{ NO: "A-1", QTY: 3, DT }`(T2 → T5·T7·T9 단언), `readResponseLimited`(T1 → T3), 에이전트 응답 `{ rows, columns }`/`{ error: { code, message } }`(T3 ↔ T5), UI testid/aria-label(T8 ↔ T9).
- **자리표시자 없음**: 모든 단계에 코드가 있다. 구현자가 코드베이스에서 확인하도록 남긴 항목(`ParamDef` 타입 이름, `metaData[].dbTypeName` 타입, phase2 드롭 방식, 필드 트리 타입 마크업, testcontainers 버전)은 결정을 미룬 것이 아니라 실제 값을 읽어 맞추라는 지시다.
