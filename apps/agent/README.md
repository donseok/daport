# daport agent

공장 안 사내망에서만 Oracle 리스너에 접근할 수 있는 환경을 위한 중계 서버(4b 스펙 6장). studio가 Oracle을
직접 열 수 없을 때, 이 프로세스가 사내망 쪽에서 대신 `oracledb`(thin 모드)로 붙어 studio의 요청을
대신 실행하고 결과를 돌려준다. `@daport/oracle`의 `createAgentConnector`가 이 서버의 클라이언트다.

## 목적

- studio ↔ Oracle 사이에 네트워크 경계가 있을 때(VPN·방화벽 등), 그 경계의 Oracle 쪽에 이 에이전트를 띄운다.
- 요청·응답 형식은 direct 커넥터와 동일한 `SqlConnector` 인터페이스를 따른다 — studio 입장에서 `via: "direct"`와
  `via: "agent"`는 커넥터 선택만 다르고 나머지 계약은 같다.
- 가드(`guardSql`)·`SET TRANSACTION READ ONLY`·읽기 전용 DB 계정, 3단계 읽기 전용 보장은 여기서도 그대로 적용된다
  (`packages/oracle/README.md`의 "가드 3단계" 참고).

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `AGENT_TOKEN` | 예 | — | 32자 이상. `POST /query`, `GET /health` 모두 `Authorization: Bearer <token>`으로 검사한다(상수 시간 비교). 32자 미만이면 기동을 거부한다. |
| `AGENT_PORT` | 아니오 | `8433` | 리슨 포트. 양의 정수가 아니면(빈 문자열, 비숫자, 0 이하) 기본값으로 대체한다. |
| `AGENT_MAX_CONCURRENCY` | 아니오 | `8` | 동시 처리 상한. 넘는 요청은 429 `BUSY`. 마찬가지로 잘못된 값은 기본값으로 대체한다(빈 문자열이 그대로 새면 상한이 사라진다). |
| `ORACLE_HOST` | 예(`AGENT_FAKE`가 아니면) | — | Oracle 리스너 호스트. |
| `ORACLE_PORT` | 아니오 | `1521` | Oracle 리스너 포트. 정수 검증은 `AGENT_PORT`와 같다. |
| `ORACLE_SERVICE` | 예(〃) | — | Oracle 서비스 이름. |
| `ORACLE_USER` | 예(〃) | — | **SELECT 권한만 있는** 읽기 전용 계정이어야 한다. |
| `ORACLE_PASSWORD` | 예(〃) | — | 비밀번호. 로그·오류 메시지에서 항상 마스킹된다(`sanitizeError`). |
| `AGENT_TLS_CERT` / `AGENT_TLS_KEY` | 아니오 | — | 둘 다 있으면 HTTPS로, 둘 중 하나라도 없으면 평문 HTTP로 리슨한다. 파일 경로. |
| `AGENT_FAKE` | 아니오 | — | `"1"`이면 `FakeSqlConnector`(고정 결과)로 뜬다. 실제 Oracle 없이 테스트·E2E·이 문서의 smoke에 쓴다. `ORACLE_*`가 전혀 필요 없다. |

## 배포

```bash
# 1. 빌드 — oracledb는 external. 산출물은 dist/agent.mjs(단일 번들)와 dist/package.json
pnpm --filter agent build

# 2. dist/를 배포 대상으로 복사
cp -r apps/agent/dist /path/to/deploy/daport-agent
cd /path/to/deploy/daport-agent

# 3. dist/package.json이 선언한 의존성(oracledb)만 설치 — 개발 의존성 없이 프로덕션 설치
pnpm install --prod

# 4. 실행
AGENT_TOKEN=<32자 이상> ORACLE_HOST=... ORACLE_SERVICE=... ORACLE_USER=... ORACLE_PASSWORD=... node agent.mjs
```

`dist/` 산출물만으로는 뜨지 않는다 — `oracledb`가 esbuild external이라 `node_modules`에 실제로 있어야
`ORACLE_HOST` 등을 쓰는 실제 경로가 동작한다(`AGENT_FAKE=1`인 동안은 `oracledb`를 아예 로드하지 않으므로
필요 없다). 위 3단계 `pnpm install --prod`가 그래서 필요하다.

## 엔드포인트

- `GET /health` — `Authorization: Bearer <token>` 필요. 커넥터 `ping()`이 성공하면 200 `{ ok: true, version }`,
  실패하면 503 `{ ok: false, error: { code, message } }`.
- `POST /query` — 본문 `{ sql, binds?, timeoutMs?, maxRows? }`(JSON, 최대 1MB, 초과 시 413). `guardSql`을 통과한
  단일 SELECT/WITH만 허용(그 외 400 `SQL_NOT_ALLOWED`). `timeoutMs`/`maxRows`는 `DEFAULT_LIMITS`(30s/10,000행)로
  클램프된다. 응답은 200 `{ rows, columns }`. 실패는 `DatasetErrorCode`별 상태(§8)로 매핑되며 SQL·바인드·토큰은
  절대 로그에 남기지 않는다(접근 로그는 메서드/경로/상태/소요시간/행 수 한 줄뿐).
- 그 외 경로 → 404 `NOT_FOUND`. 토큰이 없거나 틀리면 어떤 경로든 401 `UNAUTHORIZED`(존재 여부를 드러내지 않는다).
- `AGENT_MAX_CONCURRENCY`를 넘는 동시 `/query`는 429 `BUSY`.

## 종료

`SIGTERM`/`SIGINT`를 받으면 새 연결을 그만 받고(`server.close`), 곧바로 열려 있는 연결을 모두 강제로 끊은 뒤
(`server.closeAllConnections`) 커넥터를 닫고 종료한다. keep-alive 연결이 남아 `close()` 콜백이 영원히 안 불리는
경우에 대비해 5초 뒤에도 안 끝나면 강제로 `process.exit(0)`한다(`src/config.ts`의 `shutdown`).

## 검증

**빌드**

```
$ pnpm --filter agent build
> agent@0.0.1 build /Users/jerry/daport/apps/agent
> node scripts/build.mjs

built dist/agent.mjs
```

`apps/agent/dist/agent.mjs`(약 862KB, `oracledb` external)와 `apps/agent/dist/package.json`이 생성됨을 확인.

**smoke (2026-09-18, `AGENT_FAKE=1`로 dist에서 직접 기동)**

```bash
cd apps/agent/dist
AGENT_FAKE=1 AGENT_TOKEN=<32자 이상> AGENT_PORT=8499 node agent.mjs &
curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer <token>" localhost:8499/health
# → 200
```

실제 실행 로그:

```
daport agent 0.0.1 listening on http://0.0.0.0:8499 (fake)
2026-09-18T04:57:46.689Z GET /health 200 3ms rows=0
```

`GET /health` 응답 본문: `{"ok":true,"version":"0.0.1"}` (HTTP 200). 확인 후 프로세스를 종료했다
(`AGENT_FAKE=1`이라 `oracledb`는 로드되지 않았다 — 실제 Oracle 배포에서는 위 "배포" 절의 3단계
`pnpm install --prod`가 반드시 먼저 필요하다).
