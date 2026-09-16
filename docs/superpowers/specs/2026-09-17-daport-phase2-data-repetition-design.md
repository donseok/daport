# daport 2단계 설계 스펙: 데이터 반복과 데이터 계층

작성일: 2026-09-17
상태: 승인 대기
상위 스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` (12장 로드맵 2단계, 5.2장, 7장)

## 1. 목적

어떤 레포트든 데이터 건수에 따라 늘어나는 양식을 만들 수 있게 한다. 표 넘김, 레코드마다 한 부씩, 자유 배치 반복 영역, 그룹 머리·소계를 **하나의 공통 흐름 엔진**으로 구현하고, 데이터를 요청으로 받거나 데이터셋으로 가져오는 계층을 만든다.

## 2. 원칙과 확정된 결정

| 항목 | 결정 |
|---|---|
| 범용성 | 모든 기능은 범용 기능이다. 검사증명서·송장·출하지시서는 검증용 예제일 뿐이며 양식 전용 요소·필드·로직을 만들지 않는다 |
| Oracle | 2단계에서는 SQL 커넥터 규격만 둔다. 실제 Oracle 커넥터는 이후 단계 |
| 데이터 유입 | 요청에 함께 온 데이터(`data`)를 우선 쓰고, 없으면 레포트의 데이터셋 정의를 실행한다 |
| 반복 형태 | 표 행 넘침, 레코드마다 한 부씩, 자유 배치 반복 영역(목록·격자), 그룹 머리·소계 모두 2단계에 포함 |
| 구현 방식 | 공통 흐름 엔진 하나에 표와 반복 영역이 조각(Block)을 넘기는 구조 (접근 3) |
| 순수성 | core와 renderer는 입출력 없는 순수 코드로 유지한다. 네트워크는 새 패키지 `@daport/datasource`만 쓴다 |

## 3. 패키지 구조 변화

```
packages/
  core        + repeat·repeater·표 확장 스키마, inferFields, avg/min/max 함수
  renderer    + 흐름 엔진(blocks, paginate, assemble), 표·반복 영역 조각 변환, instance 표시
  datasource  (신규) executeDatasets, http 커넥터, SqlConnector 규격, 한도·보안
  pdf         변경 없음 (여러 페이지는 이미 PaintPages가 처리)
apps/studio   + 데이터 패널, 필드 트리 드래그, 표·반복 영역 편집, 페이지 선택기, sample API
```

의존 방향: `datasource → core`. `renderer`와 `pdf`는 datasource를 모른다. studio 서버 라우트가 datasource로 데이터를 만든 뒤 renderer·pdf에 넘긴다. 캔버스는 레포트의 `sample`만 쓴다.

## 4. 레포트 모델 확장 (core)

### 4.1 레코드마다 한 부씩: `repeat`

```jsonc
"repeat": { "source": "shipments", "as": "record" }
```

- `source`는 배열을 돌려주는 표현식이다(4.2). `as`의 기본값은 `record`다.
- 레코드마다 페이지 묶음 전체를 한 번씩 레이아웃한다. 각 부 안의 표현식에서 `record`로 현재 레코드를 읽는다.
- 변수: `page`·`total`은 부 안의 번호(부마다 1부터), `sheet`·`sheets`는 전체 문서 기준 번호, `copy`(1부터)·`copies`는 몇 번째 부인지.
- 레코드가 0건이면 페이지 한 장을 만들고, 페이지 여백 좌상단에 텍스트 항목 `#NODATA`(elementId `__nodata`)를 둔다. 고정 요소는 `record`가 `undefined`인 상태로 그린다.

### 4.2 데이터 소스는 표현식

`table.source`, `repeater.source`, `repeat.source`는 **배열로 평가되는 표현식**이다(`{{ }}` 없이 적는다).

- `items` → 데이터셋 전체
- `record.items` → 중첩 JSON 배열
- `items[.ORDER_NO == record.ORDER_NO]` → 키로 다른 데이터셋과 연결(jexl 필터)

평가 결과가 배열이 아니면 해당 요소 자리에 `#ERR`(사유: `source is not an array`)를 둔다. `null`·`undefined`는 빈 배열로 본다.

### 4.3 표 확장: `table`

```jsonc
{ "type": "table", "id": "t1", "x": 10, "y": 60, "w": 190, "h": 200,
  "source": "record.items",
  "columns": [ { "header": "품목", "value": "{{ row.NAME }}", "w": 60, "align": "left", "style": {} } ],
  "repeatHeader": true,
  "rowHeight": 6,            // 최소 행 높이(mm). 셀 텍스트 줄바꿈에 맞춰 늘어난다
  "headerHeight": 7,         // 최소 머리행 높이
  "border": "all",           // all | rows | none
  "borderStyle": { "stroke": "#000000", "strokeWidth": 0.2 },
  "headerStyle": {},         // 머리행 셀 기본 스타일
  "groups": [ { "by": "row.CATEGORY",
                "header": [ { "value": "{{ group.key }}", "span": "all", "style": {} } ],
                "footer": [ { "value": "소계 {{ sum(group.rows, 'QTY') }}", "span": "all" } ],
                "keepHeaderWithRows": true } ],
  "pageFooter": [ { "value": "페이지 소계 {{ sum(pageRows, 'QTY') }}", "span": "all" } ],
  "footer": [ { "value": "합계 {{ sum(rows, 'QTY') }}", "span": "all" } ] }
```

- 머리행·그룹 행·소계 행의 셀 배열 규칙: 셀마다 `value`와 선택적 `span`(열 개수, 또는 `"all"`), `align`, `style`. span 합이 열 수보다 적으면 남은 열은 빈 셀.
- `groups`는 배열이며 앞 항목이 바깥 그룹이다. 그룹 경계는 **데이터 순서대로 연속된 같은 key**다(자동 정렬하지 않는다. 정렬이 필요하면 데이터에서 정렬해 보낸다).
- 기존 `overflow`는 `continue`(넘김)·`clip`(영역에서 자름) 그대로 유지한다. `keepTogether`는 2단계에서 항상 `row`로 동작한다(행 하나를 쪼개지 않음). 스키마 값 `none`은 받아들이되 `row`와 같게 처리한다.
- 1단계 표 JSON(`source`가 데이터셋 이름)은 그대로 유효하다(이름은 곧 표현식이다).

### 4.4 자유 배치 반복 영역: `repeater` (신규 요소)

```jsonc
{ "type": "repeater", "id": "cards", "x": 10, "y": 40, "w": 190, "h": 240,
  "source": "lots",
  "layout": "grid",          // list | grid
  "gap": [2, 2],             // [가로, 세로] mm
  "item": { "w": 60, "h": 35, "children": [ /* item 기준 상대좌표의 요소들 */ ] },
  "groups": [ { "by": "item.LINE",
                "header": { "h": 8, "children": [ ... ] },
                "footer": { "h": 6, "children": [ ... ] } } ],
  "overflow": "continue" }
```

- `list`: 항목을 세로로 하나씩 쌓는다(항목 너비는 `item.w`, 좌측 정렬).
- `grid`: 한 줄에 `floor((w + gap[0]) / (item.w + gap[0]))`개(최소 1)씩 좌→우, 위→아래로 배치한다. 한 줄이 하나의 조각이다.
- 항목 하나는 페이지 경계에서 쪼개지지 않는다.
- `item.children`, 그룹 `header.children`·`footer.children`에는 text, image, line, rect, pageNumber, group, table(`overflow: "clip"`만)을 둘 수 있다. repeater 안의 repeater, `overflow: "continue"` 표는 스키마에서 거부한다.
- 요소 id는 레포트 전체에서 유일해야 한다(repeater 템플릿 자식 포함).

### 4.5 반복 표현식 변수

| 변수 | 범위 | 뜻 |
|---|---|---|
| `row` | 표 행·그룹 행 | 현재 행 |
| `item` | 반복 영역 항목·그룹 | 현재 항목 |
| `index` | 행·항목 | 0부터 시작하는 전체 순번 |
| `group.key`, `group.rows`, `group.index`, `group.level` | 그룹 머리·소계와 그 안의 행 | 현재(가장 안쪽) 그룹. `level`은 0부터 |
| `rows` | 표·반복 영역 안 전부 | 소스 배열 전체 |
| `pageRows` | 표·반복 영역 안 전부 | 현재 페이지 조각에 들어간 행(항목) |
| `record`(또는 `repeat.as`) | 레포트 전체 | 현재 부의 레코드 |
| `page`, `total`, `sheet`, `sheets`, `copy`, `copies` | 레포트 전체 | 4.1 |

등록 함수 추가: `avg(rows, field)`, `min(rows, field)`, `max(rows, field)`. 숫자로 바꿀 수 없는 값은 건너뛴다. 빈 배열이면 `null`.

### 4.6 샘플 스냅샷: `sample`

```jsonc
"sample": { "params": { "orderNo": "A-1001" },
            "data": { "orders": [ ... ] },          // 데이터셋마다 앞 200행
            "capturedAt": "2026-09-17T05:02:00.000Z" }
```

선택 필드다. 캔버스는 이 값으로 그린다. 레포트 파일 안에 있으므로 DB 없이 렌더 테스트가 되고 이후 번들 내보내기에 포함된다.

### 4.7 데이터셋 스키마 (변경분)

```jsonc
{ "name": "orders", "type": "http", "method": "GET",
  "url": "https://mes.example.com/api/orders/{{ params.orderNo }}",
  "headers": { "Authorization": "Bearer {{ secrets.MES_TOKEN }}" },
  "body": "{\"lot\": \"{{ params.lot }}\"}",   // POST일 때만. 템플릿
  "rowsPath": "data.items" }                    // 점 경로. 생략 시 응답 루트
{ "name": "items", "type": "sql", "connection": "mes", "query": "SELECT ... WHERE ORDER_NO = :orderNo" }
```

- URL 템플릿 값은 `encodeURIComponent`로 인코딩한다. 헤더·본문 템플릿 값은 그대로 넣는다.
- `secrets.이름`은 서버 전용 컨텍스트에서만 해석된다(5.4).

### 4.8 필드 추론: `inferFields(rows, { sampleSize = 200 })`

- 앞 200행의 키를 합친다. 타입: `string | number | boolean | date | object | array | null`.
- ISO 8601 날짜·일시 문자열과 `Date` 값은 `date`로 본다. 한 키에 타입이 섞이면 `null`이 아닌 가장 흔한 타입, 동률이면 `string`.
- `object`는 하위 필드를, `array`는 원소 객체들의 하위 필드를 재귀로 가진다(깊이 5까지).
- 결과: `{ name, path, type, children? }[]`. 순수 함수이며 core에 둔다.

## 5. 공통 흐름 엔진 (renderer)

`layout(report, data): Page[]`는 순수 함수로 유지한다. 내부를 세 단계로 나눈다.

### 5.1 조각 만들기

```ts
type BlockKind = "header" | "row" | "groupHeader" | "groupFooter" | "pageFooter" | "footer";
type Block = {
  kind: BlockKind;
  height: number;                       // mm. 조각 생성 시 확정
  keepWithNext: boolean;                // 그룹 머리행: 다음 조각과 같은 페이지에 둔다
  rows: unknown[];                      // 이 조각이 담은 데이터 행(pageRows 계산용). 머리·소계는 []
  paint(origin: { x: number; y: number }, pageCtx: PageFlowContext): PlacedItem[];
};
type PageFlowContext = { page: number; total: number; sheet: number; sheets: number;
                         copy: number; copies: number; pageRows: unknown[] };
```

- **표**: 머리행(`header`), 행(`row`), 그룹 머리·소계(`groupHeader`·`groupFooter`), 페이지 소계(`pageFooter`, 페이지마다 복제되는 템플릿), 표 합계(`footer`). 행 높이 = max(`rowHeight`, 셀별 `lines × lineHeight + padding×2`).
- **반복 영역**: `list`는 항목마다 `row` 조각, `grid`는 한 줄마다 `row` 조각(여러 항목을 담음). 그룹 머리·소계는 해당 템플릿 높이의 조각.
- `paint`는 페이지 조립 시 호출되며 `pageRows`·`page`·`total` 등 페이지 의존 값을 받는다. 조각 높이는 페이지 의존 값에 영향받지 않는다(페이지 번호 텍스트가 줄 수를 바꾸는 경우도 높이는 조각 생성 시 값으로 고정).

### 5.2 페이지 나누기: `paginate(blocks, regions)`

입력: 조각 목록, 첫 페이지 영역 `{x, y, w, h}`, 이어지는 페이지 영역(원래 x, y, w 유지, 높이 = `page.height - margin.bottom - y`). 출력: 페이지마다 `{ blocks: {block, y}[] , pageRows }`.

규칙:

1. `header` 조각은 첫 페이지 맨 위에 둔다. `repeatHeader`면 이어지는 페이지마다 맨 위에 다시 둔다.
2. `pageFooter` 템플릿이 있으면 각 페이지 영역 하단에 그 높이만큼 자리를 예약하고, 페이지 조각 배치가 끝난 뒤 그 페이지의 `pageRows`로 칠한다.
3. 나머지 조각을 순서대로 쌓는다. 남은 높이 < 조각 높이면 새 페이지로 넘어간다.
4. `keepWithNext` 조각은 바로 뒤 조각까지 같은 페이지에 들어가지 못하면 함께 다음 페이지로 넘어간다. 연쇄(바깥·안쪽 그룹 머리 연속)도 같은 규칙으로 묶는다. 묶음 전체가 빈 페이지에도 안 들어가면 묶음을 풀고 3번 규칙으로 쌓는다.
5. 조각 하나가 빈 페이지 영역(머리행·페이지 소계 예약분 제외)보다 크면 그 페이지에 단독으로 두고 영역 하단에서 잘린다. 해당 배치 항목에 `overflow: true`를 표시한다. 무한 페이지 생성을 막는다.
6. `overflow: "clip"`이면 첫 페이지 영역에 들어가는 조각까지만 두고 나머지는 버린다(잘림 표시 `clipped: true`를 요소 단위로 남긴다).
7. `footer`는 마지막 페이지의 마지막 행 뒤에 둔다. 자리가 없으면 새 페이지로 넘긴다.

### 5.3 페이지 조립

1. 페이지 템플릿의 흐름 요소(`table` `overflow: continue`, `repeater` `overflow: continue`)를 각자 `paginate`한다. 부의 페이지 수 = max(흐름 요소별 페이지 수, 1).
2. 페이지 i마다: 고정 요소를 `flow` 규칙(once는 첫 페이지, every는 모든 페이지, last는 마지막 페이지)으로 고르고, 흐름 요소는 i번째 조각 배치를 `paint`한다. 흐름 요소의 페이지 수가 전체보다 짧으면 그 뒤 페이지에는 해당 요소가 없다.
3. 흐름 요소 자체의 `flow` 값은 무시한다(흐름 요소는 자기 페이지에만 나온다). `overflow: "clip"`인 표·반복 영역은 흐름 요소가 아니라 고정 요소로 취급해 `flow` 규칙을 따르고, 나오는 페이지마다 첫 영역에 들어가는 조각까지만 그린다(`pageRows`는 그 조각들의 행).
4. `repeat`가 있으면 레코드마다 1~2를 수행하고 이어 붙인다. `sheet`·`sheets`는 전체 조립 후 확정되므로 고정 요소 칠하기는 전체 페이지 수가 정해진 뒤에 한다.
5. 전체 페이지 수가 `MAX_PAGES`(기본 2000)를 넘으면 `LayoutLimitError`를 던진다.

### 5.4 배치 항목 확장

- `PlacedItem`에 선택 필드 `instance?: string`을 추가한다. 반복으로 생긴 항목은 템플릿 요소 id를 `elementId`에 유지하고, `instance`에 `"<요소id>#<행index>"`(중첩 시 `/`로 연결)를 둔다. React key는 `elementId + instance`를 쓴다.
- 표 셀·테두리는 기존 kind(`text`, `line`, `rect`)로 표현한다(새 kind를 만들지 않는다). 표 전체 영역에는 선택·히트용 `rect` 항목(`role: "flowBox"`, 채움·선 없음)을 하나 둔다.
- `overflow`·`clipped`·`error`는 문제 목록에 올릴 수 있게 항목에 남긴다.

### 5.5 오류와 성능

- 셀·항목 표현식 오류는 그 셀·항목 자식만 `#ERR`로 격리한다(1단계와 같은 `onExpressionError` 규칙. 캔버스는 항상 blank).
- 소스 표현식 오류·배열 아님은 흐름 요소 전체를 `#ERR` 한 칸으로 둔다.
- 줄바꿈 측정은 `(text, fontSize, bold, width)` 키로 레이아웃 호출 단위 캐시를 둔다. 목표: 행 1만 건 표 레이아웃 1초 이내(개발 머신 기준, CI에서는 3초 허용).

## 6. 데이터 계층 (datasource)

### 6.1 실행 API

```ts
type Connectors = { http?: HttpConnector; sql?: Record<string, SqlConnector> };   // sql은 connection 이름별
type ExecuteOptions = { params: Record<string, unknown>; data?: Record<string, unknown>;
                        connectors: Connectors; secrets: (name: string) => string | undefined;
                        limits?: Partial<Limits> };
executeDatasets(report, opts): Promise<{ context: DataContext; errors: DatasetError[] }>
```

- 파라미터는 core `resolveParams`로 정규화한다.
- 데이터셋마다: `data[name]`이 있으면 그 값(객체면 `[객체]`로 감쌈). 없으면 type별 실행. `data`에만 있는 이름도 컨텍스트에 넣는다.
- 결과 행은 core `rowsProxy`로 감싼다(1단계와 같은 `ds.FIELD` 접근).
- 실패는 `errors`에 `{ dataset, message, code }`로 모은다. `code`: `TIMEOUT | HOST_NOT_ALLOWED | HTTP_STATUS | BAD_JSON | ROWS_PATH | TOO_LARGE | TOO_MANY_ROWS | SQL_NOT_CONFIGURED | SQL_ERROR`. 호출자가 실패를 치명으로 볼지 정한다(미리보기·PDF는 치명, 샘플은 부분 허용).

### 6.2 http 커넥터

- 기본 구현은 전역 `fetch`를 쓴다. 테스트에서는 가짜 fetch를 주입한다.
- 호스트 허용 목록: 환경변수 `DAPORT_HTTP_ALLOW`(쉼표 구분 호스트, `host:port` 허용). 비어 있으면 모든 http 데이터셋이 `HOST_NOT_ALLOWED`. 리다이렉트는 따라가지 않는다(`redirect: "manual"`, 3xx는 `HTTP_STATUS`).
- 한도: 타임아웃 30초(`AbortSignal.timeout`), 응답 20MB(스트림을 읽으며 초과 시 중단), 1만 행.
- `rowsPath`는 점 경로(`data.items`). 결과가 배열이 아니면 객체는 `[객체]`로 감싸고 그 밖은 `ROWS_PATH`.

### 6.3 SQL 커넥터 규격

```ts
type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
interface SqlConnector {
  query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal })
    : Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }>;
}
```

- 바인드는 쿼리의 `:이름` 중 `params`에 있는 값만 이름으로 넘긴다. 문자열 결합은 하지 않는다.
- `connectors.sql[dataset.connection]`이 없으면 `SQL_NOT_CONFIGURED`.
- 결과는 **순수 JSON**이어야 한다(날짜는 ISO 8601 문자열, 큰 수는 문자열 허용). 나중에 공장 내부 중계 에이전트가 같은 규격을 HTTP로 전달할 수 있게 하기 위해서다(`docs/superpowers/research/2026-09-17-oracle-connectivity.md`). 직접 연결인지 에이전트인지는 이후 단계의 연결 설정(`via`)이 정하며 데이터셋 스키마는 바뀌지 않는다.
- 2단계 구현물은 규격, 바인드 추출 함수, 가짜 커넥터 기반 테스트뿐이다.

### 6.4 비밀값

- `secrets.이름`은 `DAPORT_SECRET_<이름>` 환경변수에서만 읽는다. 이름은 `[A-Z0-9_]+`.
- 비밀값은 http 요청 헤더·URL·본문 템플릿 평가 컨텍스트에만 존재한다. 레이아웃 컨텍스트·샘플·응답·오류 메시지에는 넣지 않는다(오류 메시지에서 비밀값 문자열은 `***`로 치환).

### 6.5 요청 데이터 한도

preview·pdf·sample 라우트는 본문 20MB를 넘으면 413을 반환한다(`content-length` 선검사 + 읽은 바이트 검사).

## 7. 스튜디오 (apps/studio)

### 7.1 데이터 패널 (왼쪽 패널 탭)

- **파라미터**: 레포트 `params` 목록과 샘플 실행용 값 입력. 값은 `sample.params`에 저장된다.
- **데이터셋 목록**: 추가(static·http), 삭제, 이름 변경. static은 JSON 붙여넣기 입력, http는 method·url·headers·body·rowsPath 폼. sql 데이터셋은 목록에 "커넥터 미설정"으로 표시하고 JSON 편집기에서만 고친다.
- **샘플 가져오기**: `POST /api/reports/:id/sample` 호출 → 성공한 데이터셋 결과를 `sample.data`에 반영(되돌리기 가능한 편집 1건), 실패한 데이터셋은 사유를 패널에 표시.
- **필드 트리**: `inferFields(sample.data[이름])` 결과. 타입 아이콘, 배열·객체 펼침.

### 7.2 필드 드래그 바인딩

| 놓는 곳 | 결과 |
|---|---|
| 빈 캔버스 | 텍스트 요소 `{{ <데이터셋>.<경로> }}`. 레포트에 `repeat`가 있고 필드가 repeat 소스 데이터셋의 것이면 `{{ record.<경로> }}` |
| 표 영역 | 열 추가 `{{ row.<경로> }}` (표 소스 기준 상대 경로) |
| 반복 영역 템플릿 항목 | 항목 안 텍스트 `{{ item.<경로> }}` |
| 배열 노드를 빈 캔버스 | 원소 필드마다 열 하나인 표 생성(최대 8열, 너비 균등) |

소스 기준 상대 경로를 알 수 없는 필드(다른 데이터셋의 필드를 표에 놓음)는 전체 경로로 넣고 문제 목록에 "표 소스와 다른 데이터셋"을 경고한다.

### 7.3 표·반복 영역·레포트 반복 편집

- 표 속성: 소스 표현식, 열(추가·삭제·위아래 이동·머리글·값·너비·정렬), 최소 행 높이, 머리행 높이, 헤더 반복, 테두리, 그룹(기준·머리 셀·소계 셀 추가/삭제), 페이지 소계, 표 합계.
- 반복 영역: 팔레트에 추가. 캔버스에서 **첫 항목 자리가 템플릿 편집 영역**(파란 점선 테두리)이고, 템플릿 자식은 그룹 자식과 같은 방식으로 선택·이동·리사이즈한다. 나머지 항목은 샘플 데이터로 흐리게(opacity 0.5) 그린다. 흐린 항목의 자식을 클릭하면 템플릿의 같은 요소가 선택된다. 속성: 소스, layout, gap, 항목 크기, 그룹(기준·머리·소계 높이; 머리·소계 자식은 JSON 편집기에서 편집).
- 레포트 반복: 페이지 패널에 "레코드마다 한 부씩" 스위치와 소스 표현식 입력.

### 7.4 캔버스 페이지·부 선택

- 캔버스는 `layout(report(onExpressionError=blank), sample 기반 컨텍스트)` 결과에서 선택된 페이지 하나를 그린다.
- 툴바에 페이지 선택기(◀ n / N ▶). `repeat`가 있으면 부 선택기(◀ c / C ▶)가 추가된다. 편집으로 페이지 수가 줄면 마지막 페이지로 조정한다.
- 흐름 요소가 없는 페이지에서도 고정 요소는 편집할 수 있다. 선택·드래그는 1단계 규칙을 따르되, 반복 인스턴스 항목은 템플릿 요소로 매핑한다.

### 7.5 API

| 경로 | 본문 | 응답 |
|---|---|---|
| `POST /api/reports/:id/preview` | `{ report?, params?, data? }` | HTML. 데이터셋 오류 시 400 `{ error, datasetErrors }` |
| `POST /api/reports/:id/pdf` | 같음 | PDF. 오류 규칙 같음 |
| `POST /api/reports/:id/sample` (신규) | `{ report?, params }` | `{ data, fields, errors, capturedAt }`. `data`는 데이터셋마다 앞 200행 |

- 편집 중 미리보기·PDF는 `data: sample.data`를 보내 서버 데이터셋 실행 없이 그린다. 툴바에 "실데이터로" 토글을 두어 켜면 `data` 없이 보낸다.
- 레이아웃 한도 초과는 400 `{ error, code: "LAYOUT_LIMIT" }`, 본문 초과는 413.

## 8. 오류 처리 요약

| 상황 | 처리 |
|---|---|
| 데이터셋 실행 실패 | 미리보기·PDF 400 + `datasetErrors`. 샘플은 성공분 저장, 실패분 사유 표시 |
| 소스가 배열 아님·소스 표현식 오류 | 해당 흐름 요소 자리 `#ERR` |
| 셀·항목 표현식 오류 | 해당 셀·항목만 `#ERR` |
| 조각이 빈 페이지보다 큼 | 잘라 단독 배치, `overflow` 표시, 캔버스 문제 목록 |
| 페이지 상한 초과 | 400 `LAYOUT_LIMIT` |
| 요청 본문 20MB 초과 | 413 |
| 허용 안 된 http 호스트 | `HOST_NOT_ALLOWED` (데이터셋 오류) |

## 9. 테스트

- **core**: 스키마(repeat, repeater 제약, 표 확장, sample, http·sql 데이터셋), `inferFields`, `avg/min/max`, jexl 필터 소스 표현식.
- **renderer 흐름 엔진 불변식(속성 기반)**: 무작위 행 높이·그룹 키·영역 높이로 반복 실행해 확인한다.
  - 모든 행이 정확히 한 번, 원래 순서대로 배치된다.
  - 조각이 영역 하단을 넘지 않는다(5.2의 5번 예외만 `overflow` 표시와 함께 허용).
  - `repeatHeader`면 모든 페이지 첫 조각이 머리행이다.
  - `keepWithNext` 조각이 페이지 마지막 조각이 아니다(5.2의 4번 예외 제외).
  - 페이지 소계의 `pageRows`가 그 페이지 `row` 조각들의 행 합집합과 같다.
  - 무작위 생성기는 시드 고정(재현 가능).
- **renderer 단위**: 그룹 중첩, 그룹 머리 연쇄 keepWithNext, grid 한 줄 개수, clip, repeat 페이지 번호·sheet·copy, 0건 repeat, 흐름 요소 여러 개 페이지 수, instance 표시, 페이지 상한.
- **datasource**: 요청 data 우선·data 전용 이름, http(허용 호스트, 리다이렉트 거부, 타임아웃, 20MB, 1만 행, rowsPath, 비밀값 치환·오류 메시지 마스킹), sql(바인드 추출, 미설정 오류, 가짜 커넥터 결과).
- **골든**: 예제 4종(9.1)의 레이아웃 스냅샷.
- **pdf**: 예제 중 여러 페이지 PDF의 페이지 수 = 레이아웃 페이지 수, 페이지별 HTML 스크린샷 대비 픽셀 차이 허용치 이내.
- **성능**: 행 1만 건 표 레이아웃 시간(5.5 기준).
- **studio 단위**: 데이터 패널, 드래그 바인딩 경로 결정 함수, 표 열 편집, 반복 영역 템플릿 매핑, 페이지 선택기.
- **E2E**: static JSON 데이터셋 추가 → 샘플 가져오기 → 필드 트리의 배열 노드를 끌어 표 생성 → 미리보기 여러 페이지 → PDF 페이지 수 확인 → 반복 영역 추가·템플릿 텍스트 수정이 모든 항목에 반영 → 페이지 선택기 이동.

### 9.1 검증용 예제 (fixtures)

예제는 `packages/renderer/src/__tests__/fixtures/`에 레포트 JSON과 샘플 데이터로만 존재한다. 예제를 위한 전용 코드는 없다.

| 예제 | 확인하는 범용 기능 |
|---|---|
| 검사증명서 | `repeat`(로트별), 긴 표 여러 페이지 넘김, 분류별 그룹 머리·소계, 페이지 소계, 헤더 반복 |
| 송장 | `repeat`(출하별), 중첩 배열 소스 `record.items`, 표 합계, `flow: last` 요소 |
| 출하지시서 | 반복 영역 list, 라인별 그룹 머리, 키 연결 소스 `items[.ORDER_NO == item.ORDER_NO]` |
| 사원 명찰 시트 | 반복 영역 grid, 여러 페이지. MES와 무관한 범용성 점검 |

## 10. 완료 기준

1. 500행 표가 여러 페이지로 나뉘며 헤더 반복, 그룹 머리·소계, 페이지 소계, 표 합계가 맞게 나온다(불변식 테스트와 골든 통과).
2. `repeat`로 N건이면 N부가 나오고 `page`·`total`은 부마다, `sheet`·`sheets`는 전체 기준으로 맞다.
3. 반복 영역이 list·grid 모두에서 그룹과 함께 페이지를 넘긴다.
4. 미리보기·PDF가 요청 `data`를 우선 쓰고, http 데이터셋의 허용 호스트·비밀값·한도와 SQL 커넥터 경계가 테스트로 검증된다.
5. 스튜디오에서 샘플 가져오기, 필드 트리, 위치별 드래그 바인딩, 표·반복 영역·레포트 반복 편집, 페이지·부 선택이 된다(E2E 통과).
6. 예제 4종이 여러 페이지 PDF로 나오고 HTML과 페이지별 픽셀 비교를 통과한다.
7. 행 1만 건 표 레이아웃이 5.5의 시간 기준을 만족한다.

## 11. 범위 밖 (이후 단계)

- Oracle 커넥터 구현과 연결 관리 UI(`connections` 테이블).
- 흐름 요소끼리 밀어내기(`pushDown`), 행 하나를 페이지에 걸쳐 쪼개기, 이어지는 페이지 전용 템플릿(`continuationPage`).
- 반복 영역 안의 반복 영역, 넘기는(`continue`) 중첩 표.
- 데이터 자동 정렬·필터 UI(정렬은 데이터 측 책임).
- 바코드 렌더링·라벨 프린터(3단계), 정식 렌더 API·API 키·버전 배포(4단계).
- CSV·엑셀 업로드, 교차표, 차트.
- 서버 Chromium 외부 요청 허용 목록(1단계에서 4단계로 넘긴 항목 그대로).
