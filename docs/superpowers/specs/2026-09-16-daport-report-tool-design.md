# daport 레포트 개발툴 설계 스펙

작성일: 2026-09-16
상태: 승인 대기

## 1. 목적

MES 재구축 프로젝트에서 사용할 웹 기반 레포트 개발툴을 독자적으로 만든다. 품질보증서, 검사증명서, Tag, 라벨, 출하 송장, 출하지시서 6종을 이 툴로 제작하고, MES에 배포해 출력한다.

## 2. 확정된 전제

| 항목 | 결정 |
|---|---|
| MES 기술 스택 | 미정. 이 툴에 맞춰 정한다. TypeScript 단일 언어, React 프론트, Node 백엔드를 기본 가정 |
| 출력 장치 | 문서 4종은 PDF/브라우저 인쇄. Tag·라벨은 열전사 라벨프린터(ZPL/TSPL). 기종 미정 |
| 사용자 | 처음엔 개발자 1인. 이후 개발팀과 현업(품질·출하 담당)으로 확장 |
| 데이터베이스 | Oracle. `oracledb` thin 모드 사용 |
| 운영 환경 | 클라우드(Vercel). 외부 LLM API 호출 가능 |
| MES 연동 | 공유 저장소 + 렌더 API가 기본. 번들 내보내기/가져오기도 지원 |
| AI 이미지 기능 | 기존 종이 양식 스캔 → 편집 가능한 컴포넌트 변환이 핵심. 이미지 파일 삽입은 부가 |
| 레포트 모델 | 하이브리드: 자유 캔버스(mm 절대좌표) + 표 컴포넌트의 넘침 규칙 |

## 3. 전체 구조

pnpm 모노레포. 화살표는 의존 방향이다.

```
packages/
  core        레포트 JSON 스키마(zod), 표현식 엔진, 단위 변환(mm/pt/px)
  renderer    core 모델 + 데이터 → 레이아웃 → React 트리. 페이지네이션 포함
  pdf         renderer 출력 → Playwright(Chromium) → PDF
  label       renderer 출력 → 비트맵 → ZPL/TSPL
  datasource  Oracle 커넥터, 데이터셋 실행, 샘플 스냅샷
  ai          Claude API 호출: 자연어→모델 패치, 이미지→모델
apps/
  studio      Next.js App Router. 디자이너 UI + API 라우트(저장소, 렌더, 배포)
```

의존 규칙:

- `core`는 아무것도 의존하지 않는다.
- `renderer`는 `core`만 의존한다.
- `pdf`, `label`은 `renderer`만 의존한다.
- `ai`는 `core`만 의존한다. 모델을 만들 뿐 렌더하거나 DB에 접근하지 않는다.
- `studio`가 전부를 조립한다.
- MES는 `core`, `renderer`(필요 시 `pdf`, `label`)만 npm으로 가져가고, 레포트 정의는 studio API에서 받는다.

핵심 원칙: **렌더러는 순수 함수**다. `(모델, 데이터) → 페이지 배열`. DB도 파일도 만지지 않는다. MES, 테스트, AI 검증 루프에서 동일하게 동작한다.

데이터 흐름(미리보기 기준):

```
Oracle ──datasource──▶ 데이터(JSON)
                              │
studio 에디터 ──▶ 레포트 모델(JSON) ──▶ renderer ──▶ HTML(브라우저 즉시 표시)
                                                   ├──▶ pdf ──▶ PDF
                                                   └──▶ label ──▶ ZPL/TSPL
```

## 4. 레포트 정의 모델 (core)

파일 하나가 레포트 하나다(`quality-cert.report.json`). 스키마는 zod로 정의하고 TypeScript 타입을 거기서 뽑는다. AI가 만든 모델도, 손으로 쓴 JSON도 같은 검증기를 통과해야 렌더러에 들어간다.

### 4.1 최상위 구조

```jsonc
{
  "id": "quality-cert",
  "version": 3,
  "page": { "width": 210, "height": 297, "margin": [10, 10, 10, 10], "unit": "mm" },
  "datasets": [
    { "name": "order", "type": "sql", "connection": "mes", "query": "SELECT ... WHERE ORDER_NO = :orderNo" },
    { "name": "items", "type": "sql", "connection": "mes", "query": "SELECT ... WHERE ORDER_NO = :orderNo" }
  ],
  "params": [{ "name": "orderNo", "type": "string", "required": true }],
  "elements": [ /* 4.2 */ ]
}
```

- `page.unit`은 항상 `mm`. 다른 단위 입력은 core의 변환 함수로 mm로 정규화한다.
- 가로/세로는 `width`와 `height`의 크기 관계로 결정한다. 별도 orientation 필드는 두지 않는다.
- Tag는 `{ "width": 60, "height": 40 }`처럼 자유 지정한다.

### 4.2 요소 타입

모든 요소는 `id`, `type`, `x`, `y`, `w`, `h`(mm), 선택적 `visible`(표현식), `flow`, `style`을 가진다.

| type | 용도 | 주요 속성 |
|---|---|---|
| `text` | 정적/바인딩 텍스트 | `value`(표현식 포함 문자열), `style.fontSize/bold/align/wrap` |
| `image` | 로고·도장·서명 | `src`(`asset://id` 또는 표현식), `fit`(contain/cover/stretch) |
| `line` | 선 | `x2`, `y2`, `style.stroke/width` |
| `rect` | 사각형·테두리·배경 | `style.stroke/fill/radius` |
| `barcode` | 1D/QR | `format`(code128/ean13/qr), `value`, `showText` |
| `table` | 반복 표 | `source`, `columns[]`, `repeatHeader`, `overflow`, `keepTogether`, `footer[]`, `continuationPage` |
| `group` | 요소 묶음 | `children[]`. 좌표는 그룹 기준 상대 |
| `ref` | 재사용 컴포넌트 참조 | `ref`(컴포넌트 id), `props` |
| `pageNumber` | 페이지 번호 | `format`("{{page}} / {{total}}") |

`flow` 값:

- `"once"`(기본): 첫 페이지에만 그린다.
- `"every"`: 표 넘침으로 생긴 모든 연속 페이지에 반복한다.
- `"last"`: 마지막 페이지에만 그린다.

### 4.3 표현식

직접 만들지 않고 샌드박스 표현식 라이브러리(jexl 계열)를 쓴다. 문자열 안에서 `{{ ... }}`로 감싼 부분만 평가한다.

허용: 필드 접근(`order.CUSTOMER_NAME`, `row.QTY`), 산술, 비교, 논리, 삼항, 등록 함수.

등록 함수 초기 세트: `sum(dataset, field)`, `count(dataset)`, `formatDate(value, pattern)`, `formatNumber(value, pattern)`, `pad(value, len, char)`, `upper`, `lower`, `default(value, fallback)`.

금지: 자바스크립트 실행, 프로토타입·전역 객체 접근. 위반 시 요소 단위로 `#ERR` 처리한다(8장).

컨텍스트 변수: `params`, 각 데이터셋 이름(첫 행 객체와 배열 둘 다 접근 가능), `row`(표 안에서 현재 행), `page`, `total`.

### 4.4 재사용 컴포넌트

별도 파일(`components/company-header.component.json`)로 둔다. 구조는 `group`과 같고 `props` 선언을 추가로 가진다. 레포트에서 `{ "type": "ref", "ref": "company-header", "props": { "title": "품질보증서" } }`로 참조한다. 렌더 시 인라인 확장된다.

## 5. 렌더링 엔진 (renderer, pdf, label)

### 5.1 두 단계 분리

**레이아웃** `layout(model, data): Page[]`. 순수 계산이며 DOM이 없다. 표현식을 평가하고, 표를 행 단위로 측정해 페이지에 나눠 담는다. 결과는 페이지별 절대 배치 목록이다.

```ts
type Page = { index: number; width: number; height: number; items: PlacedItem[] }
type PlacedItem = { elementId: string; x: number; y: number; w: number; h: number; payload: ... }
```

텍스트 높이는 폰트 메트릭 기반으로 직접 계산한다. 브라우저 DOM 측정에 기대지 않는다. 서버 PDF와 브라우저 미리보기가 같은 결과를 내야 하기 때문이다.

**페인트** `paint(pages): ReactElement`. 배치 목록을 mm 단위 절대 위치 `div`로 그린다. 판단 로직이 없다. CSS `@page { size: <w>mm <h>mm }`를 페이지 크기에서 생성한다.

### 5.2 표 넘침 규칙

- 표는 `x, y, w, h` 영역 안에 행을 채우다 넘치면 다음 페이지를 만든다.
- 다음 페이지 구성은 `continuationPage`를 따른다. 미지정이면 같은 페이지 템플릿에서 `flow: "once"` 요소를 빼고 `flow: "every"` 요소를 반복한다. 표는 원래 `x, y, w`를 유지하고 높이는 페이지 하단 여백까지 쓴다.
- `repeatHeader: true`면 헤더 행을 매 페이지 반복한다.
- `keepTogether: "row"`면 행 하나가 페이지 경계에서 쪼개지지 않는다.
- `footer[]`는 마지막 페이지에만 그린다. `pageFooter[]`가 있으면 매 페이지 하단에 소계를 그린다.
- 한 페이지에 표가 둘이면 각자 독립적으로 넘친다. 표끼리 수직으로 밀어내지 않는다. `pushDown`은 이후 단계에서 추가한다.

### 5.3 PDF

Playwright로 페인트 결과 HTML을 열고 `page.pdf()`로 뽑는다. 한글 폰트(Pretendard 또는 나눔고딕)를 패키지에 동봉해 서버와 브라우저에서 같은 파일을 쓴다. Chromium 인스턴스는 풀로 유지해 콜드스타트를 피한다.

### 5.4 라벨

같은 HTML을 Playwright 스크린샷으로 지정 DPI(203 또는 300)의 1비트 비트맵으로 굽고 ZPL `^GF` 또는 TSPL `BITMAP` 명령으로 감싼다. 기종 무관하게 먼저 찍히는 것이 목표다. 이후 `text`, `barcode` 요소를 네이티브 ZPL 명령으로 변환하는 최적화 경로를 열어둔다.

프린터 전송: studio API가 프린터 IP:9100으로 raw TCP 전송하거나, 브라우저 다운로드 후 로컬 유틸로 전송한다. 환경에 따라 선택한다.

### 5.5 성능 목표

- 레이아웃: 표 100행 기준 10ms 이내.
- 편집 중 미리보기: 디바운스 150ms로 재계산.
- PDF: 웜 인스턴스 기준 A4 1장 1초 이내.

## 6. 디자이너 앱 (studio)

Next.js App Router 하나에 UI와 API를 둔다.

### 6.1 화면 구성

```
┌──────────┬──────────────────────────────┬──────────────┐
│ 좌측 패널 │           캔버스              │  우측 패널    │
│ ─ 요소   │  mm 눈금자, 페이지 실제 비율    │ ─ 속성        │
│   팔레트 │  드래그/리사이즈/스냅/정렬      │ ─ 스타일      │
│ ─ 데이터 │  다중 선택, 그룹, 복사          │ ─ 바인딩      │
│   필드   │  실데이터 미리보기 토글         │ ─ 표 컬럼     │
│   트리   │                              │              │
│ ─ 컴포넌트│                              │              │
│   라이브러리                              │              │
├──────────┴──────────────────────────────┴──────────────┤
│ 하단: JSON 편집기 탭 / AI 채팅 탭 / 문제 목록 탭        │
└────────────────────────────────────────────────────────┘
```

### 6.2 개발자 편의 기능

- **캔버스 ↔ JSON 양방향 동기화**. 하단 Monaco 편집기에서 고치면 캔버스가 바뀌고, 캔버스에서 옮기면 JSON이 바뀐다. zod 스키마를 JSON Schema로 내보내 Monaco에 자동완성과 실시간 오류 표시를 준다.
- **데이터 필드 드래그 바인딩**. 데이터 트리의 필드를 캔버스로 끌면 바인딩된 텍스트 요소가 생긴다. 표 영역에 끌면 컬럼이 추가된다.
- **실데이터 미리보기**. 파라미터를 입력하면 실제 쿼리 결과로 렌더링한다. 디자인 모드는 첫 행 값을 표시하고, 미리보기 모드는 전체 페이지네이션을 보여준다.
- **페이지 프리셋**. A4·A3·Letter 가로/세로와 사용자 정의(Tag 60×40mm 등)를 저장해 재사용한다.
- **문제 목록**. 바인딩되지 않은 필드, 페이지 밖 요소, 없는 데이터셋 참조, 표현식 오류를 실시간으로 나열한다.
- **단축키**. 화살표 이동(0.5mm, Shift로 5mm), Cmd+D 복제, Cmd+G 그룹, Cmd+Z / Cmd+Shift+Z 되돌리기·다시하기.

### 6.3 상태 관리

편집 상태는 zustand 스토어 하나에 둔다. 모든 변경은 **모델 패치**(JSON Patch 형식)로 표현한다. 되돌리기는 패치 역적용이고, AI 제안도 같은 패치 형식이라 적용/거절/일부 적용이 자연스럽다.

### 6.4 저장소

레포트 정의는 Postgres(Neon)에 저장한다.

| 테이블 | 내용 |
|---|---|
| `reports` | id, name, draft(JSON), published_version_id, created/updated |
| `report_versions` | report_id, version, model(JSON, 불변), snapshot(샘플 데이터), published_at, published_by |
| `components` | id, name, model(JSON) |
| `assets` | id, name, blob_url, mime, size |
| `connections` | name, type(oracle), host, port, service, user, secret_ref |
| `api_keys` | key_hash, name, allowed_report_ids[] |
| `users` | id, email, role(admin/editor/viewer) |

로고·도장 등 에셋은 Vercel Blob에 올리고 `asset://id`로 참조한다.

**git 내보내기**: 레포트·컴포넌트·에셋·샘플 스냅샷을 JSON 파일 세트로 내려받거나 GitHub 레포에 커밋한다. 7.3의 번들 포맷과 동일하다. 개발자는 파일로, 현업은 DB로, 같은 내용을 다룬다.

### 6.5 인증

첫 버전은 단일 팀 가정으로 간단한 로그인(Clerk)만 둔다. `users.role`은 미리 잡아두고 권한 검사는 현업 확장 시 켠다.

## 7. 데이터 레이어 (datasource)

### 7.1 연결

Oracle 연결 정보는 `connections`에 등록하고 비밀번호는 환경변수 참조(`secret_ref`)로 둔다. `oracledb` thin 모드로 연결 풀을 유지한다. 레포트는 연결 **이름**만 참조한다. 개발 DB에서 만든 레포트를 운영 DB로 옮길 때 연결 이름만 같으면 된다.

### 7.2 데이터셋

레포트 `datasets[]`의 각 항목은 세 종류 중 하나다.

- `sql`: Oracle 쿼리. 바인드 변수(`:orderNo`)는 `params`와 이름으로 연결한다. 문자열 결합은 하지 않는다.
- `static`: JSON 배열을 레포트에 직접 둔다. 검사기준표처럼 안 바뀌는 데이터나 테스트용.
- `http`: MES API에서 JSON을 받는다. 1단계에서는 인터페이스만 둔다.

실행 제한: 타임아웃 30초, 행 수 상한 10,000. 초과 시 오류로 처리한다.

### 7.3 샘플 스냅샷

파라미터로 한 번 조회한 결과를 레포트별로 저장한다. 캔버스는 스냅샷으로 즉시 렌더링하고, "새로고침" 또는 미리보기 모드에서만 실쿼리를 실행한다. 스냅샷은 번들 내보내기에 포함되어 DB 없이도 렌더 테스트가 된다.

### 7.4 필드 스키마 추론

쿼리를 한 번 실행하면 컬럼 이름과 타입(string/number/date)을 추출해 데이터 트리에 보여준다. 타입별 기본 포맷터(날짜 `yyyy-MM-dd`, 숫자 천 단위 콤마)를 자동으로 붙인다.

### 7.5 렌더 API

```
POST /api/reports/:id/render
body: { params: {...}, format: "html" | "pdf" | "zpl" | "tspl", version?: number }
```

데이터셋 실행 → 렌더 → 출력을 한 번에 한다. `version` 미지정 시 `published_version`을 쓴다. MES가 호출하는 엔드포인트도 이것 하나다.

## 8. AI 어시스턴트 (ai)

AI는 **레포트 모델 JSON을 읽고 패치를 내놓는 역할**로 한정한다. 렌더링이나 DB 접근은 하지 않는다. AI 결과는 zod 검증을 거쳐 통과한 것만 캔버스에 "제안"으로 표시된다. 사용자 모델은 사용자가 적용을 누르기 전까지 절대 바뀌지 않는다.

### 8.1 자연어 편집

입력 컨텍스트: 현재 모델, 데이터 필드 목록, 컴포넌트 라이브러리 목록, 선택된 요소 id. 출력: JSON Patch 배열(구조화 출력). 캔버스에 점선으로 제안을 표시하고 적용/거절한다.

### 8.2 페이지 생성

빈 페이지에 전체 `elements[]`를 생성한다. 시스템 프롬프트에 컴포넌트 라이브러리 목록을 넣어 회사 표준 헤더·서명란을 우선 쓰게 한다.

### 8.3 이미지 → 컴포넌트 (기존 양식 이관)

1. 스캔 이미지나 PDF를 Claude 비전에 보내 페이지 크기 추정, 요소 목록(종류·좌표·텍스트·표 컬럼)을 구조화 출력으로 받는다. 좌표는 이미지 픽셀 비율을 페이지 mm로 환산한다.
2. 고정 텍스트(회사명, 항목명)는 정적 텍스트로, 값 자리(빈칸·밑줄·표 셀)는 바인딩 없는 텍스트 요소로 만들어 문제 목록에 "바인딩 필요"로 올린다.
3. 원본 이미지를 캔버스 배경에 반투명으로 깔아 위치를 맞춰볼 수 있게 한다.

목표는 80% 배치 후 손으로 마무리하는 것이다. 100% 정확도를 목표하지 않는다.

### 8.4 모델 선택

작업별로 설정 가능하게 둔다. 기본값: 편집·생성은 `claude-sonnet-5`, 이미지 분석은 `claude-fable-5-1`. Vercel AI Gateway를 통해 호출한다.

## 9. MES 연동 / 배포

### 9.1 버전과 배포

레포트는 편집 중 `draft`다. "배포"를 누르면 `report_versions`에 불변 스냅샷이 생기고 `reports.published_version_id`가 갱신된다. MES는 항상 배포된 버전을 받는다. 편집 중 내용은 운영 출력에 새지 않고, 문제가 생기면 이전 버전으로 되돌린다.

### 9.2 MES가 쓰는 두 가지 방식

1. **API 호출(기본)**. MES 서버가 7.5의 렌더 API를 파라미터와 함께 호출해 PDF/ZPL을 받는다. MES 코드에 렌더러가 들어가지 않고 studio가 렌더 서버 역할을 한다. 배포 즉시 반영된다.
2. **패키지 임베드**. MES 프론트가 `@daport/renderer`를 설치하고 `GET /api/reports/:id/published`로 모델 JSON을 받아 브라우저에서 직접 미리보기·인쇄한다. MES 화면 안에서 출력 전 확인이 필요할 때 쓴다.

### 9.3 번들 내보내기/가져오기

`daport-export.zip`에 레포트 JSON, 참조 컴포넌트, 에셋, 샘플 스냅샷, 연결 이름 목록을 담는다. 다른 studio 인스턴스에서 가져오면 연결 이름만 매핑한다. 6.4의 git 내보내기와 같은 포맷이라 하나로 구현한다.

### 9.4 인증

MES → studio API 호출은 `X-API-Key` 헤더로 한다. 키별로 허용 레포트를 제한한다(`api_keys.allowed_report_ids`).

## 10. 오류 처리

| 상황 | 처리 |
|---|---|
| 모델 검증 실패 | zod 오류를 경로와 함께 문제 목록에 표시. 캔버스는 마지막 유효 모델을 유지 |
| 표현식 오류 | 요소 단위로 격리. 해당 요소만 빨간 테두리에 `#ERR` 표시. 운영 렌더는 레포트 설정 `onExpressionError: "blank" \| "fail"`(기본 `blank`)을 따름 |
| 데이터셋 실패 | 쿼리 오류는 400, 타임아웃은 504로 원인을 반환. 디자이너는 스냅샷으로 계속 동작 |
| PDF 실패 | Chromium 크래시는 1회 재시도 후 500 |
| 프린터 전송 실패 | ZPL/TSPL 파일을 다운로드 가능하게 폴백 |
| AI 실패 | 검증 통과 못 한 패치는 폐기하고 원문 응답을 채팅에 표시. 사용자 모델은 변경되지 않음 |

## 11. 테스트

- `core`: 스키마·표현식 단위 테스트. 프로토타입 접근 등 악의적 표현식 차단 테스트 포함.
- `renderer`: **골든 테스트**. 레포트 JSON + 샘플 데이터 → 레이아웃 결과(JSON)를 스냅샷으로 저장. 표 넘침·페이지 반복 규칙을 여기서 검증한다. DOM 없이 돌아 빠르다.
- `pdf`, `label`: 픽셀 비교 테스트 소수. PDF를 이미지로 뽑아 기준 이미지와 비교.
- `studio`: 드래그 배치 → JSON 반영 → 되돌리기 같은 핵심 흐름만 Playwright E2E.
- 6종 양식을 각각 골든 테스트 픽스처로 만들어 회귀 검증 기준으로 삼는다.

## 12. 단계별 범위

각 단계가 독립 스펙·플랜이 된다. 이 문서는 전체 아키텍처와 1단계 상세를 담는다. 2단계부터는 각각 짧은 스펙을 따로 쓴다.

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | core + renderer + static 데이터셋 + 최소 studio(캔버스·속성·JSON 편집기) + PDF | 품질보증서 한 장이 브라우저와 PDF로 동일하게 나옴 |
| 2 | 표 넘침 + Oracle 데이터셋 + 샘플 스냅샷 + 데이터 트리 | 검사증명서·송장·출하지시서 완성 |
| 3 | 라벨(ZPL/TSPL 비트맵) + 페이지 프리셋 + 컴포넌트 라이브러리 | Tag·라벨 완성. 6종 전부 |
| 4 | 버전/배포 + 렌더 API + API 키 + 번들 내보내기/가져오기 | MES 연동 가능 |
| 5 | AI 자연어 편집·페이지 생성 | |
| 6 | AI 이미지 → 컴포넌트 | 기존 양식 이관 |

## 13. 1단계 상세

### 13.1 범위에 포함

- 모노레포 골격: pnpm workspaces, TypeScript, vitest, `core`·`renderer`·`pdf` 패키지, `studio` 앱.
- `core`: 4장의 스키마 중 `text`, `image`, `line`, `rect`, `group` 요소. `table`, `barcode`, `ref`, `pageNumber`는 타입만 선언하고 렌더는 2·3단계. 표현식 엔진과 등록 함수 전체. `static` 데이터셋만 실행.
- `renderer`: 레이아웃(단일 페이지, 표 넘침 없음) + 페인트. 텍스트 줄바꿈과 높이 계산.
- `pdf`: Playwright 기반 PDF 생성. 한글 폰트 동봉.
- `studio`: 로그인 없음. 레포트 목록, 캔버스(드래그·리사이즈·스냅·다중 선택), 속성 패널, JSON 편집기(Monaco, 양방향 동기화), 되돌리기, 미리보기, PDF 다운로드. 저장소는 Neon Postgres의 `reports` 테이블만. 에셋은 Vercel Blob.
- 골든 테스트 픽스처: 품질보증서 1종.

### 13.2 범위에서 제외

- Oracle 연결, 데이터 트리, 샘플 스냅샷(2단계).
- 표 넘침, 바코드, 라벨, 페이지 프리셋 UI, 컴포넌트 라이브러리(2·3단계).
- 버전·배포·API 키·번들(4단계).
- AI 전부(5·6단계).
- 인증·역할(현업 확장 시).

### 13.3 1단계 완료 기준

1. 품질보증서 레포트 JSON을 studio에서 열어 캔버스로 편집하고 저장할 수 있다.
2. JSON 편집기에서 좌표를 바꾸면 캔버스가 즉시 반영되고, 캔버스에서 옮기면 JSON이 바뀐다.
3. 미리보기 HTML과 다운로드한 PDF가 같은 배치를 보인다(픽셀 비교 테스트 통과).
4. `renderer` 골든 테스트와 `core` 단위 테스트가 CI에서 통과한다.
5. A4 세로·가로, 60×40mm Tag 크기로 각각 빈 레포트를 만들어 PDF가 해당 크기로 나온다.

## 14. 기술 선택 요약

| 영역 | 선택 |
|---|---|
| 언어/패키지 | TypeScript, pnpm workspaces |
| 프론트 | Next.js App Router, React, zustand, Monaco, shadcn/ui |
| 스키마 | zod (JSON Schema 내보내기 포함) |
| 표현식 | jexl 계열 샌드박스 라이브러리 |
| PDF/라벨 래스터 | Playwright (Chromium) |
| DB(툴 자체) | Neon Postgres |
| DB(MES 데이터) | Oracle, `oracledb` thin 모드 |
| 에셋 | Vercel Blob |
| AI | Vercel AI Gateway 경유 Claude |
| 테스트 | vitest, Playwright |
| 배포 | Vercel |
