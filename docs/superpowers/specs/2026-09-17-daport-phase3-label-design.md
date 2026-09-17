# daport 3단계 설계 스펙: 바코드·라벨 출력·페이지 프리셋

작성일: 2026-09-17
상태: 승인 대기
상위 스펙: `docs/superpowers/specs/2026-09-16-daport-report-tool-design.md` (12장 로드맵 3단계, 5.4장)
이전 단계: `docs/superpowers/specs/2026-09-17-daport-phase2-data-repetition-design.md`

## 1. 목적

Tag·라벨을 완성한다. 바코드 요소를 실제로 그리고, 라벨 레포트를 열전사 프린터 언어(ZPL·TSPL)로 내보내며, 페이지 크기와 출력 설정을 프리셋으로 저장해 재사용한다. 이 단계가 끝나면 문서 4종과 Tag·라벨 2종, 6종 전부가 예제로 존재한다.

컴포넌트 라이브러리(재사용 컴포넌트 `ref`)는 별도 스펙(3b)으로 뒤에 다룬다.

## 2. 원칙과 확정된 결정

| 항목 | 결정 |
|---|---|
| 범용성 | 모든 기능은 범용 기능이다. 코일 Tag·제품 라벨은 검증용 예제일 뿐이며 양식 전용 코드는 만들지 않는다 |
| 프린터 언어 | 기종 미정. ZPL(Zebra 계열)과 TSPL(TSC 계열) 둘 다 1비트 비트맵 명령으로 출력한다. 네이티브 명령 최적화는 이후 단계 |
| 전송 | 파일 다운로드가 기본. 서버 환경변수에 프린터 허용 목록이 있으면 raw TCP 9100 전송을 추가로 제공한다. MES용 렌더 API는 4단계 |
| 바코드 | renderer가 `bwip-js`로 SVG를 만든다. HTML·PDF·라벨 비트맵이 같은 SVG를 쓴다 |
| 라스터 | 라벨 비트맵은 같은 HTML을 Playwright로 지정 DPI에 맞춰 스크린샷 → 임계값 이진화(디더링 없음) |
| 순수성 | core·renderer는 입출력 없는 순수 코드로 유지한다. Playwright는 새 패키지 `browser`에만 있고 `pdf`·`label`이 함께 쓴다 |
| 라벨 여러 장 | 데이터 건수에 따른 여러 장은 2단계 `repeat`가 맡는다. 표 넘침으로 페이지가 늘어나면 페이지마다 라벨 한 장이다 |

## 3. 패키지 구조 변화

```
packages/
  core        + output 스키마, barcode 형식 확장, preset 스키마
  renderer    + barcode SVG 생성 (bwip-js)
  browser     (신규) Playwright 브라우저 풀, 폰트 서빙, 크래시 판정 — pdf에서 옮김
  pdf         browser 의존으로 바뀜. 공개 API 불변
  label       (신규) renderer 출력 → 비트맵 → ZPL/TSPL
apps/studio   + 출력 설정 패널, 프리셋 저장소·API, 라벨 다운로드·프린터 전송, 바코드 팔레트·속성
```

의존 방향: `browser`는 Playwright만 의존한다(renderer를 모른다). `pdf → renderer, browser`, `label → renderer, browser`. `renderer → core`. 다른 패키지는 바뀌지 않는다.

## 4. 레포트 모델 확장 (core)

### 4.1 출력 설정: `output`

```jsonc
"output": { "kind": "label",
            "label": { "language": "zpl", "dpi": 203, "threshold": 128,
                       "darkness": 15, "speed": 4, "copies": 1 } }
```

- 선택 필드. 없으면 `{ "kind": "pdf" }`.
- `kind`: `pdf` | `label`. `label`이면 `label` 절이 필요하다.
- `language`: `zpl` | `tspl`. `dpi`: `203` | `300`. `threshold`: 0–255, 기본 128(회색조 값이 임계값 미만이면 검정).
- `darkness`(0–30)·`speed`(1–14)는 선택이며 프린터 명령(`~SD`, `^PR` / `DENSITY`, `SPEED`)으로만 나간다. 레이아웃에는 영향이 없다.
- `copies`: 라벨 한 장당 인쇄 매수(기본 1). 프린터 명령(`^PQ` / `PRINT 1,n`)으로 나간다.

### 4.2 바코드 요소 확장

기존 `barcode` 요소(`format`, `value`, `showText`)를 실제로 그린다.

- `format`: `code128` | `ean13` | `qr` | `code39` | `datamatrix`.
- `value`: 표현식 템플릿(`"{{ item.LOT_NO }}"`). 보간 결과가 빈 문자열이거나 형식에 맞지 않으면(EAN13 자릿수·체크섬, code39 허용 문자) 그 요소만 `#ERR`(2단계 셀 오류와 같은 `onExpressionError` 규칙. 캔버스는 항상 blank).
- `showText`: 1D 바코드 아래에 사람이 읽는 텍스트를 넣는다. 글자 크기는 `style.fontSize`. QR·DataMatrix는 무시한다.
- 크기: 요소 상자(`w`×`h`)에 맞춰 늘린다(1D는 가로로 늘리고 세로는 상자 높이, 2D는 정사각형으로 상자 안에 맞춘다). 모듈 폭은 SVG 벡터라 DPI에 따라 정확히 래스터된다.

### 4.3 페이지 프리셋 (스튜디오 저장소, 레포트 밖)

```jsonc
{ "id": "coil-tag", "name": "코일 Tag 100×150 · ZPL 203dpi",
  "page": { "width": 100, "height": 150, "margin": [3, 3, 3, 3] },
  "output": { "kind": "label", "label": { "language": "zpl", "dpi": 203, "threshold": 128 } },
  "builtin": true }
```

- 내장 프리셋(`builtin: true`, 코드 상수): A4 세로·가로, A3 세로·가로, Letter, 코일 Tag 100×150 라벨(ZPL 203dpi), 제품 라벨 60×40(ZPL 203dpi).
- 사용자 정의(`builtin: false`)는 저장소에 둔다(7.1). `id`는 레포트 id와 같은 규칙(`[a-z0-9][a-z0-9-]*`).
- 프리셋 적용 = `page`와 `output`을 함께 바꾸는 편집 한 단위.

### 4.4 검증

- `output.kind === "label"`인데 `label` 절이 없으면 거부.
- 라벨 크기 상한은 두지 않는다(프린터마다 다르다). 대신 래스터 단계에서 픽셀 수 상한을 둔다(8장).

## 5. 바코드 렌더링 (renderer)

- `bwip-js`(순수 JS, 캔버스·DOM 불필요)로 SVG 문자열을 만든다. `placeStatic`의 `barcode` 분기가 `placeholder` 대신 새 항목 `PlacedSvg = { kind: "svg", svg: string, ... }`를 낸다. Paint는 `<div>` 안에 SVG를 인라인한다(`dangerouslySetInnerHTML`은 bwip-js 출력에만 쓰고, 값·형식은 스키마와 bwip-js 검증을 거친다).
- SVG 생성은 순수 함수 `renderBarcode(format, value, opts): string`으로 분리해 골든 테스트한다. bwip-js 예외는 `ExpressionError`가 아닌 `BarcodeError`로 감싸고, 레이아웃은 이를 `#ERR`로 격리한다(`onExpressionError` 규칙 공유).
- 성능: 라벨 한 장에 바코드 몇 개 수준이라 캐시는 두지 않는다. 표 셀 안 바코드는 이 단계 범위 밖(요소 타입에 `barcode`가 표 셀에 들어가는 문법이 없다).

## 6. 라벨 출력 (label, browser)

### 6.1 browser 패키지

`packages/pdf/src/pool.ts`·`fonts.ts`·`crash.ts`를 `packages/browser/src/`로 옮긴다. 공개 API: `getBrowser()`, `closePool()`, `serveFonts(ctx)`, `fontBaseUrl`, `isBrowserCrash(e)`, `withPage(html, fn, opts)`. `pdf`는 이를 import하도록 바뀌고 공개 API(`renderPdf`, `renderHtmlScreenshot`, `closePool`)는 그대로다. 기존 pdf 테스트가 회귀 검증이다.

### 6.2 파이프라인

1. `renderToHtml(report, data)` — 2단계와 같다.
2. 페이지마다 스크린샷: 뷰포트 픽셀 = `round(mm × dpi / 25.4)`, `deviceScaleFactor`로 CSS 픽셀(96dpi)을 목표 DPI에 맞춘다(203/96, 300/96). `.dp-page` 요소를 `omitBackground: false`로 찍는다.
3. 회색조(`0.299R + 0.587G + 0.114B`) → 임계값 이진화 → 행 단위 8픽셀 1바이트 패킹. 행 바이트 수 = `ceil(width / 8)`, 남는 비트는 흰색.
4. 명령 조립. ZPL은 1=검정, TSPL `BITMAP` 모드 0은 0=검정이라 TSPL은 비트를 반전한다.
   - ZPL 라벨 한 장: `^XA ^PW<w> ^LL<h> [~SD<darkness>] [^PR<speed>] ^FO0,0 ^GFA,<총바이트>,<총바이트>,<행바이트>,<HEX> ^FS ^PQ<copies> ^XZ`. 페이지마다 한 블록, 이어 붙인다.
   - TSPL 라벨 한 장: `SIZE <w> mm,<h> mm\r\nGAP 3 mm,0 mm\r\n[DENSITY n]\r\n[SPEED n]\r\nCLS\r\nBITMAP 0,0,<행바이트>,<h>,0,<바이너리>\r\nPRINT 1,<copies>\r\n`. 바이너리가 섞이므로 출력은 `Buffer`.

### 6.3 공개 API

```ts
type LabelResult = { language: "zpl" | "tspl"; dpi: number; pages: number; data: Buffer;
                     mime: "text/plain" | "application/octet-stream"; filename: string };
renderLabel(report: Report, data: DataContext): Promise<LabelResult>;           // report.output.kind가 label이 아니면 던진다
rasterizePages(report: Report, data: DataContext, dpi: number, threshold: number): Promise<Bitmap[]>;   // { width, height, bits: Uint8Array(행 패킹) }
encodeZpl(bitmaps: Bitmap[], opts: LabelOptions): string;      // 순수
encodeTspl(bitmaps: Bitmap[], opts: LabelOptions): Buffer;     // 순수
bitmapToPng(bitmap: Bitmap): Buffer;                           // 미리보기·테스트용
```

`filename`은 `<레포트 id>.zpl` / `.prn`.

## 7. 스튜디오 (apps/studio)

### 7.1 프리셋 저장소와 API

- `PresetStore` 인터페이스(`list/get/create/delete`)를 레포트 저장소와 같은 방식으로 `MemoryPresetStore`·`DbPresetStore`(새 `presets` 테이블: `id`, `name`, `body jsonb`, `created_at`)로 둔다. `list()`는 내장 + 사용자 정의를 합쳐 돌려준다.
- `GET /api/presets` → 목록. `POST /api/presets` `{ id, name, page, output }` → 201(내장 id와 겹치면 409). `DELETE /api/presets/:id` → 204(내장이면 403).
- PagePanel: 프리셋 선택 드롭다운(내장·사용자 정의 구분 표시), "현재 설정을 프리셋으로 저장"(이름·id 입력), 사용자 정의 삭제 버튼.

### 7.2 출력 설정 패널

PagePanel에 "출력" 절: 종류(PDF/라벨), 라벨이면 언어·DPI·임계값·농도·속도·매수. 캔버스 위에 `라벨 · ZPL · 203dpi` 표식.

### 7.3 툴바와 라우트

- `output.kind === "label"`이면 "라벨 다운로드" 버튼이 나타난다(`POST /api/reports/:id/label` → 파일 저장). "PDF" 버튼은 그대로 남긴다(종이 검수용).
- `GET /api/printers` → `[{ name }]`. 환경변수 `DAPORT_PRINTERS="라인1=192.168.10.21:9100,포장=192.168.10.22"`(포트 생략 시 9100)를 파싱하되 호스트는 응답에 넣지 않는다. 목록이 비어 있으면 툴바에 전송 UI가 없다.
- "프린터로 보내기" 드롭다운 → `POST /api/print` `{ printer, report?, params?, data? }`. 라벨을 렌더한 뒤 `net.createConnection`으로 raw 전송(연결·쓰기 타임아웃 10초). 응답 `{ printer, bytes, pages }`.
- `POST /api/reports/:id/label`: 본문 규칙(20MB, `data` 우선), 데이터셋 오류 400 `{ error, datasetErrors }`, `LayoutLimitError` 400은 pdf 라우트와 같다. `?preview=png`이면 첫 라벨의 이진화 PNG를 돌려준다(캔버스 옆 "비트맵 미리보기" 토글이 쓴다).

### 7.4 바코드 편집

팔레트에 "바코드"(기본 code128, 40×15mm). 속성 패널: 형식, 값, 텍스트 표시. 캔버스는 renderer가 낸 SVG를 그대로 그린다.

## 8. 오류 처리

| 상황 | 처리 |
|---|---|
| 바코드 값이 형식에 안 맞음·빈 값 | 그 요소만 `#ERR`(blank) / 던짐(fail). 캔버스 `#ERR` 상자와 문제 목록 |
| `output.kind`가 label이 아닌 레포트로 라벨 라우트·print 호출 | 400 `{ error }` |
| 프린터 이름이 허용 목록에 없음 | 400 |
| 프린터 연결 실패·타임아웃 | 502 `{ error, printer }`. 전송은 재시도하지 않는다(중복 인쇄 방지) |
| 라벨 비트맵이 너무 큼(페이지 픽셀 수 > 50,000,000) | 400 `{ error, code: "LABEL_TOO_LARGE" }` |
| Chromium 크래시 | pdf와 같이 1회 재시도 후 500 |
| 프리셋 id 충돌·내장 삭제 | 409 / 403 |

## 9. 테스트

- **core**: `output` 스키마(기본값, label일 때 절 필수), 바코드 형식 확장, 프리셋 스키마.
- **renderer**: `renderBarcode` 형식별 골든 1개씩(SVG 문자열), 잘못된 값 → `#ERR` 격리, 기존 골든 스냅샷 유지(바코드가 placeholder에서 svg로 바뀌는 quality-cert 픽스처는 없다 — 확인).
- **browser**: 이동 후 pdf 테스트 전부 통과(회귀).
- **label**: 인코더 골든(2×2·9×3 비트맵 → ZPL 문자열·TSPL 바이트 정확 일치, 패딩·반전·copies), `rasterizePages` 크기 = `round(mm × dpi / 25.4)`, 라벨 예제 2종의 비트맵(PNG) vs HTML 스크린샷(같은 DPI) 픽셀 비교(2단계 multipage 비교기 재사용, 라벨은 작으므로 0.1%), `repeat` 3건 → ZPL `^XA` 블록 3개.
- **studio**: 프리셋 저장소·라우트(409/403), 출력 패널, 툴바 분기(라벨일 때 버튼 표시, 프린터 목록 없으면 숨김), `DAPORT_PRINTERS` 파싱, print 라우트(테스트 안에서 `net.createServer`로 가짜 프린터를 띄워 수신 바이트가 `^XA`로 시작하는지 확인, 연결 거부 → 502), 라벨 라우트 오류 코드.
- **E2E**: 시드된 제품 라벨 예제 열기 → 바코드 SVG 보임 → "라벨 다운로드" 파일이 `^XA`로 시작하고 `^GFA`를 포함 → 출력 설정을 TSPL로 바꿔 다운로드하면 `SIZE`로 시작 → 프리셋 저장 후 새 레포트에서 선택하면 크기·출력 설정이 적용된다.

### 9.1 검증용 예제 (fixtures)

| 예제 | 확인하는 범용 기능 |
|---|---|
| 코일 Tag 100×150 | 라벨 출력, code128 + QR, `repeat`(코일별), 큰 글자 규격·중량·고객사 |
| 제품 라벨 60×40 | 라벨 출력, code128 품번 + 텍스트, 수량·로트, 60×40 프리셋 |

## 10. 완료 기준

1. 문서 4종 + 코일 Tag + 제품 라벨, 6종이 예제로 존재하고 골든·픽셀 비교를 통과한다.
2. 바코드(code128·ean13·qr·code39·datamatrix)가 HTML·PDF·라벨 비트맵에서 동일하게 나온다(라벨 비트맵 vs HTML 스크린샷 픽셀 비교).
3. 라벨 레포트를 ZPL·TSPL로 내려받을 수 있고, `repeat` N건이 N장이 된다.
4. 허용 목록의 프린터로 raw TCP 전송이 되며(가짜 서버 테스트), 목록이 없으면 UI에 전송 버튼이 없다.
5. 페이지 프리셋을 저장·선택·삭제할 수 있다.
6. 기존 pdf 테스트가 `browser` 패키지 분리 후에도 그대로 통과한다.

## 11. 범위 밖 (이후 단계)

- ZPL/TSPL 네이티브 명령(텍스트·바코드) 최적화, 회전·거울 인쇄, 그레이스케일 디더링.
- 컴포넌트 라이브러리(`ref` 요소 확장, 라이브러리 패널) — 3b 스펙.
- 프린터 상태 조회, 인쇄 이력, 공장 중계 에이전트.
- 표 셀 안 바코드.
- 정식 렌더 API·API 키·버전 배포(4단계).
