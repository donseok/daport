import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import qualityCert from "../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json" with { type: "json" };

const COMPONENT_MIME = "application/x-daport-component";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const LOT = { lotNo: "L2609-0142" };   // 품질보증서의 필수 파라미터

type El = { id: string; type: string; x: number; y: number; w: number; h: number; ref?: string; version?: number;
  props?: Record<string, unknown>; children?: El[] };
type Model = { elements: El[]; components: Record<string, unknown> };

// Monaco는 보이는 줄만 DOM에 그리므로 JsonEditor가 window.monaco로 노출한 모델에서 편집 중인 JSON을 읽는다
async function readModel(page: Page): Promise<Model | null> {
  const text = await page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor: { getModels(): { uri: { path: string }; getValue(): string }[] } } }).monaco;
    const m = monaco?.editor.getModels().find((x) => x.uri.path.endsWith("report.json"));
    return m ? m.getValue() : null;
  });
  try { return text ? (JSON.parse(text) as Model) : null; } catch { return null; }
}
const refsIn = async (page: Page) => ((await readModel(page))?.elements ?? []).filter((e) => e.type === "ref");

/** 품질보증서 픽스처를 새 id로 저장한다 (저장 검사를 거치는 POST) */
async function copyQualityCert(page: Page, id: string) {
  const res = await page.request.post("/api/reports", { data: { ...qualityCert, id, name: `품질보증서 ${id}` } });
  expect(res.status(), `create ${id}`).toBe(201);
}

/** 레포트를 열고 캔버스와 Monaco 모델이 뜰 때까지 기다린다 */
async function openReport(page: Page, id: string) {
  await page.goto(`/reports/${id}`);
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
  await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();
}

/** 저장 버튼을 누르고 PUT 응답을 받아 저장됨(비활성)까지 기다린다 */
async function saveReport(page: Page, id: string) {
  const save = page.getByTestId("save");
  await expect(save).toBeEnabled();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/reports/${id}`),
    save.click(),
  ]);
  expect(res.ok(), `save ${id} HTTP ${res.status()}`).toBe(true);
  await expect(save).toBeDisabled();
  await expect(page.getByTestId("save-warnings")).toHaveCount(0);   // 품은 내용이 라이브러리와 같으면 경고가 없다
}

/** 미리보기 iframe 첫 페이지의 글자와 주어진 글자의 화면 위치 */
async function previewSnapshot(page: Page, text: string) {
  await page.getByRole("button", { name: "미리보기" }).click();
  const frame = page.frameLocator('iframe[title="preview"]');
  const target = frame.getByText(text, { exact: true });
  await expect(target).toBeVisible({ timeout: 15_000 });
  const snap = { text: await frame.locator(".dp-page").first().innerText(), box: await target.boundingBox() };
  await page.getByRole("button", { name: "디자인" }).click();
  return snap;
}

/** PDF 첫 페이지의 풀린 내용 스트림. 같은 레포트라도 생성 시각이 달라 파일 바이트는 매번 다르므로 그리기 명령만 비교한다 */
async function pdfPageContent(page: Page, reportId: string): Promise<string> {
  const res = await page.request.post(`/api/reports/${reportId}/pdf`, { data: { params: LOT } });
  expect(res.ok(), `PDF HTTP ${res.status()}`).toBe(true);
  const doc = await PDFDocument.load(await res.body());
  expect(doc.getPageCount()).toBe(1);
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "")).join("\n");
}

/** 라이브러리 항목을 캔버스에 놓는다. HTML5 DnD는 DataTransfer를 직접 만들어 drop을 보낸다 (phase2.spec.ts와 같은 방식) */
async function dropComponent(page: Page, componentId: string, dx: number, dy: number) {
  const dt = await page.evaluateHandle(([mime, id]) => { const d = new DataTransfer(); d.setData(mime, id); return d; }, [COMPONENT_MIME, componentId] as const);
  const pageEl = page.getByTestId("canvas").locator(".dp-page");
  const box = (await pageEl.boundingBox())!;
  await pageEl.dispatchEvent("dragover", { dataTransfer: dt, clientX: box.x + dx, clientY: box.y + dy });
  await pageEl.dispatchEvent("drop", { dataTransfer: dt, clientX: box.x + dx, clientY: box.y + dy });
}

/** 인스턴스를 선택한다. 인스턴스 안 어느 항목이든 elementId가 인스턴스 id다 (스펙 5.3) */
async function selectInstance(page: Page, refId: string) {
  const inst = page.getByTestId("canvas").locator(`[data-element-id="${refId}"][data-role="refBox"]`);
  await expect(inst).toHaveCount(1);
  // refBox는 투명 사각형이라 그 위에 인스턴스 자식 항목이 겹친다. 가려짐 검사를 건너뛰고 좌표로 누르면 맨 위 자식(같은 elementId)이 눌린다
  await inst.click({ force: true });
}

// 흐름 1~3은 앞 흐름이 만든 레포트·컴포넌트를 이어 쓴다
test.describe.serial("component from a selection, new version with a prop, update in the report", () => {
  const stamp = Date.now();
  const reportId = `e2e-comp-qc-${stamp}`;
  const componentId = `e2e-hdr-${stamp}`;
  const componentName = `E2E 헤더 ${stamp}`;
  let refId = "";

  test("1. select header elements → 컴포넌트로 만들기 → one instance, same preview", async ({ page }) => {
    await copyQualityCert(page, reportId);
    await openReport(page, reportId);
    const canvas = page.getByTestId("canvas");
    const before = await previewSnapshot(page, "품 질 보 증 서");

    await canvas.locator('[data-element-id="title"]').click();
    await canvas.locator('[data-element-id="subtitle"]').click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "컴포넌트로 만들기", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("이름", { exact: true }).fill(componentName);
    await dialog.getByLabel("id", { exact: true }).fill(componentId);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/components"),
      dialog.getByRole("button", { name: "만들기", exact: true }).click(),
    ]);
    expect(created.status()).toBe(201);
    expect(await created.json()).toMatchObject({ version: 1 });
    await expect(dialog).toHaveCount(0);

    // 선택 요소 둘이 사라지고 경계 상자(15,20 ~ 195,40) 자리에 인스턴스 하나
    await expect.poll(async () => (await refsIn(page)).length).toBe(1);
    const [ref] = await refsIn(page);
    expect(ref).toMatchObject({ ref: componentId, version: 1, x: 15, y: 20, w: 180, h: 20 });
    refId = ref.id;
    const model = (await readModel(page))!;
    expect(model.elements.some((e) => e.id === "title" || e.id === "subtitle")).toBe(false);
    expect(Object.keys(model.components)).toEqual([`${componentId}@1`]);
    await expect(canvas.locator(`[data-element-id="${refId}"][data-role="refBox"]`)).toHaveCount(1);
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: "품 질 보 증 서" })).toBeVisible();

    // 미리보기는 변환 전과 같다: 첫 페이지 글자와 제목 위치
    const after = await previewSnapshot(page, "품 질 보 증 서");
    expect(after.text).toBe(before.text);
    expect(after.box).toEqual(before.box);

    // 라이브러리 v1 내용은 상자 기준 상대좌표
    const lib = await (await page.request.get(`/api/components/${componentId}`)).json();
    expect(lib.summary).toMatchObject({ id: componentId, name: componentName, latestVersion: 1, w: 180, h: 20 });
    expect(lib.latest.elements.map((e: El) => [e.id, e.x, e.y])).toEqual([["title", 0, 0], ["subtitle", 0, 14]]);

    await saveReport(page, reportId);   // 저장 검사: 품은 v1 해시가 라이브러리와 같다
  });

  test("2. /components/:id: add prop title, bind the title text to props.title, save → v2", async ({ page }) => {
    await page.goto(`/components/${componentId}`);
    const canvas = page.getByTestId("canvas");
    await expect(canvas.locator('[data-element-id="title"]')).toBeVisible();
    await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();
    await expect(page.getByText("v1 (저장하면 v2)", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "입력값", exact: true }).click();   // 왼쪽 패널 입력값 탭 (처음에는 요소 탭이 열려 있다)
    await page.getByRole("button", { name: "입력값 추가", exact: true }).click();
    const prop = page.getByTestId("prop-0");
    await prop.getByLabel("이름", { exact: true }).fill("title");
    await prop.getByLabel("타입", { exact: true }).selectOption("string");
    await prop.getByLabel("기본값", { exact: true }).fill("품 질 보 증 서");   // 기존 인스턴스는 기본값으로 같은 글자를 보인다
    await page.getByRole("button", { name: "요소", exact: true }).click();

    await canvas.locator('[data-element-id="title"]').click();
    await page.getByLabel("내용", { exact: true }).fill("{{ props.title }}");
    await expect.poll(async () => (await readModel(page))?.elements.find((e) => e.id === "title")).toMatchObject({ value: "{{ props.title }}" });

    const save = page.getByTestId("save");
    await expect(save).toBeEnabled();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/components/${componentId}`),
      save.click(),
    ]);
    expect(res.ok(), `component save HTTP ${res.status()}`).toBe(true);
    expect(await res.json()).toMatchObject({ version: 2, created: true });
    await expect(page.getByText("v2 (저장하면 v3)", { exact: true })).toBeVisible();

    const v2 = await (await page.request.get(`/api/components/${componentId}/versions/2`)).json();
    expect(v2.body.props).toMatchObject([{ name: "title", type: "string", default: "품 질 보 증 서" }]);
    expect(v2.body.elements.find((e: { id: string }) => e.id === "title").value).toBe("{{ props.title }}");
    const v1 = await (await page.request.get(`/api/components/${componentId}/versions/1`)).json();
    expect(v1.body.props).toEqual([]);   // 옛 버전은 바뀌지 않는다
  });

  test("3. back in the report: v1 → v2 update, fill title → canvas, preview and PDF show it", async ({ page }) => {
    const pdfBefore = await pdfPageContent(page, reportId);   // 저장된 v1 인스턴스
    await openReport(page, reportId);
    const canvas = page.getByTestId("canvas");
    await selectInstance(page, refId);

    await page.getByRole("button", { name: /v1\s*→\s*v2 업데이트/ }).click();   // 크기가 같아 확인 대화상자가 없다
    await expect.poll(async () => (await refsIn(page))[0]).toMatchObject({ id: refId, version: 2, w: 180, h: 20 });
    expect(Object.keys((await readModel(page))!.components)).toEqual([`${componentId}@2`]);   // 옛 버전 정리
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: "품 질 보 증 서" })).toBeVisible();   // 기본값

    const title = "E2E 보증서 제목";
    await page.getByLabel("입력값 title", { exact: true }).fill(title);
    await expect.poll(async () => (await refsIn(page))[0]?.props).toEqual({ title });
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: title })).toBeVisible();
    await expect(canvas.locator(`[data-element-id="${refId}"]`, { hasText: "품 질 보 증 서" })).toHaveCount(0);

    const preview = await previewSnapshot(page, title);
    expect(preview.text).toContain(title);
    expect(preview.text).not.toContain("품 질 보 증 서");

    await saveReport(page, reportId);   // 품은 v2 해시가 라이브러리 v2와 같다
    const html = await (await page.request.post(`/api/reports/${reportId}/preview`, { data: { params: LOT } })).text();
    expect(html).toContain(title);   // PDF 라우트가 인쇄하는 것과 같은 HTML
    expect(await pdfPageContent(page, reportId)).not.toBe(pdfBefore);   // 저장된 레포트의 PDF 그리기 명령이 바뀌었다
  });
});

/** 홈 화면 폼으로 빈 A4 레포트를 만들고 캔버스와 Monaco 모델이 뜰 때까지 기다린다 */
async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
  await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();
}

test("4. drag the same library component twice into a new report and give each instance a different title", async ({ page }) => {
  const stamp = Date.now();
  const componentId = `e2e-badge-${stamp}`;
  const componentName = `E2E 배지 ${stamp}`;
  const created = await page.request.post("/api/components", { data: { id: componentId, body: {
    name: componentName, w: 80, h: 12, props: [{ name: "title", type: "string", default: "기본 제목" }],
    elements: [
      { id: "frame", type: "rect", x: 0, y: 0, w: 80, h: 12, style: { stroke: "#000", strokeWidth: 0.3 } },
      { id: "label", type: "text", x: 2, y: 2, w: 76, h: 8, value: "{{ props.title }}" },
    ] } } });
  expect(created.status()).toBe(201);

  const reportId = `e2e-comp-drop-${stamp}`;
  await createReport(page, reportId);
  await page.getByRole("button", { name: "컴포넌트", exact: true }).click();
  await expect(page.getByText(componentName, { exact: true })).toBeVisible();

  await dropComponent(page, componentId, 60, 60);
  await expect.poll(async () => (await refsIn(page)).length).toBe(1);
  await dropComponent(page, componentId, 60, 300);
  await expect.poll(async () => (await refsIn(page)).length).toBe(2);

  const [a, b] = await refsIn(page);
  expect(a.id).not.toBe(b.id);
  for (const r of [a, b]) expect(r).toMatchObject({ ref: componentId, version: 1, w: 80, h: 12 });
  expect(b.y).toBeGreaterThan(a.y + 12);   // 겹치지 않게 놓였다
  expect(Object.keys((await readModel(page))!.components)).toEqual([`${componentId}@1`]);   // 내용은 한 번만 품는다

  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-role="refBox"]')).toHaveCount(2);
  await selectInstance(page, a.id);
  await page.getByLabel("입력값 title", { exact: true }).fill("첫째 제목");
  await selectInstance(page, b.id);
  await page.getByLabel("입력값 title", { exact: true }).fill("둘째 제목");

  await expect.poll(async () => (await refsIn(page)).map((r) => r.props)).toEqual([{ title: "첫째 제목" }, { title: "둘째 제목" }]);
  await expect(canvas.locator(`[data-element-id="${a.id}"]`, { hasText: "첫째 제목" })).toBeVisible();
  await expect(canvas.locator(`[data-element-id="${b.id}"]`, { hasText: "둘째 제목" })).toBeVisible();
  await expect(canvas.getByText("기본 제목")).toHaveCount(0);

  await page.getByRole("button", { name: "미리보기" }).click();
  const frame = page.frameLocator('iframe[title="preview"]');
  await expect(frame.getByText("첫째 제목", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByText("둘째 제목", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "디자인" }).click();

  await saveReport(page, reportId);
  const stored = await (await page.request.get(`/api/reports/${reportId}`)).json();
  expect(stored.elements.filter((e: El) => e.type === "ref")).toHaveLength(2);
});

test("5. select two elements → Cmd+G groups them, Cmd+Shift+G restores them, undo steps back one action each", async ({ page }) => {
  const reportId = `e2e-group-${Date.now()}`;
  const original = [
    { id: "a", type: "text", x: 20, y: 20, w: 40, h: 10, value: "AAA" },
    { id: "b", type: "text", x: 80, y: 40, w: 40, h: 10, value: "BBB" },
  ];
  const created = await page.request.post("/api/reports", { data: { id: reportId, name: reportId, version: 1, page: { width: 210, height: 297 }, elements: original } });
  expect(created.status()).toBe(201);
  await openReport(page, reportId);

  const canvas = page.getByTestId("canvas");
  const shape = async () => ((await readModel(page))?.elements ?? []).map((e) => ({
    id: e.type === "group" ? "(group)" : e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h,
    children: e.children?.map((c) => ({ id: c.id, x: c.x, y: c.y })),
  }));
  const flat = [
    { id: "a", type: "text", x: 20, y: 20, w: 40, h: 10, children: undefined },
    { id: "b", type: "text", x: 80, y: 40, w: 40, h: 10, children: undefined },
  ];
  const grouped = [{ id: "(group)", type: "group", x: 20, y: 20, w: 100, h: 30, children: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 60, y: 20 }] }];
  await expect.poll(shape).toEqual(flat);

  await canvas.locator('[data-element-id="a"]').click();
  await canvas.locator('[data-element-id="b"]').click({ modifiers: ["Shift"] });
  await page.keyboard.press(`${MOD}+g`);
  await expect.poll(shape).toEqual(grouped);
  const groupId = (await readModel(page))!.elements[0].id;
  expect(groupId).toMatch(/^group-\d+$/);
  await expect(canvas.locator('[data-element-id="a"]')).toHaveText(/AAA/);   // 그려진 결과는 그대로
  await expect(canvas.locator('[data-element-id="b"]')).toHaveText(/BBB/);

  await page.keyboard.press(`${MOD}+Shift+g`);   // 선택은 새 그룹이다
  await expect.poll(shape).toEqual(flat);

  await page.keyboard.press(`${MOD}+z`);          // 해제 되돌리기 → 그룹
  await expect.poll(shape).toEqual(grouped);
  expect((await readModel(page))!.elements[0].id).toBe(groupId);
  await page.keyboard.press(`${MOD}+z`);          // 그룹화 되돌리기 → 처음 두 요소
  await expect.poll(shape).toEqual(flat);
});
