# Oracle 연결·테스트 환경 조사 (2026-09-17)

2단계 설계 중 Oracle 단계를 대비해 조사한 내용이다. 각 주장은 별도 에이전트가 1차 출처로 반박 검증했고, 반박된 부분은 정정해 적었다. 드라이버(node-oracledb) 세부 조사는 실패해 이 문서에 없다. Oracle 단계 시작 시 다시 조사한다.

## 1. 클라우드(Vercel)에서 공장 내부 Oracle 접속

권장: **공장 안 중계 에이전트**를 기본으로, Vercel Static IPs + 방화벽 허용 목록을 대안으로 둔다.

- Vercel 기본 아웃바운드 IP는 동적 범위다. Static IPs는 Pro/Enterprise에서 프로젝트당 월 $100이며 소수 고객이 공유하는 VPC다.
- Secure Compute·VPN 경로는 Enterprise 계약이 필요하다. PrivateLink로 온프레미스에 닿는 구성은 Vercel이 공식 지원한다고 보기 어렵다.
- 에이전트 방식의 장점: Oracle 리스너를 인터넷에 열지 않는다. DB 자격 증명이 공장 밖으로 나가지 않는다. thin 모드 제약(12.1 이상, Native Network Encryption 미지원)이 있어도 에이전트만 thick 모드로 바꾸면 된다.
- 원시 SQL*Net(1521)을 Cloudflare Tunnel로 Vercel에서 쓰는 것은 비현실적이다. HTTP로 말하는 중계가 맞다.
- `SET TRANSACTION READ ONLY`는 DML은 막지만 LOCK TABLE, ALTER SESSION 등은 허용한다. 읽기 전용 DB 계정과 단일 SELECT/WITH 문 검사가 1차 방어이고, 읽기 전용 트랜잭션은 보조 방어다.

설계에 주는 요구:

1. SQL 실행 인터페이스의 입력·출력은 **순수 JSON**이어야 한다(날짜는 ISO 8601 문자열). 그래야 직접 연결 구현과 에이전트 구현이 같은 인터페이스를 쓴다.
2. 전송 방식은 데이터셋이 아니라 **연결(connection) 설정**에 둔다: `via: "direct" | "agent"`. 레포트는 연결 이름만 참조한다.
3. 가드(바인드만 허용, 단일 SELECT/WITH, 타임아웃, 최대 행)는 양쪽이 함께 쓰는 공용 모듈에 둔다.

확인이 필요한 질문: MES Oracle 버전과 에디션, Native Network Encryption 강제 여부, 공장 IT가 아웃바운드 터널이나 DMZ 역방향 프록시를 허용하는지, 에이전트를 돌릴 사내 호스트, Vercel 플랜.

## 2. Docker 없는 Apple Silicon Mac에서 Oracle 테스트

- `gvenzl/oracle-free`는 23.5부터 arm64 네이티브 멀티 아키텍처다. 최신은 Oracle AI Database 26ai Free(23.26.x). 자동 테스트에는 `slim-faststart` 태그, 재현성을 위해 `23.26.3-slim-faststart`처럼 고정한다. arm64 압축 크기 약 1.2GB.
- Free 에디션 제한: CPU 2코어, RAM 2GB, 사용자 데이터 12GB, 논리 환경(VM·컨테이너·호스트)당 한 설치.
- 런타임: Colima(MIT) + docker CLI가 상업 사용 무료이고 가장 무난하다. `brew install colima docker docker-compose` 후 `colima start --cpu 4 --memory 6`. Docker Desktop은 직원 250명 미만이면서 매출 1천만 달러 미만일 때만 무료. OrbStack은 업무용 유료. Podman 6은 macOS에서 거친 부분이 남아 있다.
- 테스트: `@testcontainers/oraclefree`(`@testcontainers/oracledb`는 존재하지 않음). Colima에서는 `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`, `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`, `NODE_OPTIONS=--dns-result-order=ipv4first`. 테스트 실행당 컨테이너 하나(vitest globalSetup), `ORACLE_IT=1` 같은 환경변수로 선택 실행.
- CI: GitHub Actions 서비스 컨테이너로 같은 이미지를 띄우고 `--health-cmd healthcheck.sh --health-interval 10s --health-retries 20` 정도로 준비를 기다린다.
- 대안: OCI Always Free Autonomous Database(세션 30, 7일 미사용 시 자동 정지, TLS 연결).
