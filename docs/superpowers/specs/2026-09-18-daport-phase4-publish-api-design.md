# daport 4단계 설계 스펙: 버전·배포, 렌더 API, API 키, 번들

작성일: 2026-09-18
상태: 승인됨
상위 스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` (12장 로드맵 4단계, 6.4·7.5·9장)
이전 단계: `docs/superpowers/specs/2026-09-17-daport-phase3b-components-design.md`

## 1. 목적

MES가 daport를 쓸 수 있게 한다. 레포트를 불변 버전으로 배포하고, MES 서버가 API 키로 배포된 버전을 호출해 HTML·PDF·ZPL·TSPL을 받으며, 편집 중인 draft는 재배포 전까지 운영 출력에 새지 않는다. 레포트와 에셋을 zip 번들로 다른 studio 인스턴스에 옮길 수 있다. 1단계부터 두 번 이월된 "서버 Chromium 외부 요청 허용 목록"을 렌더 API가 외부에 열리는 이 단계에서 마무리한다.

사용자 로그인·역할, Oracle 커넥터, AI 기능은 범위 밖이다(11장).

## 2. 원칙과 확정된 결정

| 항목 | 결정 |
|---|---|
| 범위 | 로드맵 4단계 네 항목(버전·배포, 렌더 API, API 키, 번들)만. Oracle 커넥터는 별도 4b 스펙 |
| 배포 모델 | 포인터 이동. 배포 = draft를 불변 버전 N으로 저장하고 `published_version`을 N으로. 되돌리기 = 포인터만 옛 버전으로(새 버전을 만들지 않고 draft도 건드리지 않음) |
| 렌더 경로 | studio 내부(pdf·label·preview)와 MES용 render가 같은 `renderReport` 함수를 쓴다. 렌더 API는 배포 버전(또는 지정 버전)만 보고 draft는 절대 읽지 않는다 |
| API 키 | DB 테이블 + CLI 스크립트로만 발급·회수. 웹에서 키를 만드는 경로가 없어 로그인 없는 현재 구조에서도 안전. studio 화면은 읽기 전용 목록만 |
| 인증 범위 | `X-API-Key`는 render·published(·CORS preflight)에만 요구. studio 내부 라우트는 지금처럼 무인증(동일 출처) |
| 번들 | `daport-export.zip`(`fflate`). 같은 레포트 id를 가져오면 draft를 덮지 않고 새 버전으로 추가(배포 안 함), 없으면 새 레포트. git 내보내기는 같은 트리를 폴더로 둔 것이라 포맷은 하나 |
| 외부 요청 | `withPage`가 자기 origin·로컬 폰트·`data:` 외의 호스트는 `DAPORT_RENDER_ALLOW`에 있을 때만 통과시킨다. pdf·label 공통 |
| 순수성 | core·renderer 변화는 모델 해시 함수뿐. 저장소·인증·번들은 전부 studio |

## 3. 패키지 구조 변화

```
packages/
  core        + reportHash (정규 JSON SHA-256, 컴포넌트 해시와 같은 함수)
  browser     + withPage allowHosts (요청 가로채기)
  pdf, label  browser의 allowHosts를 studio가 넘겨준 대로 전달 (공개 API에 opts 추가, 기본값은 이전과 동일)
apps/studio   + report_versions·api_keys 테이블, 버전 저장소, API 키 저장소·CLI,
              + lib/render.ts(공통 렌더), render·published·publish·versions·export·import 라우트,
              + 툴바 배포 영역·버전 패널, 홈 배포 상태·내보내기·가져오기, /settings/keys
```

의존 방향은 그대로다. `browser`는 Playwright만 의존한다. 새 외부 의존은 `fflate`(studio)뿐이다.

## 4. 모델·저장소

### 4.1 `report_versions` 테이블

| 컬럼 | 내용 |
|---|---|
| `report_id` | `reports.id` 참조, 레포트를 지우면 함께 지워짐 (`onDelete: cascade`) |
| `version` | 정수, `(report_id, version)` 기본키 |
| `model` | jsonb. `parseReport`를 통과한 완전한 모델. `sample`·`components`가 모델 안에 있으므로 별도 스냅샷 컬럼은 없다 |
| `note` | text, 배포 메모(선택) |
| `created_at` | timestamptz |

`reports`에 `published_version integer`(null = 미배포)를 추가한다. 1단계에 만들어 두고 한 번도 쓰지 않은 `published_version_id`는 지운다.

버전 번호는 레포트별 `max(version) + 1`. 동시 배포로 유일성 위반(23505)이 나면 한 번 재시도한다.

### 4.2 배포 의미 (`ReportStore` 확장)

| 메서드 | 동작 |
|---|---|
| `publish(id, model, note?) → { version, createdAt }` | 컴포넌트 검사(`checkReportComponents`: 해시 불일치 409, 미등록은 경고)와 미사용 컴포넌트 정리를 거친 모델을 버전 N으로 저장하고 포인터를 N으로. `addVersion(id, model, note?)`도 같은 시그니처 — 라우트가 컴포넌트 검사를 마친 모델을 넘긴다 |
| `setPublished(id, version)` | 포인터만 이동. 없는 버전이면 `NotFoundError`. draft는 건드리지 않음 |
| `listVersions(id) → { versions: [{ version, createdAt, note, hash, published }], draftHash }` | `hash`는 4.4의 `reportHash(model)`. draft 해시와 비교해 "배포본과 다름" 표시에 쓴다 |
| `getVersion(id, version) → Report \| null` | 지정 버전 모델 |
| `getPublished(id) → { version, report } \| null` | 렌더 API가 쓰는 유일한 읽기 경로. 미배포면 null |

`MemoryReportStore`도 같은 인터페이스를 구현한다(dev·E2E). 기존 `get`(draft)·`update`는 바뀌지 않는다.

### 4.3 `api_keys` 테이블

| 컬럼 | 내용 |
|---|---|
| `id` | kid. 무작위 8자 `[a-z0-9]`, 기본키 |
| `name` | 표시 이름 |
| `key_hash` | 키 원문의 SHA-256 hex |
| `allowed_report_ids` | text[]. null = 전체 허용 |
| `created_at`, `revoked_at` | timestamptz. `revoked_at`이 있으면 회수됨 |

- 키 원문 형식 `dpk_<kid>_<32자 base64url>`. 요청이 오면 kid로 행을 찾고 해시를 상수 시간 비교(`crypto.timingSafeEqual`). 원문은 발급 시 한 번만 출력하고 저장하지 않는다.
- `ApiKeyStore { verify(rawKey) → { kid, name, allowedReportIds } | null; list(); create(name, allowed?) → { kid, rawKey }; revoke(kid) }`. `DbApiKeyStore`와 `MemoryApiKeyStore`.
- CLI `apps/studio/scripts/keys.ts` — `pnpm --filter studio keys create --name <이름> [--reports a,b]` / `keys list` / `keys revoke <kid>`. `DATABASE_URL`이 필요하다. `create`는 원문을 stdout에 한 번 출력한다.
- DB 없는 dev·E2E에서는 `DAPORT_DEV_API_KEY` 환경변수 하나를 전체 허용 키로 인정한다(`DATABASE_URL`이 없을 때만 읽는다).

### 4.4 모델 해시 (core)

`reportHash(report: Report): string` — `componentHash`와 같은 정규 JSON(키 정렬, 공백 없음) SHA-256. 같은 모델은 키 순서·공백과 무관하게 같은 해시다.

## 5. 렌더 API·인증

### 5.1 공통 렌더 함수 `apps/studio/src/lib/render.ts`

```ts
type RenderFormat = "html" | "pdf" | "zpl" | "tspl" | "png";
renderReport(report, { format, params, data?, props?, origin }) → { body: Buffer | string; mime: string; filename: string; pages?: number }
```

순서: 데이터셋 실행(`runDatasets`) → props 합치기 → `resolveAssetUrls(report, origin)` → 포맷별 출력.

| 포맷 | 출력 |
|---|---|
| `html` | `renderToHtml`. 폰트는 `${origin}/fonts/…` 절대 URL(studio가 `scripts/copy-fonts.mjs`로 이미 정적 복사) |
| `pdf` | `renderPdf` |
| `zpl` / `tspl` | `renderLabel`(요청 포맷이 `output.label.language`를 덮어씀) |
| `png` | 첫 페이지 비트맵 PNG(`rasterizePages` + `bitmapToPng`) |

요청 잘못은 `RenderRequestError(code, message)`로 던져 라우트가 400으로 만들고(`FORMAT_MISMATCH`, 데이터셋·파라미터·표현식·`LayoutLimitError`·`LabelTooLargeError`의 기존 코드는 유지), 나머지는 500. `withPage`에 넘길 허용 호스트는 `DAPORT_RENDER_ALLOW`와 자기 origin으로 만든다(5.6).

기존 pdf·label·preview 라우트는 이 함수를 쓰도록 바꾸되 요청·응답·상태 코드는 그대로다. 기존 라우트 테스트가 회귀 가드다.

### 5.2 `POST /api/reports/:id/render` (MES용)

- 인증: `X-API-Key` 필수. 없거나 틀리거나 회수됨 → 401, 키가 그 레포트를 허용하지 않음 → 403.
- 본문 `{ format: RenderFormat, params?, data?, version? }`. `report`·`props` 필드는 받지 않는다(서버에 저장된 모델만 렌더). 본문 한도 20MB(`readJsonBody`).
- 모델: `version` 지정 시 그 버전(없으면 404), 미지정 시 배포 버전(미배포면 404 `NOT_PUBLISHED`). draft는 절대 읽지 않는다.
- 포맷 규칙: `html`/`pdf`는 모든 레포트, `zpl`/`tspl`/`png`는 `output.kind === "label"`인 레포트만(아니면 400 `FORMAT_MISMATCH`).
- 응답: 본문 + `content-type` + `content-disposition`(pdf 라우트와 같은 RFC 5987 규칙) + `X-Daport-Version: N`. `maxDuration` 60.

### 5.3 `GET /api/reports/:id/published?version=` (임베드용)

같은 인증. 모델 JSON을 돌려주되 `asset://`는 `resolveAssetUrls`로 studio 절대 URL로 바꾼다(MES 프론트에는 에셋 저장소가 없다). `X-Daport-Version` 헤더. `version` 없으면 배포 버전, 미배포면 404 `NOT_PUBLISHED`.

### 5.4 studio 내부 라우트 (무인증, 동일 출처)

| 라우트 | 동작 |
|---|---|
| `POST /api/reports/:id/publish { note? }` | 4.2 `publish`. `{ version, createdAt }`. 컴포넌트 불일치 409 `COMPONENT_MISMATCH`, 경고는 `X-Daport-Warnings` |
| `GET /api/reports/:id/versions` | 4.2 `listVersions` |
| `PUT /api/reports/:id/published { version }` | 4.2 `setPublished`. 없는 버전 404 |
| `POST /api/reports/:id/preview` | 기존 라우트에 `version?` 본문 필드를 더한다. 있으면 그 버전 모델을, 없으면 지금처럼 본문의 `report` 또는 draft를 렌더 |

### 5.5 CORS

MES 프론트가 브라우저에서 `published`·`render`를 부르면 `X-API-Key` 때문에 preflight가 필요하다. `DAPORT_CORS_ORIGINS`(쉼표 목록)에 있는 origin에만 `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Headers: content-type, x-api-key`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Expose-Headers: x-daport-version, content-disposition, x-daport-pages`를 붙이고 `OPTIONS`에 204로 답한다. 목록에 없는 origin에는 헤더를 붙이지 않는다(브라우저가 막는다). 두 라우트에만 적용한다.

### 5.6 서버 Chromium 외부 요청 허용 목록 (browser)

`withPage(html, { …, allowHosts?: string[] }, fn)`. `allowHosts`가 주어지면 `context.route("**/*")`로 요청을 가로채:

- 통과: `data:`·`blob:`·`about:` URL, 폰트 서빙 경로(`serveFonts`가 등록한 것), `allowHosts`에 있는 호스트(포트까지 비교).
- 그 밖의 호스트는 `route.abort()`. 이미지는 빈 채로 렌더되고 서버 로그에 `blocked request: <host>` 경고를 한 줄 남긴다. 렌더는 실패하지 않는다.
- `allowHosts`를 넘기지 않으면 이전과 같이 가로채지 않는다(패키지 단독 사용 호환).

studio는 자기 origin 호스트 + `DAPORT_RENDER_ALLOW`(쉼표 목록, `host[:port]`)를 항상 넘긴다. 목록이 비어 있으면 외부 호스트 전부 차단이다. `pdf`·`label`의 공개 함수는 `opts?: { allowHosts?: string[] }`를 받아 그대로 전달한다.

## 6. 번들 내보내기·가져오기

### 6.1 포맷

`daport-export.zip`, `fflate`로 생성·해제.

```
manifest.json      { format: "daport-bundle", version: 1, exportedAt,
                     reports: [{ id, name, source: "draft" | { version } }],
                     connections: { sql: ["mes"], httpHosts: ["mes.example.com"] },
                     warnings: [] }
reports/<id>.json  완전한 모델 (components·sample이 모델 안에 있으므로 별도 파일 없음)
assets/<id>.<ext>  모델(본문·컴포넌트·ref 입력값·image 입력값 기본값)이 참조하는 asset://id 전부
assets.json        [{ id, name, mime, size }]
```

`connections`는 sql 데이터셋의 `connection` 이름과 http 데이터셋 URL의 호스트를 모은 점검 목록이다. 가져오는 쪽이 `DAPORT_HTTP_ALLOW`·SQL 연결을 맞췄는지 확인하는 용도다.

### 6.2 내보내기 — `POST /api/export { reports: [{ id, version? }] }` → zip

- `version` 없으면 draft, 있으면 그 배포 버전. 없는 레포트·버전은 404로 전체 거부(요청 오류).
- 참조 에셋은 Blob에서 받아 담는다. 없는 에셋은 `manifest.warnings`에 적고 계속. 에셋 저장소가 없으면(dev) 모델만 담는다.
- 응답 `application/zip`, `content-disposition: attachment; filename="daport-export-<날짜>.zip"`. studio 내부 라우트(무인증).

### 6.3 가져오기 — `POST /api/import` (multipart: `file`=zip, `connectionMap`=JSON, 선택)

- zip 20MB 한도. `connectionMap { "old": "new" }`는 sql 데이터셋의 `connection` 이름을 치환한다.
- 순서: manifest 검증 → 에셋 업로드(같은 id가 이미 있으면 건너뜀, 없으면 같은 id로 올려 `asset://id` 참조를 보존) → 레포트마다 `parseReport` + `checkReportComponents`.
- 충돌 정책: 같은 레포트 id가 **있으면** draft를 건드리지 않고 새 버전으로만 추가(배포 안 함, note = `가져옴: <zip 파일명>`). **없으면** 새 레포트를 draft로 만든다(버전 없음).
- 컴포넌트: 모델이 내용을 품으므로 라이브러리에 없는 버전은 경고만, 해시 불일치는 그 레포트만 건너뛰고(`skipped`, 사유 `COMPONENT_MISMATCH`) 나머지는 계속.
- 응답 `{ imported: [{ id, action: "created" | { version } }], skipped: [{ id, reason }], warnings }`. 레포트 단위 원자성, 전체 롤백 없음.

### 6.4 스튜디오

홈 화면 레포트 목록에 체크박스 + "내보내기" 버튼(선택한 레포트의 draft를 zip으로), "가져오기" 버튼(파일 선택 → 6.3 응답을 요약 표시). 컴포넌트 라이브러리 단독 내보내기는 범위 밖(레포트가 내용을 품는다).

## 7. 스튜디오 화면

### 7.1 툴바 배포 영역

- 상태 배지(`data-testid="publish-badge"`): "미배포" / "v3 배포됨" / "v3 배포됨 · 수정됨"(`draftHash !== 배포 버전 hash`). 저장되지 않은 편집이 있으면 배포 버튼 비활성(먼저 저장).
- "배포" 버튼(`data-testid="publish"`) → 메모 입력(선택) → `POST …/publish` → 배지 갱신. 409는 저장 때와 같은 문구.
- "버전" 버튼 → 버전 패널(`data-testid="versions-panel"`): 행마다 `v N · 날짜 · 메모 · [배포됨]`, "이 버전으로 배포"(확인 대화상자 → `PUT …/published`), "보기"(그 버전을 읽기 전용 미리보기 iframe으로 — 5.4의 `preview` `version` 인자). draft로 되돌려 넣는 기능은 두지 않는다.

### 7.2 홈 화면

- 레포트 목록에 배포 상태 열("v3" / "미배포" / "v3 · 수정됨").
- 체크박스 + "내보내기" + "가져오기"(6.4).
- "API 키" 링크 → `/settings/keys` 읽기 전용 페이지: 이름·kid·허용 레포트·발급일·회수일. 상단에 CLI 발급·회수 명령 안내. 키 원문은 어디에도 표시하지 않는다.

### 7.3 MES 연동 안내

버전 패널 하단 "연동" 접기: `POST {origin}/api/reports/{id}/render` curl 예시(키는 `<API_KEY>` 자리표시), `GET …/published` 예시. 화면에서 바로 복사할 수 있게 한다.

### 7.4 컴포넌트 편집 화면

변경 없음. 컴포넌트는 버전이 이미 있고 레포트 배포본이 내용을 품으므로 배포 개념을 따로 두지 않는다.

## 8. 오류 처리

| 상황 | 응답 |
|---|---|
| `X-API-Key` 없음·형식 오류·해시 불일치·회수됨 | 401 `{ code: "UNAUTHORIZED" }` (어느 경우인지 구분하지 않음) |
| 키가 그 레포트를 허용하지 않음 | 403 `{ code: "FORBIDDEN" }` |
| 레포트 없음 / 지정 버전 없음 | 404 |
| 미배포 레포트를 버전 없이 렌더·조회 | 404 `{ code: "NOT_PUBLISHED" }` |
| 포맷이 출력 종류와 안 맞음 | 400 `{ code: "FORMAT_MISMATCH" }` |
| 파라미터·데이터셋·표현식·페이지 상한·라벨 크기 | 기존 규칙 그대로 400(코드 유지) |
| 배포·가져오기 시 컴포넌트 해시 불일치 | 409 `COMPONENT_MISMATCH` (가져오기는 그 레포트만 `skipped`) |
| 번들 manifest 손상·포맷 버전 미지원 | 400 `{ code: "BUNDLE_INVALID" }` |
| 가져오기 레포트 단위 실패 | 그 레포트만 `skipped`, 응답은 200 |
| 차단된 외부 요청(5.6) | 렌더는 계속, 서버 로그 경고 |
| Chromium 크래시·프린터 전송 실패 | 기존대로 500 / 502 |

인증 실패 응답은 어떤 키였는지, 어떤 레포트가 있는지 드러내지 않는다(존재 여부는 인증 통과 후에만 404로 구분한다).

## 9. 테스트

- **core**: `reportHash`가 키 순서·공백에 불변, 다른 모델은 다른 해시.
- **studio 단위**
  - 버전 저장소(메모리): `publish`가 N+1을 만들고 포인터를 옮김, `setPublished`가 포인터만 옮기고 draft·버전을 바꾸지 않음, `listVersions`의 `hash`·`published`·`draftHash`, `getPublished`가 미배포면 null.
  - API 키: `create`가 낸 원문으로 `verify` 성공, 다른 원문·회수된 키 실패, `allowedReportIds` 판정, `DAPORT_DEV_API_KEY` 경로.
  - `renderReport`: 포맷 다섯 가지 분기, `FORMAT_MISMATCH`, html의 폰트 절대 URL.
  - render 라우트: 401/403/404/`NOT_PUBLISHED`, draft만 있는 레포트 → 404, `version` 지정, `X-Daport-Version` 헤더, `report`·`props` 필드 무시.
  - published 라우트: 에셋 절대 URL, 헤더.
  - CORS: 허용 origin에만 헤더, `OPTIONS` 204.
  - export: zip 안의 파일 목록·manifest·connections, 없는 에셋 경고.
  - import: 신규 생성 / 기존 id → 새 버전(포인터·draft 불변) / 해시 불일치 skip / `connectionMap` 치환 / 손상 zip 400.
  - 기존 pdf·label·preview·print 라우트 테스트 전부 통과(`renderReport` 리팩터링 회귀).
- **browser**: `withPage` 허용 목록 — 허용 호스트 통과, 나머지 abort와 경고 로그, `data:` 통과, `allowHosts` 없으면 가로채지 않음.
- **CLI**: `keys create`가 출력한 원문으로 render 라우트 인증 성공, `revoke` 후 401(메모리 저장소 주입).
- **E2E**: 예제 레포트 저장 → 배포(v1) → 편집·저장 → 배지 "수정됨" → 배포(v2) → 버전 패널에서 v1로 되돌리기 → `DAPORT_DEV_API_KEY`로 `POST …/render`(pdf)가 v1 내용(페이지 수·텍스트)으로 나옴 → 내보내기 zip → 가져오기(같은 id → v3 추가, 배포 포인터 그대로).

## 10. 완료 기준

1. MES 시뮬레이션: API 키 하나로 배포된 6종 예제를 `render`로 PDF/ZPL 받는다. draft 변경은 재배포 전까지 출력에 영향이 없다.
2. 되돌리기 후 렌더 API가 즉시 이전 버전을 낸다.
3. 키 회수 즉시 401.
4. 두 studio 인스턴스(dev 메모리 ↔ DB) 사이에 zip으로 레포트 + 에셋을 왕복해도 에셋 참조가 유지된다.
5. 외부 호스트 이미지가 허용 목록 없이는 렌더에 나오지 않는다.
6. 기존 단위·E2E 전부 통과.

## 11. 범위 밖 (이후 단계)

- 사용자 로그인·역할(studio 내부 라우트 인증), 배포 권한 분리.
- Oracle 커넥터·연결 관리 UI(4b 스펙), GitHub 레포 커밋 방식 git 내보내기.
- 렌더 API 호출 이력·요율 제한, 웹훅, 비동기 대량 렌더.
- 버전 간 diff 화면, 버전 삭제.
- 언어별 라벨 darkness·speed 범위(3단계 이월: TSPL DENSITY 0–15 클램프를 스키마·UI로 올리기), 컴포넌트 라이브러리 단독 번들.
- AI 편집·페이지 생성(5단계), 이미지 → 컴포넌트(6단계).
