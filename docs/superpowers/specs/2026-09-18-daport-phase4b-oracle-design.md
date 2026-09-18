# daport 4b단계 설계 스펙: Oracle 커넥터·연결 관리·중계 에이전트

작성일: 2026-09-18
상태: 승인됨
상위 스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` (7.1–7.2장)
이전 단계: `docs/superpowers/specs/2026-09-18-daport-phase4-publish-api-design.md`
관련 조사: `docs/superpowers/research/2026-09-17-oracle-connectivity.md`

## 1. 목적

sql 데이터셋이 실제로 돈다. 2단계가 정한 `SqlConnector` 규격(순수 JSON, 이름 바인드, 연결 이름 참조)의 구현 두 가지 — studio 프로세스가 `oracledb` thin 모드로 직접 붙는 **direct**와, 공장 안에서 돌며 HTTPS로 같은 계약을 중계하는 **agent** — 를 만들고, 연결 설정을 studio에서 관리하며, sql 데이터셋을 화면에서 편집할 수 있게 한다. 레포트는 지금처럼 연결 **이름**만 참조하므로 데이터셋 스키마는 바뀌지 않는다.

사용자 로그인, 쿼리 캐시·이력, 다른 DB 커넥터는 범위 밖이다(11장).

## 2. 원칙과 확정된 결정

| 항목 | 결정 |
|---|---|
| 연결 방식 | direct(oracledb thin)와 agent(공장 안 HTTP 중계) 둘 다. 연결 설정의 `via`가 고른다. 개발·사내 배포는 direct, Vercel은 agent |
| 연결 관리 | `connections` DB 테이블 + studio 화면. 비밀번호·에이전트 토큰은 `DAPORT_SECRET_<이름>` 환경변수 참조(`secretRef`)만 저장 |
| 가드 | 단일 `SELECT`/`WITH` 문만, 이름 바인드만, 타임아웃 30초, 행 10,000. direct·agent가 같은 공용 모듈(`guardSql`)을 실행 직전에 호출한다 |
| 결과 규격 | 순수 JSON(날짜 ISO 8601, 큰 수 문자열). 커넥터 구현이 바뀌어도 데이터셋·레이아웃은 모른다 |
| 테스트 | 가짜 커넥터로 전부 커버. 실제 Oracle은 `ORACLE_IT=1`일 때만 `@testcontainers/oraclefree`로 도는 별도 파일. 기본 `pnpm test`는 Docker 없이 통과 |
| 패키지 | `packages/oracle`(커넥터 두 종·타입 변환·가짜), `apps/agent`(Next 없는 Node 서버). studio는 `@daport/oracle`을 쓴다 |
| 비밀값 | 레이아웃 컨텍스트·샘플·응답·오류·로그 어디에도 넣지 않는다. 오류 메시지의 비밀값 문자열은 `***` |

## 3. 패키지 구조 변화

```
packages/
  datasource  + connection 스키마, sql-guard, 오류 코드 SQL_NOT_ALLOWED
  oracle      (신규) DirectOracleConnector(oracledb thin), AgentConnector(HTTP), 타입 변환, FakeSqlConnector, connectorFor
apps/
  agent       (신규) 공장 안 중계 서버 — /health, /query. @daport/oracle·@daport/datasource만 의존. esbuild 단일 번들
  studio      + connections 테이블·저장소·API·/settings/connections 화면, runDatasets가 연결로 커넥터 조립,
              + DatasetEditor sql 폼, 샘플 결과 컬럼 타입 힌트, 가져오기 "연결 없음" 경고
```

의존 방향: `oracle → datasource(타입·가드)`; `agent → oracle, datasource`; `studio → oracle, datasource`. `oracle`은 core·renderer를 모른다. 새 외부 의존: `oracledb`(oracle), `esbuild`(agent devDependency), `@testcontainers/oraclefree`(oracle devDependency, 선택 통합 테스트).

## 4. 연결 모델·가드·비밀값

### 4.1 연결 스키마 (`packages/datasource/src/connection.ts`)

```ts
export const ConnectionSchema = z.discriminatedUnion("via", [
  z.object({ name: ConnectionName, via: z.literal("direct"), host: z.string().min(1), port: z.number().int().min(1).max(65535).default(1521),
             service: z.string().min(1), user: z.string().min(1), secretRef: SecretRef }),
  z.object({ name: ConnectionName, via: z.literal("agent"), url: z.string().url(), secretRef: SecretRef }),
]);
// ConnectionName = /^[a-z0-9][a-z0-9-]*$/ (최대 64자), SecretRef = /^[A-Z0-9_]+$/
export type Connection = z.infer<typeof ConnectionSchema>;
export type DirectConnection / AgentConnection
```

- direct의 `secretRef`는 비밀번호, agent의 `secretRef`는 에이전트 토큰. 값은 2단계 `envSecrets()`로 `DAPORT_SECRET_<secretRef>`에서만 읽는다. DB에는 참조 이름만 있다.
- agent `url`은 origin(`https://agent.factory.local:8433`). `https:` 필수, `http:`는 host가 `localhost`/`127.0.0.1`일 때만 허용(개발용).
- 레포트의 `SqlDatasetSchema { name, type: "sql", connection, query }`는 불변.

### 4.2 공용 가드 (`packages/datasource/src/sql-guard.ts`)

```ts
export function guardSql(sql: string): void;   // 위반 시 DatasetFailure("SQL_NOT_ALLOWED", 사유)
```

- 2단계 `bindNames`와 같은 어휘 규칙으로 주석(`--`, `/* */`), 문자열(`'…'`, `''`), q-인용, 큰따옴표 식별자를 건너뛴 토큰 열에서:
  1. 첫 키워드(대소문자 무시)가 `SELECT` 또는 `WITH`여야 한다. `INSERT`·`UPDATE`·`DELETE`·`MERGE`·`BEGIN`·`DECLARE`·`ALTER`·`CREATE`·`DROP`·`CALL`·`EXEC` 등은 여기서 걸러진다.
  2. 문장 구분자 `;`가 있으면 안 된다(끝의 `;` 하나도 거부 — 명확성 우선).
  3. 토큰 열에 `FOR` 바로 뒤 `UPDATE`가 나오면 안 된다(행 잠금).
  4. 빈 문자열·공백만이면 거부.
- 이 가드는 1차 방어다. 2차는 direct 커넥터의 `SET TRANSACTION READ ONLY`, 3차는 운영 절차(읽기 전용 DB 계정 — README에 명시).
- `DatasetErrorCode`에 `SQL_NOT_ALLOWED`를 추가한다.

### 4.3 한도와 결과 규격

- 2단계 `Limits` 그대로: `timeoutMs 30_000`, `maxRows 10_000`, `maxBytes 20MB`(agent 응답).
- 커넥터는 `maxRows + 1`행까지 읽고 넘치면 `TOO_MANY_ROWS`. 드라이버·에이전트·네트워크 타임아웃은 `TIMEOUT`. 드라이버·SQL 오류는 `SQL_ERROR`(ORA/NJS 코드는 남기고 비밀값은 `***`).
- 타입 변환(`packages/oracle/src/convert.ts`, 순수 함수):

| Oracle | JSON | `columns[].type` |
|---|---|---|
| VARCHAR2/CHAR/NVARCHAR2/CLOB/NCLOB | string | `string` |
| NUMBER/FLOAT/BINARY_*: 안전 정수 또는 유한 실수 | number | `number` |
| NUMBER: 안전 범위 밖(자릿수 > 15) | 문자열 | `number` |
| DATE/TIMESTAMP(+TZ) | ISO 8601 문자열(UTC) | `date` |
| NULL | null | 그 컬럼의 선언 타입 |
| RAW/BLOB/BFILE/XMLTYPE/객체 | `SQL_ERROR`("지원하지 않는 컬럼 타입: <이름>") | — |

- 컬럼 이름은 Oracle이 돌려주는 그대로(대문자). 데이터 트리·표현식은 `ds.ORDER_NO`로 접근한다.

### 4.4 연결 저장소 (studio)

- 테이블 `connections(name text pk, body jsonb, created_at, updated_at)`. `body`는 `ConnectionSchema`를 통과한 값.
- `ConnectionStore { list(): Connection[]; get(name): Connection | null; upsert(conn): void; delete(name): void }` — `MemoryConnectionStore`·`DbConnectionStore`, `getConnectionStore()` 싱글턴(기존 패턴).
- 삭제 전 사용처 검사는 라우트가 한다: 모든 레포트 draft의 sql 데이터셋 `connection`을 훑어(컴포넌트 사용처와 같은 전체 훑기) 하나라도 있으면 409 `CONNECTION_IN_USE`와 레포트 id 목록.
- `upsert`가 기존 direct 연결을 바꾸면 그 이름의 풀을 닫는다(`@daport/oracle`의 `closeConnector(name)`).
- 번들: `manifest.connections.sql`(4단계)은 이 이름을 가리킨다. 연결 자체는 번들에 담지 않는다(인스턴스별 설정).

## 5. `packages/oracle`

### 5.1 의존과 공개 API

- 외부 의존 `oracledb ^6.5`(thin 모드만, Instant Client 불필요). 내부 의존 `@daport/datasource`(`SqlConnector`, `Limits`, `DatasetFailure`, `guardSql`, `Connection`, `SecretResolver`).

```ts
export type ManagedConnector = SqlConnector & { ping(): Promise<void>; close(): Promise<void> };
export function createDirectConnector(conn: DirectConnection, password: string): ManagedConnector;
export function createAgentConnector(conn: AgentConnection, token: string, fetchImpl?: typeof fetch): ManagedConnector;   // close는 no-op
export function connectorFor(conn: Connection, secrets: SecretResolver): ManagedConnector;   // 비밀값 없으면 DatasetFailure("SQL_NOT_CONFIGURED")
export function closeConnector(name: string): Promise<void>;   // 프로세스 홀더에서 그 이름의 풀을 닫고 제거
export { FakeSqlConnector } from "./testing";
export { convertRow, convertColumnType, sanitizeError } from "./convert";
```

### 5.2 direct 커넥터

- 연결 이름마다 `oracledb.createPool({ user, password, connectString: "host:port/service", poolMin: 0, poolMax: 4, poolTimeout: 60, sessionCallback })`을 한 번만 만들어 `globalThis` 홀더에 둔다(Next의 모듈 이중 로딩 대비). `sessionCallback`은 `ALTER SESSION SET TIME_ZONE = 'UTC'`.
- `query(sql, binds, { timeoutMs, maxRows, signal })`:
  1. `guardSql(sql)`.
  2. `pool.getConnection()`; `connection.callTimeout = timeoutMs`.
  3. `SET TRANSACTION READ ONLY`.
  4. `execute(sql, binds, { outFormat: OUT_FORMAT_OBJECT, maxRows: maxRows + 1, fetchTypeHandler })` — `fetchTypeHandler`가 DATE/TIMESTAMP를 ISO 문자열로, CLOB을 문자열로, NUMBER를 4.3 규칙으로 바꾼다. 지원하지 않는 타입은 메타데이터 단계에서 `SQL_ERROR`.
  5. 행 수 > `maxRows` → `TOO_MANY_ROWS`.
  6. `finally`: `ROLLBACK` 후 `connection.close()`.
- 오류 매핑: `NJS-123`/`ORA-01013`/`callTimeout` → `TIMEOUT`; `ORA-12xxx`·`NJS-5xx`(접속) → `SQL_ERROR`("연결 실패: …"); 그 밖 → `SQL_ERROR`. `sanitizeError(message, [password])`가 비밀값을 `***`로 치환한다.
- `ping()`: `SELECT 1 FROM DUAL`(가드·타임아웃 5초). `close()`: 풀 닫기.

### 5.3 agent 커넥터

- `POST {url}/query`, 헤더 `authorization: Bearer <token>`, `content-type: application/json`, 본문 `{ sql, binds, timeoutMs, maxRows }`. 응답 200 `{ rows, columns }`; 실패 `{ error: { code, message } }`.
- `AbortSignal.timeout(timeoutMs + 5_000)`(네트워크 여유). 응답은 2단계 http 커넥터의 스트림 읽기 헬퍼로 20MB까지만 읽는다(`TOO_LARGE`). `redirect: "manual"`, 3xx는 `SQL_ERROR`.
- 매핑: 401/403 → `SQL_NOT_CONFIGURED`("에이전트가 토큰을 거부했습니다"); 429 → `SQL_ERROR`("에이전트 과부하"); 504 또는 abort → `TIMEOUT`; 5xx·연결 실패 → `SQL_ERROR`; 본문의 `error.code`가 `DatasetErrorCode`면 그대로, 아니면 `SQL_ERROR`.
- `ping()`: `GET {url}/health`(같은 토큰, 5초).

### 5.4 가짜 커넥터 (`packages/oracle/src/testing.ts`)

```ts
class FakeSqlConnector implements ManagedConnector {
  constructor(script?: { rows?: Row[]; columns?: Column[]; delayMs?: number; fail?: DatasetErrorCode | Error })
  calls: { sql: string; binds: Record<string, unknown>; opts }[];
  when(sqlIncludes: string, result: { rows, columns } | { fail }): this;   // 쿼리별 스크립트
}
```
2단계 `execute.test.ts`의 인라인 가짜를 이것으로 바꾼다. studio·agent 테스트가 같은 클래스를 쓴다.

### 5.5 통합 테스트 (선택)

- `packages/oracle/src/__tests__/direct.it.test.ts`: vitest 설정에서 `ORACLE_IT=1`일 때만 `include`. `@testcontainers/oraclefree`로 `gvenzl/oracle-free:23.26.3-slim-faststart`를 띄우고(테스트 실행당 컨테이너 하나, `globalSetup`), 검증: 타입 변환(DATE·TIMESTAMP WITH TZ·NUMBER(38)·NUMBER 소수·CLOB·NULL), `INSERT` → `SQL_NOT_ALLOWED`(가드에서), `SELECT … FOR UPDATE` 거부, 행 상한 `TOO_MANY_ROWS`(`CONNECT BY LEVEL <= 20000`), 타임아웃(`callTimeout` 1초 + 무거운 조인), `ping`, 풀 재사용.
- Colima 설치·실행 절차(`brew install colima docker`, `colima start --cpu 4 --memory 6`, `DOCKER_HOST`·`TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE`·`NODE_OPTIONS=--dns-result-order=ipv4first`)는 `packages/oracle/README.md`에 적는다. 구현 중 한 번 실행해 결과를 README에 기록한다.

## 6. `apps/agent`

### 6.1 형태

- Node 20+, `node:http`(TLS는 `AGENT_TLS_CERT`/`AGENT_TLS_KEY`가 있으면 `node:https`). 의존 `@daport/oracle`·`@daport/datasource`. `esbuild`로 `dist/agent.mjs` 단일 번들(`oracledb`는 external — `dist/` + `package.json`(oracledb만 dependencies)이 배포물, 사내 서버에서 `pnpm install --prod && node dist/agent.mjs`).
- 환경변수: `AGENT_PORT`(기본 8433), `AGENT_TOKEN`(필수, 32자 이상 아니면 기동 거부), `ORACLE_HOST`, `ORACLE_PORT`(1521), `ORACLE_SERVICE`, `ORACLE_USER`, `ORACLE_PASSWORD`, `AGENT_MAX_CONCURRENCY`(기본 8), `AGENT_TLS_CERT`/`AGENT_TLS_KEY`(선택). DB 자격 증명은 이 프로세스 밖으로 나가지 않는다.
- 테스트·E2E용 `AGENT_FAKE=1`이면 `FakeSqlConnector`(고정 결과)를 쓴다.

### 6.2 엔드포인트

| 경로 | 동작 |
|---|---|
| `GET /health` | 토큰 필요. `ping()` 성공 200 `{ ok: true, version }`, 실패 503 `{ ok: false, error: { code, message } }` |
| `POST /query` | 토큰 필요. 본문 `{ sql, binds?, timeoutMs?, maxRows? }`(1MB 한도, 초과 413). `timeoutMs`·`maxRows`는 상한(30초·10,000)으로 클램프. `guardSql` → direct 커넥터 → 200 `{ rows, columns }`. 실패 `{ error: { code, message } }` + 상태: `SQL_NOT_ALLOWED`/`BAD_PARAM` 400, `TIMEOUT` 504, `TOO_MANY_ROWS` 400, `SQL_ERROR` 502 |
| 그 밖 | 404 `{ error: { code: "NOT_FOUND" } }` |

- 토큰: `authorization: Bearer <token>`, 상수 시간 비교. 없거나 틀리면 401 `{ error: { code: "UNAUTHORIZED" } }`.
- 동시 요청이 `AGENT_MAX_CONCURRENCY`를 넘으면 429 `{ error: { code: "BUSY" } }`.
- 접근 로그 한 줄(ISO 시각, 메서드, 경로, 상태, 소요 ms, 행 수). SQL 본문·바인드·토큰은 로그하지 않는다.
- `SIGTERM`에 풀을 닫고 종료.

### 6.3 studio 쪽 대응

- `via: "agent"` 연결의 `url`에 `AgentConnector`가 `/query`·`/health`를 붙인다. 가드·타입 변환·오류 코드는 `@daport/oracle` 한 곳에 있으므로 양쪽이 같다. `/health`의 `version`은 `@daport/oracle` 패키지 버전이며 응답 형식은 4b 안에서 고정한다.

### 6.4 테스트

- 단위: `FakeSqlConnector`를 주입한 서버를 `listen(0)`으로 띄워 실제 HTTP로 `/health`, `/query` 성공, 401(토큰 없음·틀림), 429, 413, 클램프, 가드 거부 400, 타임아웃 504, `SQL_ERROR` 502, 접근 로그에 SQL 미포함, `SIGTERM` 종료.
- `AgentConnector ↔ agent` 왕복 테스트는 `packages/oracle`에 둔다(에이전트 서버 모듈을 devDependency로 import).

## 7. 스튜디오 (apps/studio)

### 7.1 연결 관리 API·화면

| 라우트 | 동작 |
|---|---|
| `GET /api/connections` | `[{ ...conn, secretConfigured: boolean }]` — 비밀값 자체는 절대 없음 |
| `PUT /api/connections/:name` | `ConnectionSchema` 검증(URL의 name이 우선) → upsert → 200. 400 스키마 오류. direct면 `closeConnector(name)` |
| `DELETE /api/connections/:name` | 사용 중 409 `{ code: "CONNECTION_IN_USE", reports: [id…] }`, 없음 404, 성공 204 + `closeConnector` |
| `POST /api/connections/:name/test` | 비밀값 없음 400 `SECRET_MISSING`; `connectorFor(...).ping()` 200 `{ ok: true, elapsedMs }` / 502 `{ ok: false, error: { code, message } }` |

- 전부 studio 내부 라우트(무인증, 동일 출처). 본문 20MB 한도 헬퍼 재사용.
- 화면 `/settings/connections`(클라이언트 컴포넌트 + 서버 페이지): 표(이름·방식·대상(host:port/service 또는 url)·secretRef·비밀 설정 여부·사용처 수) + 행별 "테스트"(결과를 행에 표시)·"삭제"(사용 중이면 409 사유 표시), 아래에 추가/수정 폼(`aria-label`: 이름·방식·호스트·포트·서비스·사용자·URL·비밀값 이름; 방식에 따라 필드 전환; `DAPORT_SECRET_<이름>`을 env에 넣으라는 안내 문구). 홈 화면 "API 키" 옆에 "연결" 링크.

### 7.2 데이터셋 실행 조립

- `lib/datasets.ts`의 `runDatasets`: 레포트의 sql 데이터셋이 참조하는 연결 이름을 모아 `getConnectionStore().get(name)`으로 읽고 `connectors.sql[name] = connectorFor(conn, envSecrets())`. 연결이 없거나 비밀값이 없으면 커넥터를 넣지 않아 2단계대로 `SQL_NOT_CONFIGURED`. 커넥터 생성 자체는 풀을 열지 않으므로(첫 쿼리에서 연다) 실패 비용이 없다.
- 렌더 API·미리보기·샘플·PDF·라벨·인쇄가 모두 같은 `runDatasets`를 쓰므로 변경은 한 곳이다.

### 7.3 sql 데이터셋 편집 (DatasetEditor)

- "커넥터 미설정" 안내를 폼으로 교체: `<select aria-label="연결">`(`GET /api/connections`; 비어 있으면 "연결을 먼저 등록하세요" + `/settings/connections` 링크), `<textarea aria-label="쿼리">`, 읽기 전용 "바인드: :orderNo, :lot"(`bindNames`), 레포트 `params`에 없는 바인드는 경고 문구, "쿼리 확인" 버튼이 클라이언트에서 `guardSql`을 실행해 결과를 표시(서버도 다시 검사한다).
- 실행은 기존 "샘플 가져오기"(`POST …/sample`)가 담당한다. 샘플 응답의 `columns[].type`을 `inferFields(rows, columnTypes?)`에 힌트로 넘겨 데이터 트리 타입이 채워진다(빈 결과여도 컬럼이 보인다).

### 7.4 번들·가져오기

- 가져오기 응답 `warnings`에 "연결 <이름>이(가) 이 인스턴스에 없습니다"를 넣는다(`getConnectionStore().list()`와 대조). `connectionMap`은 4단계 그대로.

### 7.5 환경·배포

- `.env.example`: `DAPORT_SECRET_MES_DB_PASSWORD=`, `DAPORT_SECRET_FACTORY_AGENT_TOKEN=` 예시와 설명.
- studio에 `@daport/oracle`(→ `oracledb`)이 들어온다. thin 모드는 순수 JS라 Vercel 빌드에 Instant Client가 필요 없다. `pnpm --filter studio db:push`로 `connections` 테이블 반영.

## 8. 오류 처리

| 상황 | 코드 | 응답 |
|---|---|---|
| 가드 위반(SELECT/WITH 아님, `;`, `FOR UPDATE`, 빈 쿼리) | `SQL_NOT_ALLOWED` | 데이터셋 오류 → 400 |
| 연결 이름 없음 / 비밀값 미설정 / 에이전트 토큰 거부 | `SQL_NOT_CONFIGURED` | 데이터셋 오류 → 400 |
| 드라이버·SQL 오류, 접속 실패, 지원 안 하는 컬럼 타입, 에이전트 5xx·3xx | `SQL_ERROR` | 데이터셋 오류 → 400(메시지에 ORA/NJS 코드, 비밀값 `***`) |
| 타임아웃(드라이버·에이전트·네트워크) | `TIMEOUT` | 데이터셋 오류 → 400 |
| 행 상한 초과 | `TOO_MANY_ROWS` | 데이터셋 오류 → 400 |
| 에이전트 응답 20MB 초과 | `TOO_LARGE` | 데이터셋 오류 → 400 |
| 연결 삭제 시 사용 중 | `CONNECTION_IN_USE` | 409 + 사용처 id |
| 연결 테스트: 비밀값 없음 / 실패 | `SECRET_MISSING` / — | 400 / 502 `{ ok: false, error }` |
| 에이전트 인증 실패 | `UNAUTHORIZED` | 401 (존재 비노출) |
| 에이전트 동시 요청 초과 / 본문 초과 | `BUSY` / — | 429 / 413 |

데이터셋 오류는 2단계 규칙대로 미리보기·PDF·라벨·인쇄·렌더 API에서는 치명(400 + `datasetErrors`), 샘플 가져오기에서는 부분 허용이다.

## 9. 테스트

- **datasource**: `ConnectionSchema` 경계(이름 규칙·길이, via별 필수 필드, `port` 기본값, `secretRef` 형식, agent `url` 스킴 규칙); `guardSql` 허용(`SELECT`, `WITH`, 주석·문자열·q-인용 안의 `;`/`for update`/`insert` 무시, 앞 공백·주석 뒤의 SELECT) / 거부(INSERT·UPDATE·DELETE·MERGE·BEGIN·DECLARE·ALTER·CREATE·DROP, 두 문장, 끝 `;`, `FOR UPDATE`, 빈 문자열).
- **oracle**: `FakeSqlConnector` 스크립트 동작; `convertRow`/`convertColumnType`(DATE→ISO UTC, NUMBER 안전 범위·큰 수 문자열, CLOB, NULL, 미지원 타입 오류); `sanitizeError`; `AgentConnector`(가짜 fetch로 요청 형식·bearer·`redirect: manual`·타임아웃 여유·401→`SQL_NOT_CONFIGURED`·429/5xx→`SQL_ERROR`·`TOO_LARGE`·`https` 강제와 localhost 예외); `connectorFor` via 분기·비밀값 누락; `AgentConnector ↔ agent 서버` 왕복. 통합(`ORACLE_IT=1`): 5.5.
- **agent**: 6.4 전부.
- **studio 단위**: 연결 저장소(메모리) CRUD; 연결 라우트 4종(목록에 비밀값 없음·`secretConfigured`, PUT 검증·name 우선·`closeConnector` 호출, DELETE 409/404/204, test 200/502/400); `runDatasets`가 연결별 커넥터를 조립하고 없는 연결·비밀값은 `SQL_NOT_CONFIGURED`(`@daport/oracle` mock); DatasetEditor sql 폼(연결 select·쿼리·바인드 표시·없는 파라미터 경고·가드 즉시 표시·연결 없음 안내); `/settings/connections` 화면(목록·추가·테스트 결과·삭제 409 표시); 가져오기 "연결 없음" 경고; `inferFields` 컬럼 타입 힌트; 샘플 라우트가 `columns`를 응답에 싣는다.
- **E2E** (`apps/studio/e2e/phase4b.spec.ts`): Playwright `webServer`를 배열로 늘려 `apps/agent`를 `AGENT_FAKE=1 AGENT_TOKEN=<32자>`로 함께 띄운다. 흐름: `/settings/connections`에서 agent 연결 등록(`http://localhost:<port>`) → "테스트" OK → 새 레포트에 sql 데이터셋 추가·연결 선택·쿼리 입력 → 샘플 가져오기 → 데이터 트리에 컬럼과 타입 → 필드 드롭 → 캔버스 값 표시 → PDF 다운로드. 이어서 연결 삭제 시도 → 409 문구 표시. 가드 거부 쿼리 입력 → "쿼리 확인" 경고.

## 10. 완료 기준

1. 가짜 에이전트로 E2E 전체 흐름(연결 등록 → 테스트 → sql 데이터셋 → 샘플 → 캔버스 → PDF)이 통과한다.
2. `ORACLE_IT=1` 통합 테스트가 컨테이너 Oracle에서 통과한다(이번 구현 중 Colima로 한 번 실행하고 결과를 README에 기록).
3. 가드가 `SELECT`/`WITH` 단일 문 외를 전부 거부하고, 비밀값이 응답·오류·로그·샘플 어디에도 없다.
4. 에이전트 배포물이 `dist/` + `package.json`만으로 `node dist/agent.mjs`로 뜨고 `/health`가 답한다.
5. 기존 단위·E2E 전부 통과.

## 11. 범위 밖 (이후 단계)

- 사용자 로그인(연결 화면 권한), 연결별 감사 로그·쿼리 이력.
- 에이전트 자동 업데이트, 서비스 등록 스크립트(systemd/NSSM), TLS 인증서 발급, 에이전트 다중 인스턴스.
- 쿼리 결과 캐시, 페이지네이션, 쓰기 쿼리, 저장 프로시저 호출, 바인드 배열.
- 다른 DB(MSSQL·Postgres) 커넥터 — 같은 `SqlConnector` 규격으로 이후 추가.
- AI 편집·페이지 생성(5단계), 3b·3·4단계 이월 사소 항목.
