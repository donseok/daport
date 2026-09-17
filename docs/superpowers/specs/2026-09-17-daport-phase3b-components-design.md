# daport 3b단계 설계 스펙: 컴포넌트 라이브러리

작성일: 2026-09-17
상태: 승인 대기
상위 스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` (12장 로드맵 3단계, 4.4장)
이전 단계: `docs/superpowers/specs/2026-09-17-daport-phase3-label-design.md` (11장에서 3b로 미룬 항목)

## 1. 목적

여러 레포트가 함께 쓰는 부분(회사 헤더, 결재란, 서명란, 표준 검사항목 표 등)을 **컴포넌트**로 라이브러리에 등록하고 레포트에 재사용한다. 컴포넌트는 버전을 가지며, 레포트는 고정된 버전으로 출력된다. 함께 요소 그룹화(Cmd+G)와 해제를 만든다.

## 2. 원칙과 확정된 결정

| 항목 | 결정 |
|---|---|
| 범용성 | 컴포넌트는 범용 기능이다. 예제 컴포넌트는 테스트 픽스처일 뿐이며 특정 양식 전용 코드를 만들지 않는다 |
| 갱신 방식 | **버전 고정 링크**. 레포트는 컴포넌트 id와 버전을 함께 참조한다. 컴포넌트를 고치면 새 버전이 생기고 기존 레포트는 원래 버전으로 출력된다. 레포트별 업데이트와 모든 레포트 일괄 적용을 제공한다 |
| 차이 두기 | 컴포넌트가 입력값(props)을 선언하고, 인스턴스마다 값을 넣는다. 입력값은 템플릿이라 레포트 데이터를 넣을 수 있다 |
| 담을 수 있는 요소 | ref를 뺀 모든 요소(페이지를 넘기는 표·반복 영역 포함). **중첩 컴포넌트는 금지**(이후 스키마 변경 없이 허용 가능) |
| 만들기·편집 | 캔버스 선택 영역을 컴포넌트로 만들기 + 기존 에디터를 재사용한 전용 편집 화면 |
| 렌더 시 내용 출처 | **레포트가 쓰는 버전의 내용을 레포트 JSON 안에 품는다**(`components`). 렌더러는 순수 함수로 남고, 미리보기·PDF·라벨·캔버스·4단계 렌더 API·번들이 저장소 조회 없이 동작한다 |
| 순수성 | core·renderer는 입출력 없는 순수 코드로 유지한다. 라이브러리 저장소와 API는 studio에만 있다 |

## 3. 패키지 구조 변화

```
packages/
  core        + ComponentBody·ComponentProp 스키마, ref 요소 확장(version), report.components,
                componentHash(), 예약어 props, 스키마 검증(누락 참조·중첩 금지)
  renderer    + flatten의 ref 펼치기, 인스턴스별 props 컨텍스트, elementId·instance 규칙
apps/studio   + components·component_versions 저장소와 API, 라이브러리 패널, 인스턴스 속성,
                선택 영역 → 컴포넌트, 그룹화·해제, 컴포넌트 전용 편집 화면, 레포트 저장 해시 검사
```

의존 방향은 1~3단계와 같다(core ← renderer ← pdf·label, studio가 조립).

## 4. 모델 (core)

### 4.1 컴포넌트 내용: `ComponentBody`

라이브러리 컴포넌트 한 버전의 불변 내용이다.

```jsonc
{ "name": "회사 헤더", "w": 180, "h": 24,
  "props": [ { "name": "title", "type": "string", "default": "품질보증서", "label": "제목" },
             { "name": "showLogo", "type": "boolean", "default": true } ],
  "elements": [ /* 컴포넌트 상자(0,0 ~ w,h) 기준 상대좌표 */ ] }
```

- `w`·`h`: 양수(mm).
- `props[]`: `name`은 식별자(`^[A-Za-z_][A-Za-z0-9_]*$`)이며 배열 안에서 유일하다. `type`은 `string | number | boolean | image`(image는 `asset://id` 또는 URL 문자열). `default`는 필수이고 타입과 맞아야 한다. `label`은 선택(표시용).
- `elements[]`: ref를 뺀 모든 요소. 트리 어디에도 `ref`가 있으면 스키마 오류(중첩 금지). 요소 id는 이 `elements` 트리 안에서 유일해야 한다.
- 컴포넌트 안의 표현식은 `props.<이름>`으로 입력값을 읽는다. 레포트 컨텍스트(`params`, 데이터셋, `record`, `row` 등)도 그대로 읽을 수 있다.
- `props`를 `RESERVED_CONTEXT_NAMES`에 추가한다(데이터셋 이름·`repeat.as`로 쓸 수 없다).

### 4.2 내용 해시: `componentHash(body)`

- 키를 정렬한 정규 JSON(`undefined` 제거, 배열 순서 유지)의 SHA-256 16진 문자열. 순수 함수이며 Node·브라우저 모두에서 같은 값을 낸다(구현은 의존성 없는 순수 JS SHA-256).
- 저장소는 버전마다 해시를 저장하고, 레포트 저장 시 검사(6.3)와 "같은 내용이면 버전을 올리지 않음"(6.2)에 쓴다.

### 4.3 레포트 쪽 확장

```jsonc
"components": { "company-header@3": { "name": "회사 헤더", "w": 180, "h": 24, "props": [...], "elements": [...] } },
"elements": [ { "type": "ref", "id": "hdr", "ref": "company-header", "version": 3,
                "x": 15, "y": 10, "w": 180, "h": 24,
                "props": { "title": "{{ record.DOC_TITLE }}", "showLogo": false } } ]
```

- `report.components`: `Record<"<컴포넌트id>@<버전>", ComponentBody>`, 기본값 `{}`. 키 형식은 `^[a-z0-9][a-z0-9-]*@[1-9][0-9]*$`(컴포넌트 id는 레포트 id와 같은 규칙).
- `ref` 요소: 기존 `ref`, `props`에 `version`(양의 정수, 필수)을 더한다. `props` 값은 `string | number | boolean`이다. 문자열은 템플릿으로 평가한다(값 전체가 `{{ }}` 하나면 원래 타입 유지). 지정하지 않은 입력값은 기본값을 쓰고, 선언되지 않은 이름의 값은 무시한다.
- `ref`의 `w`·`h`는 참조한 내용의 `w`·`h`와 같아야 한다(다르면 스키마 오류). 크기 조절은 지원하지 않는다.
- 스키마 검증(`ReportSchema.superRefine`):
  1. 레포트 본문의 모든 `ref`(그룹 안, 반복 영역 템플릿 안 포함)에 대해 `components["<ref>@<version>"]`이 있어야 한다.
  2. `components`의 각 내용은 4.1 규칙을 만족해야 한다.
  3. 요소 id 유일성 검사는 레포트 본문 트리에만 적용한다. 컴포넌트 내부 id는 레포트 id와 겹쳐도 된다.
- 쓰이지 않는 `components` 항목은 스키마상 허용한다. studio가 저장 전에 정리한다(7.2).

### 4.4 그룹화

기존 `group` 요소를 쓴다. 새 스키마는 없다(7.4).

## 5. 렌더링 (renderer)

### 5.1 펼치기

- `flatten(elements, …)`는 `components` 맵을 받는다(`layout`이 `report.components`를 넘긴다). `ref`를 만나면 `components["<ref>@<version>"]`의 `elements`를 그룹처럼 펼친다: 자식 좌표에 `ref.x`·`ref.y`를 더하고(선은 `x2`·`y2`도), `ref.visible`은 조상 조건 사슬에 넣는다.
- 펼친 각 `FlatElement`에 `owner`를 붙인다:
  ```ts
  type RefOwner = { refId: string; path: string; decls: ComponentProp[]; values: Record<string, string | number | boolean> };
  // path: 컴포넌트 트리 안의 요소 id 경로. 예 "logo", 그룹 안이면 "box/logo"
  ```
- 페이지 규칙: 펼친 고정 요소가 어느 페이지에 나오는지는 **`ref`의 `flow`**가 정한다(`once`·`every`·`last`). 컴포넌트 내부 요소의 `flow` 값은 무시한다(컴포넌트는 한 장 크기로 편집되기 때문이다). 펼친 넘기는 표·반복 영역은 기존 흐름 규칙(자기 페이지에만 나옴)을 따른다.
- 반복 영역 템플릿·그룹 밴드 안의 `ref`도 같은 규칙으로 펼친다(반복 영역이 항목 자식을 평탄화하는 경로에서 같은 함수를 쓴다). 이때 `instance`는 반복 항목 경로 뒤에 이어 붙는다(예: `cards#r3/hdr/logo`). 반복 영역 템플릿 안에서는 기존 제약대로 넘기는 표·반복 영역을 담은 컴포넌트를 쓸 수 없다(스키마 오류).
- 내용을 찾지 못하면(스키마를 거치지 않은 입력) 펼치지 않고 `ref` 상자에 `#ERR`(사유 `component <ref>@<version> not found`) 하나를 둔다.

### 5.2 입력값 컨텍스트

- 칠하는 시점에 `owner`가 있는 요소는 컨텍스트에 `props`를 더해 평가한다: `props = { ...기본값, ...평가된 values }`. 문자열 값은 레포트 컨텍스트(페이지 변수 포함)로 `evaluateTemplateValue` 평가하고, 선언에 없는 이름은 버린다.
- 같은 인스턴스의 입력값은 페이지마다 한 번만 평가한다(인스턴스 id 키로 캐시, `layout` 호출 단위).
- 입력값 평가가 `ExpressionError`면 그 인스턴스의 자식은 그리지 않고 `ref` 상자에 `#ERR` 하나를 둔다(fail 모드에서는 던진다).
- 흐름 요소(넘기는 표·반복 영역)의 조각 생성에도 같은 `props`를 넣은 컨텍스트를 쓴다. 조각 높이 측정 시점의 컨텍스트 규칙(2단계 5.1)은 그대로다.
- 흐름 조각의 **높이**는 조각을 만들 때의 입력값으로 굳힌다(2단계 5.1). 조각을 **그릴 때**는 그 페이지의 실제 페이지 컨텍스트로 입력값을 다시 평가해 자식 텍스트에 반영한다 — 입력값에 `{{ page }}`를 쓴 인스턴스의 표 셀·항목 자식은 컴포넌트 바깥 고정 요소와 같은 페이지 번호를 보인다(캐시 키에 페이지·부가 들어가므로 페이지마다 한 번만 평가한다).

### 5.3 배치 항목의 id 규칙

- 펼친 요소에서 나온 배치 항목의 `elementId`는 **인스턴스(`ref`) id**다.
- `instance`는 `"<refId>/<path>"`를 포함하고(반복 영역 안이면 항목 경로 뒤, 5.1), 요소 자체의 인스턴스 경로(표 셀 `t#h/c0`, 반복 항목 `cards#r3` 등)가 있으면 `/`로 이어 붙인다. 예: `hdr/logo`, `std/t#r12/c1`.
- 흐름 요소는 `FlowOptions.instancePrefix`로 `"<refId>/<path>"`를 받아 위 규칙을 만든다.
- 한 페이지 안에서 `(elementId, instance)` 쌍은 유일하다(같은 컴포넌트를 여러 번 넣어도 refId가 다르다).
- `ref` 상자 전체의 선택·히트용 항목: 인스턴스마다 `role: "flowBox"`와 같은 방식의 투명 `rect`(`role: "refBox"`, `instance` 없음)를 첫 번째로 둔다. 캔버스 선택 상자와 이동은 이 항목 좌표를 쓴다.
- 컴포넌트를 쓰지 않는 레포트의 레이아웃 결과는 바뀌지 않는다(기존 골든 스냅샷 유지).

## 6. 라이브러리 저장소와 API (studio)

### 6.1 저장소

프리셋 저장소(3단계)와 같은 패턴으로 `ComponentStore` 인터페이스, `MemoryComponentStore`, `DbComponentStore`를 둔다. `DATABASE_URL`이 없으면 메모리 구현을 쓴다.

| 테이블 | 열 |
|---|---|
| `components` | `id`(text, PK), `name`, `latest_version`(int), `created_at`, `updated_at` |
| `component_versions` | `component_id`, `version`(int), `body`(jsonb, 불변), `hash`(text), `created_at`. PK(`component_id`, `version`) |

```ts
type ComponentSummary = { id: string; name: string; latestVersion: number; w: number; h: number; updatedAt: string };
interface ComponentStore {
  list(): Promise<ComponentSummary[]>;
  get(id: string): Promise<{ summary: ComponentSummary; versions: { version: number; hash: string; createdAt: string }[]; latest: ComponentBody } | null>;
  getVersion(id: string, version: number): Promise<{ body: ComponentBody; hash: string } | null>;
  create(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }>;        // id 중복이면 ConflictError
  save(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }>;   // 해시가 최신과 같으면 created=false, 버전 그대로
  delete(id: string): Promise<void>;
}
```

- 버전은 지우거나 고치지 않는다. `delete`는 컴포넌트와 모든 버전을 지운다(사용 중이면 라우트가 막는다, 6.2).

### 6.2 API

| 경로 | 동작 |
|---|---|
| `GET /api/components` | `ComponentSummary[]` |
| `GET /api/components/:id` | 요약, 버전 목록, 최신 내용. 없으면 404 |
| `GET /api/components/:id/versions/:v` | `{ body, hash }`. 없으면 404 |
| `POST /api/components` | `{ id, body }` → 201 `{ version: 1, hash }`. 스키마 오류 400, 중복 409 |
| `PUT /api/components/:id` | `{ body }` → `{ version, hash, created }`. 없는 id 404 |
| `GET /api/components/:id/usage` | 이 컴포넌트를 쓰는 저장된 레포트 `{ reportId, versions: number[] }[]` |
| `POST /api/components/:id/apply-latest` | 저장된 모든 레포트에서 이 컴포넌트의 인스턴스를 최신 버전으로 올린다(7.2의 업데이트 규칙). `{ updated: string[], skipped: { reportId, error }[] }` |
| `DELETE /api/components/:id` | 사용하는 레포트가 있으면 409 `{ error, reports }`, 아니면 204 |

- 사용처는 레포트 저장소의 모든 레포트를 훑어 `ref`를 찾는다(이 단계에서는 별도 색인을 두지 않는다).
- 요청 본문 한도는 기존 `readJsonBody` 규칙을 따른다.

### 6.3 레포트 저장 시 검사

`POST /api/reports`, `PUT /api/reports/:id`는 저장 전에 레포트의 각 `components["id@v"]`를 검사한다:

- 라이브러리에 그 버전이 있고 `componentHash(품은 내용) !== 저장된 hash`이면 409 `{ error: "component <id>@<v> differs from the library", code: "COMPONENT_MISMATCH" }`.
- 라이브러리에 그 버전이 없으면 저장하고, 응답 본문(레포트 JSON)은 그대로 둔 채 헤더 `X-Daport-Warnings`에 JSON 배열(`["component <id>@<v> is not in the library"]`, ASCII)을 담는다. 툴바는 저장 성공 후 이 헤더가 있으면 경고를 보여준다.
- 쓰이지 않는 `components` 항목은 저장 전에 서버가 제거한다(클라이언트 정리가 빠져도 파일이 부풀지 않게).

## 7. 스튜디오 화면

### 7.1 라이브러리 패널

- 왼쪽 패널에 "컴포넌트" 탭을 추가한다(요소·데이터 탭 옆). `GET /api/components` 목록을 이름·최신 버전·크기로 보여준다.
- 항목을 캔버스로 끌어다 놓으면(`application/x-daport-component`, 값은 컴포넌트 id) 최신 버전 내용을 받아 스토어 액션 `insertComponent(id, version, body, x, y)`를 호출한다. 이 액션은 `components`에 내용을 넣고 놓은 위치에 `ref` 요소(`flow: "once"`, 입력값 비움, 새 id `allocateId(<컴포넌트id>)`)를 추가한다. 되돌리기 1단위.
- 항목 메뉴:
  - "편집": 새 탭으로 `/components/:id`.
  - "이 레포트의 인스턴스 모두 최신으로": 스토어 액션 `updateInstances(id, latestVersion, body)`.
  - "모든 레포트에 최신 적용": 확인 대화상자(사용하는 레포트 수 표시) 후 `POST /api/components/:id/apply-latest`, 결과 요약 표시. 열려 있는 레포트가 대상에 포함되면 "저장된 레포트가 바뀌었습니다. 새로 불러오세요" 안내.
  - "삭제": 사용하는 레포트가 있으면 비활성(툴팁에 레포트 id).

### 7.2 캔버스·속성 패널과 업데이트 규칙

- 인스턴스는 5장 결과대로 그려진다. 안쪽 어디를 눌러도 `elementId`가 인스턴스 id라 인스턴스가 선택된다. 선택 상자는 `refBox` 좌표. 이동은 되고 크기 조절 핸들은 표시하지 않는다. 더블클릭하면 새 탭으로 `/components/:id`.
- 속성 패널(`RefPanel`):
  - 컴포넌트 이름, `v<version>`. 라이브러리 최신 버전이 더 크면 "v3 → v5 업데이트" 버튼.
  - 입력값마다 칸: `string`·`number`는 템플릿 입력, `boolean`은 체크박스(옆 토글로 템플릿 입력 전환), `image`는 asset 선택 또는 URL 입력. 비우면 기본값 사용(값 삭제).
  - x·y·visible·flow는 기존 필드.
- **업데이트 규칙**(레포트 내 `updateInstances`와 서버 `apply-latest`가 같은 core 순수 함수 `upgradeRefs(report, id, version, body): Report`를 쓴다):
  1. `components["<id>@<version>"] = body`를 넣는다.
  2. 그 컴포넌트를 가리키는 모든 `ref`의 `version`을 새 버전으로, `w`·`h`를 새 내용의 크기로 바꾼다. 입력값 값은 그대로 두되 새 선언에 없는 이름은 지운다.
  3. 더 이상 쓰이지 않는 이 컴포넌트의 옛 버전 항목을 지운다.
  4. 결과를 `ReportSchema`로 검증한다(`apply-latest`에서 실패하면 그 레포트는 건너뛰고 `skipped`에 사유).
- 크기가 바뀌는 업데이트는 확인 대화상자에서 "180×24 → 180×30, 아래 요소와 겹칠 수 있습니다"를 보여준다.
- 레포트 저장 전 `pruneComponents(report)`(core 순수 함수)로 쓰이지 않는 항목을 지운다.

### 7.3 선택 영역을 컴포넌트로 만들기

- 조건: 선택이 2개 이상이거나 1개(그룹 등)이고, 모두 **같은 부모 배열**(최상위 또는 같은 그룹의 children)에 있으며, `ref`가 없고, 반복 영역 템플릿·밴드 안이 아니다. 조건이 안 맞으면 메뉴를 비활성으로 두고 사유를 툴팁으로 보여준다.
- 툴바 버튼과 캔버스 우클릭 메뉴 "컴포넌트로 만들기" → 대화상자(이름, id: 이름에서 제안하고 수정 가능).
- 동작:
  1. 선택 요소들의 경계 상자(선은 두 끝점 기준)를 계산한다.
  2. 요소들을 복제해 좌표를 상자 기준 상대좌표로 옮긴다(선은 `x2`·`y2`도). 이것이 `ComponentBody`(`props: []`)다.
  3. `POST /api/components`로 버전 1을 만든다. 실패하면 캔버스는 바꾸지 않고 오류를 보여준다.
  4. 성공하면 스토어 액션 `replaceWithComponent(selectionIds, id, 1, body, box)`: 선택 요소를 부모 배열에서 지우고, 첫 선택 요소 자리에 `ref`(상자 위치, 크기)를 넣고, `components`에 내용을 넣는다. 되돌리기 1단위(라이브러리 등록은 되돌리지 않는다).
- 순수 함수 `extractComponent(parent: Element[], ids: string[]): { body: ComponentBody; box: Box }`는 core에 둔다.

### 7.4 그룹화·해제

- Cmd/Ctrl+G: 7.3과 같은 "같은 부모" 조건(반복 영역 밴드 안 허용, `ref` 포함 허용)에서 선택 요소들을 `group` 하나로 묶는다. 그룹의 x·y·w·h = 경계 상자, 자식 좌표는 상대좌표, 그룹 id는 `allocateId("group")`, 첫 선택 요소 자리에 넣는다. 선택은 새 그룹.
- Cmd/Ctrl+Shift+G: 선택된 그룹 각각을 풀어 자식을 그룹 자리에 순서대로 넣고 좌표를 부모 기준으로 되돌린다. 그룹의 `visible`이 있으면 해제를 막고 사유를 알린다(조건이 사라지기 때문). 선택은 풀린 자식들.
- 둘 다 되돌리기 1단위. 순수 함수 `groupElements`·`ungroupElement`는 core에 둔다(7.3과 경계 상자 계산을 공유).

### 7.5 컴포넌트 전용 편집 화면 (`/components/:id`)

- 기존 `Editor`를 컴포넌트 모드로 연다. 편집 대상은 `ComponentBody`를 감싼 편집용 레포트다: `page = { width: w, height: h, margin: [0,0,0,0] }`, `elements = body.elements`, 데이터셋 없음. 스토어·캔버스·JSON 편집기·팔레트는 그대로 쓴다. 팔레트와 라이브러리 패널에서 `ref` 추가는 막는다(중첩 금지).
- 왼쪽 패널의 데이터 탭 대신 **입력값 패널**: 입력값 추가·삭제·순서, 이름·타입·기본값·라벨 편집. 미리보기용 샘플 값(저장하지 않음)을 넣으면 캔버스·미리보기 컨텍스트의 `props`에 들어간다.
- 페이지 패널의 너비·높이는 컴포넌트 `w`·`h`다.
- 툴바: "v5 (저장하면 v6)" 표시, 저장 → `PUT /api/components/:id`. `created: false`면 "변경 없음". 저장 뒤 사용하는 레포트 수와 "모든 레포트에 최신 적용" 버튼을 보여준다.
- 미리보기·PDF 라우트는 이 화면에서 편집용 레포트를 그대로 받는다. 샘플 입력값은 요청 본문의 새 선택 필드 `props`(객체)로 보내고, 라우트는 데이터셋 실행 결과 컨텍스트에 `props`로 넣어 레이아웃한다(요청 `data`의 키로는 보내지 않는다. `props`는 예약 이름이라 `data` 키로 거부된다). 캔버스도 같은 방식으로 샘플 값을 컨텍스트에 넣는다.

## 8. 오류 처리

| 상황 | 처리 |
|---|---|
| `ref`의 `id@버전`이 `components`에 없음, `ref` 크기가 내용과 다름, 내용 안에 `ref` | 스키마 오류. 캔버스는 마지막 유효 모델 유지, 미리보기·PDF·라벨은 400 |
| 스키마를 거치지 않은 입력에서 내용을 못 찾음 | `ref` 상자에 `#ERR` (5.1) |
| 입력값 템플릿 평가 실패 | 그 인스턴스만 `ref` 상자에 `#ERR`, fail 모드에서는 던짐 (5.2) |
| 컴포넌트 내부 표현식 오류 | 해당 내부 요소만 `#ERR` (기존 규칙) |
| 레포트 저장 시 품은 내용 해시가 라이브러리와 다름 | 409 `COMPONENT_MISMATCH` (6.3) |
| 라이브러리에 없는 버전을 품은 레포트 저장 | 저장 성공 + `X-Daport-Warnings` (6.3) |
| 컴포넌트 id 중복 생성 | 409 |
| 사용 중인 컴포넌트 삭제 | 409 + 사용하는 레포트 id 목록 |
| `apply-latest` 중 일부 레포트 검증 실패 | 그 레포트는 건너뛰고 `skipped`에 사유, 나머지는 적용 |
| 선택 영역 변환·그룹화 조건 불충족 | 메뉴·단축키 비활성, 사유 툴팁 (7.3, 7.4) |

## 9. 테스트

- **core**
  - 컴포넌트 내용 스키마: 입력값 이름 유일성·식별자, 타입과 기본값 일치, 내부 `ref` 금지, 내부 id 유일성.
  - 레포트 스키마: 누락 참조(그룹·반복 영역 템플릿 안 포함), `ref` 크기 불일치, 키 형식, 내부 id가 레포트 id와 겹쳐도 허용, `props` 예약어.
  - `componentHash`: 키 순서와 무관하게 같은 값, 내용 한 글자 변경 시 다른 값, 알려진 벡터로 SHA-256 검증.
  - `upgradeRefs`·`pruneComponents`·`extractComponent`·`groupElements`·`ungroupElement`: 선 끝점, 그룹 안 선택, 입력값 정리, 옛 버전 정리, 되돌림 가능성(그룹화 후 해제하면 원래 트리와 같음).
- **renderer**
  - 펼치기 좌표(선 포함), `ref.visible` 전파, `ref.flow` 규칙과 내부 `flow` 무시.
  - 인스턴스별 입력값(같은 컴포넌트 두 번, 다른 값), 기본값, 선언에 없는 값 무시, 입력값 템플릿이 `record`·`page`를 읽음.
  - `(elementId, instance)` 유일성, `refBox` 항목.
  - 컴포넌트 안의 넘기는 표가 여러 페이지로 나뉘고 인스턴스 접두사가 붙음.
  - 입력값 평가 오류 `#ERR`와 fail 모드.
  - 컴포넌트가 없는 레포트의 기존 골든 스냅샷이 그대로.
  - 골든: 컴포넌트를 쓰는 예제 레포트(헤더 컴포넌트 2회 사용 + 표준 표 컴포넌트) 레이아웃 스냅샷.
- **studio 단위**
  - 저장소(메모리): 생성·버전 증가·같은 내용이면 `created: false`·버전 조회·삭제.
  - 라우트: 컴포넌트 CRUD, usage, `apply-latest`(적용·건너뜀), 사용 중 삭제 409, 레포트 저장 해시 검사 409·경고 헤더·미사용 정리.
  - 스토어: `insertComponent`, `updateInstances`, `replaceWithComponent`, 그룹화·해제 액션과 되돌리기.
  - 패널: `RefPanel` 입력값 편집·업데이트 버튼, 라이브러리 패널 드래그 데이터, 입력값 패널.
- **pdf/label**: 컴포넌트 예제 레포트의 PDF 페이지 수와 HTML 대비 픽셀 비교.
- **E2E**
  1. 품질보증서에서 헤더 요소 여러 개를 선택 → "컴포넌트로 만들기" → 캔버스에 인스턴스 하나, 미리보기 동일.
  2. `/components/:id`에서 입력값 `title` 추가, 제목 텍스트를 `{{ props.title }}`로 바꾸고 저장 → v2.
  3. 레포트로 돌아와 "v1 → v2 업데이트", `title` 입력 → 캔버스·미리보기·PDF에 반영.
  4. 새 레포트에 라이브러리 패널에서 같은 컴포넌트를 두 번 끌어다 놓고 다른 제목 입력 → 둘 다 올바름.
  5. 요소 두 개 선택 → Cmd+G → 그룹 하나, Cmd+Shift+G → 원래 두 요소, 되돌리기.

## 10. 완료 기준

1. 캔버스 선택 영역으로 컴포넌트를 만들고, 전용 화면에서 입력값을 추가해 새 버전을 저장할 수 있다.
2. 레포트의 인스턴스는 고정된 버전으로 출력되고, 레포트별 업데이트와 모든 레포트 일괄 적용(`apply-latest`)이 동작한다.
3. 같은 컴포넌트를 한 레포트에 다른 입력값으로 여러 번 넣어도 캔버스·미리보기·PDF·라벨에서 올바르게 나온다.
4. 컴포넌트 안의 페이지를 넘기는 표가 2단계 흐름 규칙대로 동작한다.
5. Cmd+G·Cmd+Shift+G 그룹화·해제가 되고 각각 되돌리기 1단위다.
6. 레포트 저장 시 품은 컴포넌트 내용이 라이브러리와 다르면 409로 거부된다.
7. 컴포넌트를 쓰지 않는 기존 레포트의 골든 스냅샷과 1~3단계 E2E가 그대로 통과한다.

## 11. 범위 밖 (이후 단계)

- 컴포넌트 중첩, 인스턴스 크기 조절(확대·축소), 인스턴스 펼치기(연결 끊기), 교체 가능한 슬롯.
- 컴포넌트 권한·폴더·태그 분류, 버전 비교 화면, 버전 되돌리기(옛 버전 내용으로 새 버전 저장은 JSON 편집으로 가능).
- 사용처 색인 테이블(사용처는 레포트 전체 훑기로 찾는다).
- 4단계: 레포트 버전·배포, MES 렌더 API, API 키, 번들 내보내기·가져오기(레포트가 컴포넌트 내용을 품으므로 번들은 추가 작업 없이 포함한다).
