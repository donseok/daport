# @daport/oracle

daport의 Oracle 데이터소스 커넥터 패키지. `@daport/datasource`가 정의하는 연결 스키마와 읽기 전용 SQL 가드 위에서,
Oracle에 실제로 붙는 두 가지 방식(`direct`/`agent`)을 구현한다.

## 커넥터 종류

- **direct**: 이 프로세스에서 `oracledb`(thin 모드)로 Oracle 리스너에 직접 접속한다. 연결(`Connection.name`)마다
  커넥션 풀 하나를 프로세스 전역에 캐시하고(`poolFor`), `closeConnector(name)`으로 닫는다.
- **agent**: 사내망 안에서만 Oracle에 접속할 수 있는 환경을 위한 중계 에이전트(HTTP)를 통해 쿼리한다. 요청·응답
  형식은 direct와 동일한 `SqlConnector` 인터페이스를 따른다.

## `connectorFor` 사용법

```ts
import { connectorFor } from "@daport/oracle";
import type { Connection, SecretResolver } from "@daport/datasource";

const conn: Connection = {
  name: "erp-report", via: "direct",
  host: "oracle.internal", port: 1521, service: "ERPDB",
  user: "RPT_READONLY", secretRef: "ERP_REPORT",
};

// secrets(secretRef)가 없으면 네트워크를 열지 않고 SQL_NOT_CONFIGURED로 즉시 실패한다
const c = connectorFor(conn, (ref) => process.env[`DAPORT_SECRET_${ref}`]);

const { rows, columns } = await c.query(
  "SELECT ORDER_ID, AMOUNT FROM SALES.ORDERS WHERE ORDER_DATE >= :from",
  { from: "2026-01-01" },
  { timeoutMs: 30_000, maxRows: 10_000 },
);

await c.close();
```

`conn.via`가 `"direct"`면 `createDirectConnector`, `"agent"`면 `createAgentConnector`로 라우팅된다. 풀은 첫
쿼리에서 열리므로 `connectorFor` 호출 자체는 네트워크에 닿지 않는다.

## 가드 3단계 (읽기 전용 보장)

daport는 Oracle 연결을 **읽기 전용**으로만 사용한다. 이를 코드 한 곳이 아니라 세 겹으로 강제한다.

1. **SQL 가드 (`guardSql`, `@daport/datasource`)** — direct/agent 커넥터가 쿼리를 실행하기 *직전*, 풀/네트워크를
   건드리기 전에 검사한다. `SELECT` 또는 `WITH`로 시작하는 단일 조회문만 허용하고, 문장 구분자(`;`)와
   `FOR UPDATE`(행 잠금)를 거부한다. 위반 시 드라이버까지 가지 않고 `DatasetFailure("SQL_NOT_ALLOWED", ...)`.
2. **세션 `READ ONLY`** — direct 커넥터는 쿼리 실행 전 매번 `SET TRANSACTION READ ONLY`를 건다. 가드를 어떻게든
   통과한 쓰기 구문이 있더라도 세션 수준에서 다시 막힌다.
3. **읽기 전용 DB 계정** — **운영 DB 계정에는 SELECT 권한만 부여한다.** 위 두 단계는 애플리케이션 버그를 막기
   위한 방어선이고, 최종적으로 신뢰하는 경계는 DB 권한이다. INSERT/UPDATE/DELETE/DDL 권한을 가진 계정으로
   daport를 연결하지 않는다.

## 운영 노출

`/settings/connections`와 데이터셋 관련 라우트(연결 테스트, sql 데이터셋 샘플)는 4b 스펙 §7.1이 정한 대로
**무인증·동일 출처**다 — 로그인(§11)이 들어오기 전까지는 이 인스턴스에 네트워크로 닿을 수 있는 누구나
설정된 연결로 가드를 통과하는 임의의 SELECT를 실행할 수 있다. 그래서 `DAPORT_SECRET_*`로 운영 Oracle에
붙는 studio 인스턴스는 **운영자만 접근 가능한 네트워크**(사내망·VPN 등)에만 두어야 하고, 공인 인터넷에
노출하면 안 된다. 이 문서 앞의 "가드 3단계"는 애플리케이션이 쓰기를 막는 방어선이고, 이 노출 범위 제한과
읽기 전용 DB 계정이 실제로 신뢰하는 경계다.

## 의존성 설치 메모

루트 `package.json`의 `pnpm.onlyBuiltDependencies`에는 `oracledb`가 없다 — 의도적이다. thin 모드는 순수 JS라
네이티브 빌드 스크립트가 필요 없고, `pnpm install`이 "ignored build scripts" 경고를 내는 것도 정상이다.
나중에 thick 모드(Instant Client 바이너리)가 필요해져 `oracledb`를 그 목록에 추가하면 설치 때마다 바이너리를
받기 시작하므로, 이 패키지가 thin 모드를 전제하는 한 추가하지 않는다.

## 통합 테스트 (`ORACLE_IT=1`)

기본 `pnpm --filter @daport/oracle test`(`vitest.config.ts`)는 `src/__it__/**`를 제외하므로 컨테이너 Oracle
없이 항상 돈다. 컨테이너 Oracle Free(gvenzl/oracle-free)에 실제로 붙는 통합 테스트는 별도 설정
(`vitest.it.config.ts`)과 스크립트(`test:it`)로만 돈다.

Docker Desktop이 없는 macOS 환경(Colima)에서의 절차:

```bash
brew install colima docker
colima start --cpu 4 --memory 6
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
export NODE_OPTIONS=--dns-result-order=ipv4first
ORACLE_IT=1 pnpm --filter @daport/oracle test:it
```

첫 실행은 `gvenzl/oracle-free:23.26.3-slim-faststart` 이미지(약 1.2GB)를 받는다. 이후 실행은 이미지가
캐시되어 있으면 컨테이너 기동 시간만 든다.

### 이번 구현에서 실행한 결과

- **일시**: 2026-09-18
- **환경**: macOS(darwin), Docker Desktop 없음 → Colima 0.10.1(Docker 29.3.0, `vz` 드라이버, `--cpu 4 --memory 6`)로
  대체. `@testcontainers/oraclefree@11.14.0` 실치 버전은 브리프가 가정한 `OracleFreeContainer`/
  `StartedOracleFreeContainer`가 아니라 `OracleDbContainer`/`StartedOracleDbContainer`로 이름이 바뀌어 있어
  `src/__it__/direct.it.test.ts`의 import를 그에 맞춰 수정했다(동작·검증 내용은 브리프와 동일).
- **기본 스위트**: `pnpm --filter @daport/oracle test` — 5 files / 17 tests 통과, `__it__`는 수집되지 않음(확인 완료).
- **통합 스위트**: `ORACLE_IT=1 pnpm --filter @daport/oracle test:it` — **1 file / 4 tests 모두 통과** (소요 약 154초,
  컨테이너 기동 포함). 타입 변환(DATE/TIMESTAMP/TZ/NUMBER/CLOB/NULL), 이름 바인드, 가드에 의한 쓰기·행 잠금
  거부, 행 수 제한(`TOO_MANY_ROWS`), 타임아웃(`TIMEOUT`), `ping`, 미지원 컬럼 타입 오류까지 전부 실제
  Oracle Free 23.26 컨테이너를 상대로 검증됨.
