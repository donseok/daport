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
  core        + repeat·repeater·표 확장 스키마, inferFields, avg/min/max 함수,
                childLists, normalizeRows, buildContext, 예약 이름 검사, evaluate 컴파일 캐시
  renderer    + 흐름 엔진(blocks, paginate, assemble), 표·반복 영역 조각 변환, instance 표시
  datasource  (신규) executeDatasets, http 커넥터, SqlConnector 규격, extractBinds, 한도·보안
  pdf         렌더 경로 변경 없음(여러 페이지는 이미 PaintPages가 처리). 페이지별 비교용
                renderHtmlScreenshots(report, data): Promise<Buffer[]>만 추가
                (.dp-page마다 1장, 기존 renderHtmlScreenshot은 그 결과의 [0]과 같다)
apps/studio   + 데이터 패널, 필드 트리 드래그, 표·반복 영역 편집, 페이지 선택기, sample API
```

의존 방향: `datasource → core`. `renderer`와 `pdf`는 datasource를 모른다. studio 서버 라우트가 datasource로 데이터를 만든 뒤 renderer·pdf에 넘긴다. 캔버스는 서버 데이터셋을 실행하지 않고 레포트 안의 값(static 행과 `sample`)만 쓴다(컨텍스트 구성은 7.4).

## 4. 레포트 모델 확장 (core)

### 4.1 레코드마다 한 부씩: `repeat`

```jsonc
"repeat": { "source": "shipments", "as": "record" }
```

- `source`는 배열을 돌려주는 표현식이다(4.2). `as`의 기본값은 `record`다. `as`의 이름 규칙은 4.7.1을 따른다.
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
  "columns": [ { "header": "품목", "value": "{{ row.NAME }}", "w": 60, "style": { "align": "left" } } ],
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

- 그룹 행·소계 행의 셀 배열 규칙: 셀마다 `value`와 선택적 `span`(열 개수, 또는 `"all"`), `style`. span 합이 열 수보다 적으면 남은 열은 빈 셀. 정렬은 `style.align`으로만 정한다(열·셀에 별도 `align` 필드를 두지 않는다).
- 스타일 병합: 표 스키마의 `headerStyle`, 열 `style`, 셀 `style`, `borderStyle`은 기본값 없는 부분 스타일(`StyleSchema.partial()`)이고, 기본값은 병합이 끝난 뒤 한 번만 채운다. 병합 순서(뒤가 이긴다):
  - 머리행 셀: 기본값 < 그 열 `style` < `headerStyle` (머리행은 `columns[].header` 문자열이라 셀 `style` 단계가 없다)
  - 데이터 행 셀: 기본값 < 열 `style`
  - 그룹 머리·소계, 페이지 소계, 표 합계 셀: 기본값 < 그 셀이 걸친 첫 열의 `style` < 셀 `style`
  - 1단계 `columns[].style`은 그대로 유효하다.
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
  - 그룹이 있으면 그룹 머리·소계 앞에서 현재 줄을 끝내고, 다음 항목은 새 줄 첫 칸에서 시작한다(grid 줄은 그룹 경계에서 끊긴다).
  - 모자란 줄은 왼쪽부터 채우고 나머지 칸은 비운다.
- 간격: 조각 높이에 gap을 넣지 않는다. 같은 페이지에서 이어지는 두 반복 영역 조각(항목·줄·그룹 머리·소계) 사이에만 `gap[1]`을 더하고, 페이지 첫 조각 앞에는 넣지 않는다. `list`는 `gap[0]`을 무시한다.
- 항목 하나는 페이지 경계에서 쪼개지지 않는다.
- `item.children`, 그룹 `header.children`·`footer.children`에는 text, image, line, rect, pageNumber, group, table(`overflow: "clip"`만)을 둘 수 있다. repeater 안의 repeater, `overflow: "continue"` 표는 스키마에서 거부한다.
- 요소 id는 레포트 전체에서 유일해야 한다(repeater 템플릿 자식 포함).
- 요소 트리 순회: core는 `childLists(el): Element[][]`를 내보낸다(group → `[children]`, repeater → `[item.children, ...groups의 header?.children·footer?.children]`, 그 밖 → `[]`). 요소 트리를 도는 모든 코드는 이 함수로 내려간다. 대상은 스키마 id 유일성 검사, 스튜디오 스토어의 find·update·move·resize·delete·newId·선 w/h 정규화, 복제 시 자식 id 재발급이다. 복제한 repeater는 템플릿 자식 전부(그룹 머리·소계 자식 포함)에 새 id를 준다. flatten은 group만 내려가고 repeater에서는 멈춘다(템플릿 자식은 repeater 조각의 paint만 그린다).

### 4.5 반복 표현식 변수

| 변수 | 범위 | 뜻 |
|---|---|---|
| `row` | 표 행·그룹 행 | 현재 행 |
| `item` | 반복 영역 항목·그룹 | 현재 항목 |
| `index` | 행·항목 | 소스 배열 안의 0부터 순번. 그룹·페이지·grid 줄에서 초기화하지 않는다 |
| `group.key`, `group.rows`, `group.index`, `group.level`, `group.rowIndex` | 그룹 머리·소계와 그 안의 행 | 현재(가장 안쪽) 그룹. `index`는 같은 바깥 그룹 안에서 0부터 센 이 그룹의 순번(바깥 그룹이 바뀌면 0으로 돌아감, 최상위 그룹은 소스 전체 기준). `level`은 0부터. `rowIndex`는 행·항목 범위에서만 있으며 가장 안쪽 그룹 안의 0부터 순번 |
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

- `sample.data`는 순수 JSON 값만 담는다(날짜는 ISO 8601 문자열).
- static 데이터셋은 `sample.data`에 넣지 않는다(sample 응답에서도 제외). static은 항상 레포트의 `rows` 전체를 쓴다.
- 캔버스도 `sample.data` 값마다 core `normalizeRows`(6.1)를 쓰고, 오류는 빈 배열로 둔다.
- 비static 데이터셋은 앞 200행만 저장되므로 키 연결·합계·페이지 수는 실데이터와 다를 수 있다(7.1의 잘림 표시).

### 4.7 데이터셋 스키마 (변경분)

```jsonc
{ "name": "orders", "type": "http", "method": "GET",
  "url": "https://mes.example.com/api/orders/{{ params.orderNo }}",
  "headers": { "Authorization": "Bearer {{ secrets.MES_TOKEN }}" },
  "body": { "lot": "{{ params.lot }}" },       // POST일 때만. JSON 값(문자열 아님)
  "rowsPath": "data.items" }                    // 점 경로. 생략 시 응답 루트
{ "name": "items", "type": "sql", "connection": "mes", "query": "SELECT ... WHERE ORDER_NO = :orderNo" }
```

- `url`은 scheme·host·port를 리터럴로 쓰고 템플릿은 경로·쿼리에만 둔다. 템플릿 값은 `encodeURIComponent`로 인코딩하고, 경로 자리에 들어간 값이 `.`·`..`이면 `BAD_PARAM`이다.
- 헤더 템플릿 값에 CR·LF가 있으면 `BAD_PARAM`이다.
- `body`는 JSON 값이다. 문자열 잎마다 `evaluateTemplateValue`로 평가하고(단독 `{{ }}`는 원래 타입 유지) `JSON.stringify`로 보내며, `content-type: application/json`을 기본으로 붙인다. 따라서 따옴표가 든 값도 JSON 문자열 안에서 이스케이프된다.
- `secrets.이름`은 표현식이 아니라 헤더 값·본문 문자열 잎에만 쓰는 치환 토큰이다(6.4). `url`에 있거나 식 안에 섞인 `secrets` 참조(`{{ secrets.X[0] }}`, `{{ a + secrets.X }}` 등)는 데이터셋 스키마 오류다.

#### 4.7.1 이름 규칙

- 데이터셋 `name`, 요청 `data`의 키, `repeat.as`는 식별자(`^[A-Za-z_$][A-Za-z0-9_$]*$`)여야 한다.
- 예약어와 같을 수 없다: `params secrets record row item index group rows pageRows page total sheet sheets copy copies constructor prototype __proto__`. 단 `repeat.as`의 기본값 `record`는 허용한다.
- 데이터셋 이름과 요청 `data` 키는 `repeat.as` 값과도 같을 수 없다.
- 데이터셋 이름·`repeat.as`가 규칙을 어기면 스키마 오류다(스튜디오 7.1의 이름 변경에서도 검사). 요청 `data` 키가 어기면 400 `{ error, code: "BAD_DATA_KEY", key }`(6.1).
- 필드 키에는 제약이 없다. 식별자가 아닌 키는 `row["품목"]`처럼 읽고, 드래그 바인딩은 대괄호 경로를 만든다(7.2).

### 4.8 필드 추론: `inferFields(rows, { sampleSize = 200 })`

- 앞 200행의 키를 합친다. 타입: `string | number | boolean | date | object | array | null`.
- 문자열은 `^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$`에 맞고 실제 달력 날짜일 때만 `date`로 본다(`Date.parse`로 판정하지 않는다). 연도만·연월·구분자 없는 형식·숫자 문자열은 `string`이다. `Date` 값도 `date`다. 한 키에 타입이 섞이면 `null`이 아닌 가장 흔한 타입, 동률이면 `string`.
- `object`는 하위 필드를, `array`는 원소 객체들의 하위 필드를 재귀로 가진다(깊이 5까지).
- 결과: `{ name, path, type, children? }[]`. 순수 함수이며 core에 둔다.
- `path`는 문자열 세그먼트 배열이다. 배열 원소는 세그먼트를 만들지 않는다(`items`의 원소 필드 `QTY` → `["items","QTY"]`).

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
- **반복 영역**: `list`는 항목마다 `row` 조각, `grid`는 한 줄마다 `row` 조각(여러 항목을 담음). 그룹 머리·소계는 해당 템플릿 높이의 조각. 조각 높이에 gap은 넣지 않는다(4.4).
- `paint`는 페이지 조립 시 호출되며 `pageRows`·`page`·`total` 등 페이지 의존 값을 받는다. 조각 높이는 페이지 의존 값에 영향받지 않는다(페이지 번호 텍스트가 줄 수를 바꾸는 경우도 높이는 조각 생성 시 값으로 고정).
- 높이 측정 컨텍스트: 조각 생성(높이 측정) 시 평가 컨텍스트는 `page=1, total=1, sheet=1, sheets=1, copy=현재 부, copies=부 수, pageRows=rows`(소스 배열 전체)로 고정한다. 페이지 소계 템플릿의 높이도 이 컨텍스트로 잰다.
- 평가 재사용: 셀·항목 텍스트는 조각 생성 시 한 번 평가해 높이와 `paint`에 함께 쓴다. `paint`는 `page`·`total`·`sheet`·`sheets`·`copy`·`copies`·`pageRows`를 참조하는 식만 실제 `PageFlowContext`로 다시 평가·줄바꿈하되 높이는 조각 높이를 쓴다. 줄이 넘치면 1단계 text 항목 규칙대로 `PlacedText.overflow: true`를 표시한다.

### 5.2 페이지 나누기: `paginate(blocks, regions)`

입력: 조각 목록, 첫 페이지 영역 `{x, y, w, h}`, 이어지는 페이지 영역. 출력: 페이지마다 `{ blocks: {block, y}[] , pageRows }`.

영역 높이와 가용 높이:

- 이어지는 페이지 영역: 원래 x, y, w를 유지하고 높이 = `max(0, B - y)`. `B = min(page.height - margin.bottom, 이 흐름 요소의 템플릿 하단(y+h) 이상에 y가 있고 가로 범위가 겹치는 flow: every·last 고정 요소들의 y)`. 마지막 페이지를 미리 알 수 없으므로 `last` 요소 자리도 모든 이어지는 페이지에서 비워 둔다. 계산은 템플릿 좌표(flatten 후, 5.3-6)만 쓴다. 다른 흐름 요소는 B 계산에 넣지 않는다(흐름 요소끼리 겹침은 허용, 11장 pushDown).
- 페이지 p의 가용 높이 `avail(p)` = 그 페이지 영역 높이 − 그 페이지에 두는 머리행 높이 − pageFooter 높이. 아래 규칙 4·5의 "빈 페이지"는 그 조각(묶음)이 놓일 현재 페이지의 `avail(p)`다.
- 진행 보장: 머리행을 빼고 아직 조각이 없는 페이지에서는 조각이 안 들어가도 새 페이지로 넘기지 않는다. 그 자리에 단독으로 두고 규칙 5를 적용한다. 따라서 paginate는 조각마다 최대 한 번만 페이지를 넘긴다.

규칙:

1. `header` 조각은 첫 페이지 맨 위에 둔다. `repeatHeader`면 이어지는 페이지마다 맨 위에 다시 둔다.
2. `pageFooter` 템플릿이 있으면 각 페이지 영역 하단에 그 높이만큼 자리를 예약하고, 페이지 조각 배치가 끝난 뒤 그 페이지의 `pageRows`로 칠한다. pageFooter는 영역 하단(`영역 y + 영역 h − pageFooter 높이`)에 고정해 칠한다. 마지막 페이지의 `footer`는 행 뒤, 예약분 위에 온다. row 조각이 없는 페이지(`pageRows = []`)에도 칠한다.
3. 나머지 조각을 순서대로 쌓는다. 남은 높이 < 조각 높이면 새 페이지로 넘어간다.
4. `keepWithNext` 조각은 바로 뒤 조각까지 같은 페이지에 들어가지 못하면 함께 다음 페이지로 넘어간다. 연쇄(바깥·안쪽 그룹 머리 연속)도 같은 규칙으로 묶는다. 묶음 전체가 빈 페이지에도 안 들어가면 묶음을 풀고 3번 규칙으로 쌓는다.
5. 조각 하나가 빈 페이지의 `avail(p)`보다 크면 그 페이지에 단독으로 두고 잘림 경계에서 잘린다. 무한 페이지 생성을 막는다.
   - 표시: 그 흐름 요소의 그 페이지 flowBox 항목(5.4)에 `blockOverflow: true`를 둔다. 1단계 `PlacedText.overflow`(텍스트가 상자를 넘침)와는 다른 필드다.
   - 잘림 경계 = 영역 하단 − pageFooter 예약 높이. 경계 아래에서 시작하는 항목은 넣지 않는다. 경계에 걸친 항목에는 `clip: {x, y, w, h}`(페이지 mm 좌표, 경계 안 사각형)를 준다. 페인트는 5.4의 래퍼로 자른다.
6. `overflow: "clip"`이면 규칙 1~5를 첫 영역 한 페이지에만 적용한다.
   - 들어가지 않는 첫 조각(또는 keepWithNext 묶음)에서 멈추고, 그 조각과 뒤의 모든 조각을 크기와 상관없이 버린다(뒤의 작은 조각으로 채우지 않는다).
   - 머리행이 아닌 첫 조각이 빈 영역보다 크면 규칙 5로 잘라 둔다.
   - `footer`는 모든 행이 놓였고 자리가 있을 때만 둔다. 새 페이지는 만들지 않는다.
   - 버린 조각이 하나라도 있으면 그 요소의 flowBox 항목에 `clipped: true`를 둔다.
7. `footer`는 마지막 페이지의 마지막 row 조각 뒤(row 조각이 없으면 header 뒤)에 둔다. 자리가 없으면 새 페이지로 넘긴다(`continue`만).
8. 영역이 너무 작음: 흐름 요소의 첫 영역 또는 이어지는 영역 중 하나라도 `avail ≤ 0`이면 paginate하지 않는다. 5.5 소스 오류처럼 첫 영역에 `#ERR` 한 칸(사유 `region too small for header/pageFooter`)을 두고 페이지 수는 1로 친다. clip 표·반복 영역은 첫 영역으로 같은 검사를 한다. 이 검사를 통과하면 진행 보장과 규칙 5로 항상 끝난다.
9. 0건: 행 0건인 표는 header(1회)·footer·pageFooter(`pageRows = []`)를 그리고 페이지는 1장이다. 항목 0건인 반복 영역은 아무것도 그리지 않고(flowBox만 둔다) 페이지 1장으로 센다. 캔버스의 0건 템플릿 자리는 7.4.
10. 반복 영역 간격: 같은 페이지에서 이어지는 두 반복 영역 조각 사이에만 `gap[1]`을 더한다(4.4). 페이지 첫 조각 앞에는 넣지 않는다. 표 조각에는 gap이 없다.

### 5.3 페이지 조립

1. 페이지 템플릿의 흐름 요소(`table` `overflow: continue`, `repeater` `overflow: continue`)를 각자 `paginate`한다. 부의 페이지 수 = max(흐름 요소별 페이지 수, 1).
2. 페이지 i마다: 고정 요소를 `flow` 규칙(once는 첫 페이지, every는 모든 페이지, last는 마지막 페이지)으로 고르고, 흐름 요소는 i번째 조각 배치를 `paint`한다. 흐름 요소의 페이지 수가 전체보다 짧으면 그 뒤 페이지에는 해당 요소가 없다.
3. 흐름 요소 자체의 `flow` 값은 무시한다(흐름 요소는 자기 페이지에만 나온다). `overflow: "clip"`인 표·반복 영역은 흐름 요소가 아니라 고정 요소로 취급해 `flow` 규칙을 따르고, 나오는 페이지마다 첫 영역에 들어가는 조각까지만 그린다(`pageRows`는 그 조각들의 행).
4. `repeat`가 있으면 레코드마다 1을 수행해 페이지 배치만 확정하고 이어 붙인다. 고정 요소 칠하기와 흐름 요소 `paint`는 모두 전체 페이지 수(`sheets`)가 확정된 뒤 수행한다(`repeat`가 없어도 같은 순서).
5. 전체 페이지 수가 `MAX_PAGES`(기본 2000)를 넘으면 `LayoutLimitError`를 던진다. 부마다 배치를 이어 붙일 때 누적 페이지 수로 검사해 넘는 즉시 멈춘다.
6. 흐름 요소·고정 요소는 flatten 후(그룹 좌표 반영, 깊이 무관) 판정한다. 그룹 안의 `continue` 표·반복 영역도 흐름 요소다. 고정 요소가 나오는 페이지 = 자기 `flow`와 모든 조상 그룹 `flow`가 허용하는 페이지의 교집합(visible의 AND와 같은 방식). 흐름 요소는 자기·조상 `flow`를 모두 무시한다.
7. 흐름 요소의 `visible`(조상 포함)은 부마다 paginate 전에 한 번 평가하며, 이때 `page`·`total`·`sheet`·`sheets`는 `undefined`다. 거짓이면 페이지 수 0으로 보고 그리지 않는다. 고정 요소 `visible`은 페이지마다 평가한다.
8. 페이지의 `items` 순서(z순서)는 flatten 문서 순서이며, 흐름 요소의 항목은 그 요소 자리에 연속으로 넣는다(flowBox rect가 먼저).

### 5.4 배치 항목 확장

- `PlacedBase`에 선택 필드를 추가한다: `instance?: string`, `role?: "flowBox" | "cell" | "border"`, `clip?: {x, y, w, h}`, `blockOverflow?: boolean`, `clipped?: boolean`. `PlacedText.overflow`는 1단계 뜻(텍스트가 상자를 넘침) 그대로다.
- `Page`에 `copy`, `copies`(1부터, `repeat`가 없으면 1), `pageInCopy`, `pagesInCopy`를 추가한다(캔버스 부 선택기용).
- instance 형식(유일 규칙): 표·반복 영역(overflow가 continue든 clip이든)에서 나온 모든 항목은 instance를 가진다. 반복으로 생긴 항목도 템플릿 요소 id를 `elementId`에 유지한다.
  - instance는 세그먼트를 `/`로 잇는다. 세그먼트는 `<요소id>#<부분>`이다.
  - 부분: 데이터 행·항목(grid 포함) `r<index>`, 머리행 `h`, 그룹 머리 `gh<level>.<group.index>`, 그룹 소계 `gf<level>.<group.index>`, 페이지 소계 `pf`, 합계 `f`.
  - 표 셀은 뒤에 `/c<열순번>`, 테두리 선은 `/b<순번>`을 붙이고, flowBox는 `<요소id>#box`다. 예: `t1#r3/c2`, `t1#h/b0`(행에 속하지 않는 선은 `t1#b<순번>`), `cards#r5`(항목 자식의 elementId는 템플릿 자식 id), `cards#r5/t2#r0/c1`(항목 안 clip 표).
  - 한 페이지 안에서 `(elementId, instance)` 쌍은 유일하다. 그 밖의 고정 요소 항목은 instance가 없고 elementId로 유일하다.
  - React key는 `` `${elementId}|${instance ?? ""}` ``이고, Paint는 `data-instance` 속성을 함께 낸다.
- 표 셀·테두리는 기존 kind(`text`, `line`, `rect`)로 표현한다(새 kind를 만들지 않는다). 표·반복 영역마다 페이지별로 선택·히트용 `rect` 항목(`role: "flowBox"`, 채움·선 없음)을 하나 두고, 그 요소의 다른 항목보다 먼저 넣는다. flowBox 좌표는 그 페이지에서 흐름 요소에 주어진 영역이다(첫 페이지·clip 요소는 템플릿 x·y·w·h, 이어지는 페이지는 5.2의 이어지는 영역).
- 잘림 페인트: `clip`이 있는 항목은 clip 위치의 `position:absolute; overflow:hidden` 래퍼 div로 감싸고, 안쪽 좌표는 래퍼 기준으로 옮긴다.
- `blockOverflow`·`clipped`(flowBox에)와 `error`는 문제 목록에 올릴 수 있게 항목에 남긴다.

### 5.5 오류와 성능

- 셀·항목 표현식 오류는 그 셀·항목 자식만 `#ERR`로 격리한다(1단계와 같은 `onExpressionError` 규칙. 캔버스는 항상 blank).
- 소스 표현식 오류·배열 아님은 흐름 요소 전체를 `#ERR` 한 칸으로 둔다.
- core `evaluate`는 컴파일 결과와 `guardAst` 결과를 표현식 문자열 키로 캐시한다(금지 식별자 검사는 매 호출 수행).
- 셀 텍스트는 조각 생성 시 한 번 평가해 높이와 `paint`에 재사용한다. `paint`는 페이지 의존 변수를 쓰는 식만 다시 평가한다(5.1).
- 줄바꿈 측정은 `(text, fontSize, bold, 안쪽 너비)` 키로 레이아웃 호출 단위 캐시를 둔다.
- 벤치마크 형태: 행 1만 건, 6열(`formatNumber`·`formatDate` 포함), 그룹 1단계와 소계, 페이지 소계, 표 합계. `layout()`이 돌아올 때까지 잰다. 목표: 1초 이내(개발 머신 기준, CI에서는 3초 허용).

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
- 요청 `data`는 일반 객체여야 한다(아니면 라우트가 400 `{ error }`). 키는 4.7.1 이름 규칙을 따라야 하며, 어기면 라우트가 400 `{ error, code: "BAD_DATA_KEY", key }`를 반환한다.
- 데이터셋마다: `Object.hasOwn(data, name)`이면 그 값을 core `normalizeRows(value)`로 바꾼다. 배열 → 그대로, 일반 객체 → `[객체]`, `null` → `[]`, 그 밖(문자열·숫자·불리언) → 오류 code `BAD_DATA`이고 컨텍스트에는 `rowsProxy([])`. 키가 없으면 type별 실행. `data`에만 있는 이름도 같은 규칙으로 넣는다.
- 컨텍스트는 core 순수 함수 `buildContext(report, { params, data })`로 만든다(캔버스와 공유, 7.4). executeDatasets는 실행 결과를 요청 `data`에 없는 이름으로만 더한 `data`를 넘긴다. 병합 규칙: `data[name]`이 이기고, 없으면 static은 레포트 `rows`, http·sql은 `[]`. 모든 배열은 core `rowsProxy`로 감싼다(1단계와 같은 `ds.FIELD` 접근). 컨텍스트 객체는 `Object.create(null)`로 만들고 `params`를 마지막에 쓴다.
- 실행 순서: 데이터셋은 `Promise.all`로 병렬 실행하며 데이터셋끼리 참조하지 않는다. `Limits`에 `totalTimeoutMs`(기본 25000, 항상 라우트 `maxDuration`보다 작게)를 둔다. 데이터셋마다 신호는 `AbortSignal.any([AbortSignal.timeout(timeoutMs), 전체 마감])`이고, 어느 쪽을 넘어도 `TIMEOUT`이다.
- 실패는 `errors`에 `{ dataset, message, code }`로 모은다. `code`: `TIMEOUT | HOST_NOT_ALLOWED | HTTP_STATUS | BAD_JSON | ROWS_PATH | TOO_LARGE | TOO_MANY_ROWS | BAD_PARAM | BAD_DATA | BIND_MISSING | SQL_NOT_CONFIGURED | SQL_ERROR`. `message`는 코드별 고정 문구에 데이터셋 이름과 HTTP 상태 번호만 넣고, URL·헤더·응답 본문은 넣지 않는다. 호출자가 실패를 치명으로 볼지 정한다(미리보기·PDF는 치명, 샘플은 부분 허용).

### 6.2 http 커넥터

- 기본 구현은 전역 `fetch`를 쓴다. 테스트에서는 가짜 fetch를 주입한다.
- 호스트 허용 목록: 환경변수 `DAPORT_HTTP_ALLOW`(쉼표 구분). 항목은 `host[:port]` 또는 `host[:port]=NAME1|NAME2`(그 호스트로 보낼 수 있는 비밀값 이름, 6.4)다. 비어 있으면 모든 http 데이터셋이 `HOST_NOT_ALLOWED`. 리다이렉트는 따라가지 않는다(`redirect: "manual"`, 3xx는 `HTTP_STATUS`).
- 허용 검사: 템플릿을 평가한 뒤(비밀값을 넣기 전)의 최종 URL을 `new URL()`로 파싱해 한다(파싱 실패는 `HOST_NOT_ALLOWED`).
  - scheme은 `http:`·`https:`만 허용하고 userinfo가 있으면 거부한다.
  - 비교 키는 `hostname`(소문자, 끝 점 제거)과 포트다. URL에 포트가 없으면 scheme 기본 포트(80/443)를 채운다.
  - 목록 항목은 hostname만 같은 방식(소문자, 끝 점 제거, IPv6 대괄호)으로 정규화하고 포트는 채우지 않는다. 포트 없는 항목은 모든 포트를 허용하고, host:port 항목은 URL의 (기본 포트를 채운) 포트와 같을 때만 허용한다. IPv6는 `[addr]:port`로 적는다.
  - 와일드카드는 없고 DNS 해석 결과(사설 IP 여부)는 검사하지 않는다.
- 한도: 데이터셋 타임아웃 30초와 전체 마감 `totalTimeoutMs`(6.1), 응답 20MB(스트림을 읽으며 초과 시 중단), 1만 행.
- `rowsPath`는 점 경로(`data.items`). 세그먼트마다 `Object.hasOwn`으로만 읽고, 숫자 세그먼트는 배열 인덱스다. 없는 세그먼트나 예약 키(`constructor`·`prototype`·`__proto__`)는 `ROWS_PATH`. 결과가 배열이 아니면 객체는 `[객체]`로 감싸고 그 밖은 `ROWS_PATH`.

### 6.3 SQL 커넥터 규격

```ts
type FieldType = "string" | "number" | "boolean" | "date" | "object" | "array" | "null";
interface SqlConnector {
  query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number; signal?: AbortSignal })
    : Promise<{ rows: Record<string, unknown>[]; columns: { name: string; type: FieldType }[] }>;
}
```

- 바인드 추출: `extractBinds(sql): string[]`는 작은따옴표 문자열(`''` 이스케이프 포함), `q'[..]'` 류 인용 문자열, 큰따옴표 식별자, `--` 줄 주석, `/* */` 주석 안을 건너뛴다. `::`는 바인드가 아니다. 이름 규칙은 `:[A-Za-z][A-Za-z0-9_$#]*`(대소문자 구분 없이 비교)이고, 처음 나온 순서로 중복을 제거한다.
- 추출된 이름이 `report.params`에 선언돼 있지 않으면 커넥터를 호출하지 않고 `BIND_MISSING`으로 처리한다. binds에는 추출된 이름만 넣고, 값이 `undefined`면 `null`로 넘긴다. 문자열 결합은 하지 않는다.
- binds 키는 SQL에 처음 나온 표기를 쓰고, 값은 report.params 이름을 대소문자 구분 없이 찾아 얻는다. 대소문자만 다른 params가 둘 이상 맞으면 BIND_MISSING이다.
- `connectors.sql[dataset.connection]`이 없으면 `SQL_NOT_CONFIGURED`.
- 결과는 **순수 JSON**이어야 한다(날짜는 ISO 8601 문자열, 큰 수는 문자열 허용). 나중에 공장 내부 중계 에이전트가 같은 규격을 HTTP로 전달할 수 있게 하기 위해서다(`docs/superpowers/research/2026-09-17-oracle-connectivity.md`). 직접 연결인지 에이전트인지는 이후 단계의 연결 설정(`via`)이 정하며 데이터셋 스키마는 바뀌지 않는다.
- 2단계 구현물은 규격, 바인드 추출 함수, 가짜 커넥터 기반 테스트뿐이다.

### 6.4 비밀값

- `secrets.이름`은 `DAPORT_SECRET_<이름>` 환경변수에서만 읽는다. 이름은 `[A-Z0-9_]+`.
- 비밀값은 어떤 표현식 컨텍스트에도 없다. 헤더 값과 본문 문자열 잎에서만 `{{ secrets.NAME }}` 토큰을 비밀값 문자열로 바꿔 넣는다. 치환은 원본 템플릿 문자열에서만 한다. 평가 전에 원본에서 `\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}` 토큰 위치를 표시해 두고 표현식 평가에서 뺀다. 평가 결과 값에 들어 있는 `{{ secrets.* }}` 글자는 치환하지 않고 그대로 보낸다. `url`에 있거나 식 안에 섞인 `secrets` 참조는 데이터셋 스키마 오류다(4.7).
- 비밀값은 `DAPORT_HTTP_ALLOW`에서 자기 이름이 묶인 호스트로만 보낸다(6.2). 묶이지 않은 호스트로 가는 요청에 비밀값 토큰이 있으면 요청을 보내지 않고 `HOST_NOT_ALLOWED`.
- 레이아웃 컨텍스트·샘플·응답·오류 메시지에는 비밀값을 넣지 않는다. 오류 메시지는 고정 문구(6.1)이며, 추가 방어로 비밀값 문자열이 섞이면 `***`로 치환한다.

### 6.5 요청 데이터 한도

- preview·pdf·sample 라우트의 본문 한도는 `DAPORT_MAX_BODY_BYTES`(기본 4MB, 배포 플랫폼 요청 한도 이하)다.
- `content-length`가 한도를 넘으면 읽기 전에 413을 반환한다. 그 밖에는 `req.json()`·`req.text()`로 한꺼번에 읽지 않고 `req.body` 스트림을 누적 바이트로 세며 읽다가, 초과 즉시 중단하고 413 `{ error, code: "TOO_LARGE" }`를 반환한다.

## 7. 스튜디오 (apps/studio)

### 7.1 데이터 패널 (왼쪽 패널 탭)

- **파라미터**: 레포트 `params` 목록과 샘플 실행용 값 입력. 값은 `sample.params`에 저장된다.
- **데이터셋 목록**: 추가(static·http), 삭제, 이름 변경(4.7.1 이름 규칙 검사). static은 JSON 붙여넣기 입력, http는 method·url·headers·body·rowsPath 폼. sql 데이터셋은 목록에 "커넥터 미설정"으로 표시하고 JSON 편집기에서만 고친다.
- **샘플 가져오기**: `POST /api/reports/:id/sample` 호출 → 성공한 데이터셋 결과를 `sample.data`에 반영(되돌리기 가능한 편집 1건), 실패한 데이터셋은 사유를 패널에 표시. static 데이터셋은 대상이 아니다(4.6). 응답의 `truncated`에 데이터셋이 있으면 패널에 "앞 200행만 저장됨: 키 연결·합계·페이지 수는 실데이터로 확인"을 표시한다.
- **필드 트리**: 비static은 `inferFields(sample.data[이름])`, static은 `inferFields(레포트 rows)` 결과. 타입 아이콘, 배열·객체 펼침.

### 7.2 필드 드래그 바인딩

| 놓는 곳 | 결과 |
|---|---|
| 빈 캔버스 | 텍스트 요소 `{{ <데이터셋>.<경로> }}`. 레포트에 `repeat`가 있고 필드가 repeat 소스(아래 소스 해석)의 것이면 `{{ <repeat.as>.<상대 경로> }}` |
| 표 영역 | 열 추가 `{{ row.<경로> }}` (표 소스 기준 상대 경로) |
| 반복 영역 템플릿 항목 | 항목 안 텍스트 `{{ item.<경로> }}` |
| 배열 노드를 빈 캔버스 | 원소 필드마다 열 하나인 표 생성(최대 8열, 너비 균등) |

소스 기준 상대 경로를 알 수 없는 필드(다른 데이터셋의 필드를 표에 놓음)는 전체 경로로 넣고 문제 목록에 "표 소스와 다른 데이터셋"을 경고한다.

- 식 만들기: 필드 `path`(4.8, 세그먼트 배열)와 데이터셋 이름을 잇는다. 식별자(`[A-Za-z_$][A-Za-z0-9_$]*`)인 세그먼트는 `.이름`, 아니면 `["이름"]`(JSON 문자열 이스케이프)으로 잇는다. 예: `row["단가"]`, `row["unit-price"]`.
- 소스 해석: 소스 식 끝의 필터 `[...]`를 벗긴다. 남은 식이 식별자 체인이면, 첫 이름이 `repeat.as`일 때는 repeat 소스의 해석 결과(데이터셋, 접두 경로) 뒤에 나머지 체인을 잇고, 아니면 첫 이름이 데이터셋이고 나머지가 접두 경로다. 필드 경로가 그 데이터셋·접두 경로로 시작하면 접두를 뺀 상대 경로를 쓴다. 해석할 수 없거나(함수 호출 등) 접두가 다르면 전체 경로를 넣고 위 경고를 낸다.

### 7.3 표·반복 영역·레포트 반복 편집

- 표 속성: 소스 표현식, 열(추가·삭제·위아래 이동·머리글·값·너비·정렬), 최소 행 높이, 머리행 높이, 헤더 반복, 테두리, 그룹(기준·머리 셀·소계 셀 추가/삭제), 페이지 소계, 표 합계.
- 반복 영역: 팔레트에 추가. 캔버스에서 **첫 항목 자리가 템플릿 편집 영역**(파란 점선 테두리)이고, 템플릿 자식은 그룹 자식과 같은 방식으로 선택·이동·리사이즈한다. 나머지 항목은 샘플 데이터로 흐리게(opacity 0.5) 그린다. 흐린 항목의 자식을 클릭하면 템플릿의 같은 요소가 선택된다. 속성: 소스, layout, gap, 항목 크기, 그룹(기준·머리·소계 높이; 머리·소계 자식은 JSON 편집기에서 편집).
- 레포트 반복: 페이지 패널에 "레코드마다 한 부씩" 스위치와 소스 표현식 입력.

### 7.4 캔버스 페이지·부 선택

- 캔버스는 `layout(report(onExpressionError=blank), 캔버스 컨텍스트)` 결과에서 선택된 페이지 하나를 그린다.
- 캔버스 컨텍스트는 core `buildContext(report, { params, data })`로 만든다(6.1과 같은 병합).
  - `params = resolveParams(report, { ...sampleParams(report), ...sample?.params }, { checkRequired: false })`.
  - `data` = `sample?.data`에서 static 데이터셋 이름을 뺀 값. 따라서 static은 레포트 rows 전체, 비static은 `sample.data[이름]`(없으면 `[]`)이고, 값마다 `normalizeRows`(오류는 `[]`)를 거쳐 `rowsProxy`로 감싼다.
  - `sample`이 없는 1단계 레포트도 static 데이터로 그려진다.
- 툴바에 페이지 선택기(◀ n / N ▶). `repeat`가 있으면 부 선택기(◀ c / C ▶)가 추가된다. 부·부 안 페이지는 `Page.copy`·`copies`·`pageInCopy`·`pagesInCopy`(5.4)로 찾는다. 편집으로 페이지 수가 줄면 마지막 페이지로 조정한다.
- 흐름 요소가 없는 페이지에서도 고정 요소는 편집할 수 있다. 선택·드래그는 1단계 규칙을 따르되 다음을 더한다.
  - 히트한 항목은 `elementId`만이 아니라 `(elementId, instance)`로 찾는다(5.4의 유일 규칙).
  - flowBox(`role: "flowBox"`)는 "채움 없는 rect는 히트하지 않는다" 규칙에서 제외한다. 표·반복 영역의 셀·항목을 클릭하면 그 표·반복 영역이 선택되고, 선택 상자는 현재 페이지의 flowBox다. 리사이즈·이동은 첫 페이지 flowBox 좌표(= 템플릿 x·y·w·h)만 템플릿 요소에 쓴다.
  - 반복 영역 템플릿 자식의 선택 상자는 첫 항목 인스턴스(`<repeater id>#r0` 세그먼트)의 항목을 쓴다. 다른 인스턴스 항목을 클릭하면 같은 elementId의 템플릿 요소로 매핑한다. 현재 페이지에 `#r0`가 없으면 그 페이지에서 가장 앞 인스턴스의 항목을 선택 상자로 쓴다. 리사이즈·이동은 항목 기준 상대좌표로 템플릿에 쓴다.
  - 행 0건일 때도 캔버스 레이아웃(캔버스 전용 옵션)은 반복 영역 첫 항목 자리에 데이터 없는 템플릿 슬롯(`#r0`)을 그려 편집할 수 있게 한다. 미리보기·PDF에는 영향이 없다(5.2 규칙 9).

### 7.5 API

| 경로 | 본문 | 응답 |
|---|---|---|
| `POST /api/reports/:id/preview` | `{ report?, params?, data? }` | HTML. 데이터셋 오류 시 `{ error, datasetErrors }`: 모든 오류가 `TIMEOUT`이면 504, 아니면 400 |
| `POST /api/reports/:id/pdf` | 같음 | PDF. 오류 규칙 같음 |
| `POST /api/reports/:id/sample` (신규) | `{ report?, params }` | `{ data, fields, errors, capturedAt, truncated }`. `data`는 비static 데이터셋마다 앞 200행, `truncated`는 `{ 이름: 원래 행 수 }`(잘린 데이터셋만) |

- 편집 중 미리보기·PDF는 `sample`을 뺀 report, 캔버스와 같은 병합의 `params`(7.4), `data`(= `sample.data`의 비static 데이터셋만)를 보내 서버 데이터셋 실행 없이 그린다. static은 서버에서도 레포트 rows를 쓴다. 툴바에 "실데이터로" 토글을 두어 켜면 `data` 없이 보낸다.
- 레이아웃 한도 초과는 400 `{ error, code: "LAYOUT_LIMIT" }`, 본문 한도 초과는 413 `{ error, code: "TOO_LARGE" }`(6.5), 요청 `data`가 객체가 아니면 400, 키가 이름 규칙을 어기면 400 `BAD_DATA_KEY`(6.1).
- 데이터셋 오류의 504/400 구분은 1단계 스펙 10장의 "쿼리 오류 400, 타임아웃 504" 규칙을 대체한다.

## 8. 오류 처리 요약

| 상황 | 처리 |
|---|---|
| 데이터셋 실행 실패 | 미리보기·PDF: 모든 오류가 `TIMEOUT`이면 504, 아니면 400. 둘 다 `datasetErrors` 포함(1단계 10장 400/504 규칙 대체). 샘플은 성공분 저장, 실패분 사유 표시 |
| 전체 마감(`totalTimeoutMs`) 초과 | 남은 데이터셋 `TIMEOUT` |
| 소스가 배열 아님·소스 표현식 오류 | 해당 흐름 요소 자리 `#ERR` |
| 흐름 요소 영역이 머리행·페이지 소계보다 작음(`avail ≤ 0`) | 첫 영역에 `#ERR` 한 칸(`region too small for header/pageFooter`), 페이지 1 |
| 셀·항목 표현식 오류 | 해당 셀·항목만 `#ERR` |
| 조각이 빈 페이지보다 큼 | 잘림 경계에서 잘라 단독 배치, flowBox에 `blockOverflow` 표시, 캔버스 문제 목록 |
| clip 요소에서 버린 조각 | flowBox에 `clipped` 표시, 캔버스 문제 목록 |
| 페이지 상한 초과 | 400 `LAYOUT_LIMIT` |
| 요청 본문 한도(`DAPORT_MAX_BODY_BYTES`) 초과 | 413 `TOO_LARGE` |
| 요청 `data`가 객체 아님 / 키가 이름 규칙 위반 | 400 / 400 `BAD_DATA_KEY` |
| 요청 `data` 값이 배열·객체·null이 아님 | `BAD_DATA` (데이터셋 오류, 컨텍스트는 빈 배열) |
| 데이터셋 이름·`repeat.as` 규칙 위반, url·식 안의 `secrets` 참조 | 레포트 스키마 오류 |
| 허용 안 된 http 호스트, 묶이지 않은 호스트로 가는 비밀값 | `HOST_NOT_ALLOWED` (데이터셋 오류) |
| URL 경로 값 `.`·`..`, 헤더 값 CR·LF | `BAD_PARAM` (데이터셋 오류) |
| SQL 바인드 이름이 `report.params`에 없음 | `BIND_MISSING` (데이터셋 오류, 커넥터 호출 안 함) |

## 9. 테스트

- **core**: 스키마(repeat, repeater 제약, 표 확장·스타일 병합 순서, sample, http·sql 데이터셋, body JSON 값, url·식 안 `secrets` 거부, 4.7.1 이름·예약어), `childLists`(id 유일성 검사가 템플릿 자식까지 내려감), `inferFields`(날짜 정규식: 연도만·연월·숫자 문자열은 string, 없는 날짜는 string, `path` 세그먼트), `normalizeRows`, `buildContext`(data 우선, static rows, 비static `[]`, `Object.create(null)`, params 마지막), `avg/min/max`, jexl 필터 소스 표현식, `evaluate` 컴파일 캐시.
- **renderer 흐름 엔진 불변식(속성 기반)**: 무작위 행 높이·그룹 키·영역 높이(0에 가까운 영역, 머리행이 큰 경우 포함)로 반복 실행해 확인한다.
  - paginate가 항상 끝난다. continue 요소이고 규칙 8에 걸리지 않으면 모든 행이 정확히 한 번, 원래 순서대로 배치된다. clip 요소는 놓인 행이 원래 순서의 앞부분(prefix)이다.
  - 조각이 잘림 경계(영역 하단 − pageFooter 예약)를 넘지 않는다(5.2의 5번 예외만 flowBox `blockOverflow` 표시와 `clip`과 함께 허용).
  - 첫 영역이나 이어지는 영역의 `avail ≤ 0`이면 `#ERR` 한 칸, 페이지 1이다(5.2 규칙 8).
  - 한 페이지 안에서 `(elementId, instance)` 쌍이 유일하다.
  - `repeatHeader`면 모든 페이지 첫 조각이 머리행이다.
  - `keepWithNext` 조각이 페이지 마지막 조각이 아니다(5.2의 4번 예외 제외).
  - 페이지 소계의 `pageRows`가 그 페이지 `row` 조각들의 행 합집합과 같다.
  - 무작위 생성기는 시드 고정(재현 가능).
- **renderer 단위**: 그룹 중첩(`group.index`가 바깥 그룹마다 0으로 돌아감, `group.rowIndex`, `index`는 초기화 안 됨), 그룹 머리 연쇄 keepWithNext, grid 한 줄 개수, grid + 그룹(그룹 머리 앞에서 줄이 끊기고 새 줄에서 시작, 그룹이 페이지를 넘김), 반복 영역 gap(페이지 첫 조각 앞에는 없음), clip(첫 불일치에서 멈춤, footer 생략, `clipped`), 잘림 경계와 `clip` 래퍼, 행 0건 표(header·footer·pageFooter, 페이지 1)와 항목 0건 반복 영역, pageFooter 하단 고정·행 없는 페이지의 페이지 소계, 이어지는 페이지 조각이 아래쪽 every·last 고정 요소와 겹치지 않음, 높이 측정 컨텍스트와 paint 재평가, repeat 페이지 번호·sheet·copy와 `Page.copy`·`pageInCopy`, 0건 repeat, 흐름 요소 여러 개 페이지 수, 그룹 안 흐름 요소·조상 flow 교집합·흐름 요소 visible, z순서(flowBox 먼저), instance 형식, 페이지 상한.
- **1단계 테스트 갱신**: layout 테스트의 table placeholder 기대와 골든 스냅샷(표 placeholder)은 새 표 출력으로 갱신한다.
- **datasource**: 요청 data 우선·data 전용 이름·`normalizeRows`(null → `[]`, 문자열 → `BAD_DATA`)·예약 키, 병렬 실행과 전체 마감 `TIMEOUT`, http(허용 호스트 정규화: 대소문자·끝 점·기본 포트·IPv6·userinfo·scheme, 리다이렉트 거부, 타임아웃, 응답 20MB, 1만 행, rowsPath의 `__proto__`·숫자 세그먼트, 경로 `..` 거부·헤더 CR·LF 거부(`BAD_PARAM`), 본문 따옴표 값 이스케이프, 비밀값 토큰 치환, params 값의 secrets 토큰은 치환되지 않음, 비밀값의 한 글자로 분기하는 식은 스키마 오류, 묶이지 않은 호스트로 보내는 비밀값 거부, 오류 메시지 고정 문구·마스킹), sql(`extractBinds`: 문자열·`q'[..]'`·주석·큰따옴표 식별자·`::` 무시, 중복 제거, `BIND_MISSING`, undefined → null, 미설정 오류, 가짜 커넥터 결과).
- **골든**: 예제 4종(9.1)의 레이아웃 스냅샷.
- **pdf**: 예제 중 여러 페이지 PDF의 페이지 수 = 레이아웃 페이지 수. PDF 페이지 i를 래스터화해 `renderHtmlScreenshots`의 i번째와 비교하고 픽셀 차이가 허용치 이내.
- **성능**: 5.5 벤치마크 형태의 행 1만 건 표 레이아웃 시간(5.5 기준).
- **studio 단위**: 데이터 패널(이름 규칙, 잘림 표시), 드래그 바인딩 경로 결정 함수(repeat.as, 필터 소스, 대괄호 경로, 해석 불가 경고), 표 열 편집, 반복 영역 템플릿 매핑, `(elementId, instance)` 히트 검색과 flowBox 선택, 0건 템플릿 슬롯, 스토어의 `childLists` 순회(복제 시 템플릿 자식 id 재발급), 캔버스 컨텍스트(`sample` 없는 레포트의 static 데이터), 페이지·부 선택기, 라우트 본문 한도 413·`BAD_DATA_KEY`·504/400 구분.
- **E2E**: static JSON 데이터셋 추가 → 샘플 가져오기 → 필드 트리의 배열 노드를 끌어 표 생성 → 미리보기 여러 페이지 → PDF 페이지 수 확인 → 반복 영역 추가·템플릿 텍스트 수정이 모든 항목에 반영 → 페이지 선택기 이동.

### 9.1 검증용 예제 (fixtures)

예제는 `packages/renderer/src/__tests__/fixtures/`에 레포트 JSON과 샘플 데이터로만 존재한다. 예제를 위한 전용 코드는 없다.

| 예제 | 확인하는 범용 기능 |
|---|---|
| 검사증명서 | `repeat`(로트별), 긴 표 여러 페이지 넘김, 분류별 그룹 머리·소계, 페이지 소계, 헤더 반복 |
| 송장 | `repeat`(출하별), 중첩 배열 소스 `record.items`, 표 합계, `flow: last` 요소 |
| 출하지시서 | 반복 영역 list, 라인별 그룹 머리, 키 연결 소스 `items[.ORDER_NO == item.ORDER_NO]` |
| 사원 명찰 시트 | 반복 영역 grid, 부서별 그룹 머리·소계가 페이지 경계에 걸침(여러 페이지), 항목 안 image. MES와 무관한 범용성 점검 |

## 10. 완료 기준

1. 500행 표가 여러 페이지로 나뉘며 헤더 반복, 그룹 머리·소계, 페이지 소계, 표 합계가 맞게 나온다(불변식 테스트와 골든 통과).
2. `repeat`로 N건이면 N부가 나오고 `page`·`total`은 부마다, `sheet`·`sheets`는 전체 기준으로 맞다.
3. 반복 영역이 list·grid 모두에서 그룹과 함께 페이지를 넘긴다.
4. 미리보기·PDF가 요청 `data`를 우선 쓰고(이름 규칙·`normalizeRows` 포함), http 데이터셋의 허용 호스트 정규화·호스트에 묶인 비밀값 토큰 치환·URL/본문 인코딩·한도(데이터셋별·전체 마감, 504/400)·본문 한도 413과 SQL 커넥터 경계(`extractBinds`, `BIND_MISSING`)가 테스트로 검증된다.
5. 스튜디오에서 샘플 가져오기(잘림 표시), 필드 트리, 위치별 드래그 바인딩, 표·반복 영역·레포트 반복 편집, `(elementId, instance)` 기반 선택, 페이지·부 선택이 되고, `sample`이 없는 레포트도 static 데이터로 캔버스에 그려진다(E2E 통과).
6. 예제 4종이 여러 페이지 PDF로 나오고 `renderHtmlScreenshots`와 페이지별 픽셀 비교를 통과한다.
7. 5.5 벤치마크 형태의 행 1만 건 표 레이아웃이 5.5의 시간 기준을 만족한다.
8. paginate가 어떤 영역·조각 높이에서도 끝나고(진행 보장, 5.2 규칙 8), 1단계 layout 테스트·골든은 새 표 출력으로 갱신되어 통과한다.

## 11. 범위 밖 (이후 단계)

- Oracle 커넥터 구현과 연결 관리 UI(`connections` 테이블).
- 흐름 요소끼리 밀어내기(`pushDown`), 행 하나를 페이지에 걸쳐 쪼개기, 이어지는 페이지 전용 템플릿(`continuationPage`).
- 반복 영역 안의 반복 영역, 넘기는(`continue`) 중첩 표.
- 여러 줄 머리행·열 병합 머리글(다단 머리행), 그룹 머리·소계의 여러 행.
- 누계 변수(이월·전월 합계 등 현재 행·페이지까지의 합). 2단계는 `rows`·`pageRows`·`group.rows`만 제공한다.
- 데이터 자동 정렬·필터 UI(정렬은 데이터 측 책임).
- 데이터셋끼리 참조(다른 데이터셋 결과를 파라미터로 쓰기). 2단계 데이터셋은 서로 독립이며 병렬 실행한다.
- http 허용 목록 와일드카드, DNS 해석 결과(사설 IP) 검사, `url` 안의 비밀값.
- 샘플 전체 데이터 저장(샘플은 비static 데이터셋마다 앞 200행).
- 바코드 렌더링·라벨 프린터(3단계), 정식 렌더 API·API 키·버전 배포(4단계).
- CSV·엑셀 업로드, 교차표, 차트.
- 서버 Chromium 외부 요청 허용 목록(1단계에서 4단계로 넘긴 항목 그대로).
