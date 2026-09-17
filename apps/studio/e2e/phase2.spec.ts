import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const MIME = "application/x-daport-field";
const rows = Array.from({ length: 120 }, (_, i) => ({ N: i + 1, NAME: `품목 ${i + 1}`, QTY: (i * 7) % 50 }));

/** 홈 화면 폼으로 빈 A4 레포트를 만들고 캔버스가 뜰 때까지 기다린다 */
async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

/** 데이터 탭에서 static 데이터셋을 만들고 샘플을 가져와 필드 트리가 뜨게 한다 */
async function addStaticDataset(page: Page, name: string, data: unknown[]) {
  await page.getByRole("button", { name: "데이터" }).click();
  await page.getByRole("button", { name: "+ static" }).click();
  await page.getByLabel("이름", { exact: true }).fill(name);
  await page.getByLabel("행(JSON)", { exact: true }).fill(JSON.stringify(data));
  await page.getByTestId("fetch-sample").click();
  await expect(page.getByTestId(`fields-${name}`).locator('[data-path="N"]')).toBeVisible();
}

test("static dataset → sample → drag dataset root onto the canvas → multi-page table → preview pages → PDF page count", async ({ page }) => {
  const id = `e2e-table-${Date.now()}`;
  await createReport(page, id);
  await addStaticDataset(page, "items", rows);

  // 필드 트리 루트 노드를 캔버스에 놓는다. HTML5 DnD는 DataTransfer를 직접 만들어 drop을 보낸다
  const dt = await page.evaluateHandle((mime) => {
    const dt = new DataTransfer();
    dt.setData(mime, JSON.stringify({ dataset: "items", path: "", type: "array", isArray: true,
      children: [{ name: "N", path: "N", type: "number" }, { name: "NAME", path: "NAME", type: "string" }, { name: "QTY", path: "QTY", type: "number" }] }));
    return dt;
  }, MIME);
  const canvas = page.getByTestId("canvas");
  const box = (await canvas.locator(".dp-page").boundingBox())!;
  await canvas.locator(".dp-page").dispatchEvent("drop", { dataTransfer: dt, clientX: box.x + 40, clientY: box.y + 120 });
  await expect(canvas.locator('[data-element-id="table-1"][data-role="flowBox"]')).toBeVisible();
  await expect(canvas.locator('[data-element-id="table-1"][data-role="cell"]').first()).toBeVisible();

  // 120행이 40mm 영역을 넘어 여러 페이지가 되고 페이지 선택기로 이동한다
  await expect(page.getByTestId("page-indicator")).toHaveText(/^1 \/ [2-9]$/);
  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(canvas.locator(".dp-page")).toHaveAttribute("data-page-index", "1");
  const total = Number((await page.getByTestId("page-indicator").textContent())!.split("/")[1].trim());

  // 미리보기 iframe에도 여러 페이지
  await page.getByRole("button", { name: "미리보기" }).click();
  await expect(page.frameLocator('iframe[title="preview"]').locator(".dp-page").nth(1)).toBeAttached({ timeout: 15_000 });
  await page.getByRole("button", { name: "디자인" }).click();

  // 저장 후 PDF 페이지 수 = 캔버스 페이지 수 (완료 기준 6)
  const save = page.getByTestId("save");
  await save.click();
  await expect(save).toBeDisabled();
  const res = await page.request.post(`/api/reports/${id}/pdf`, { data: {} });
  expect(res.ok(), `PDF HTTP ${res.status()}`).toBe(true);
  expect((await PDFDocument.load(await res.body())).getPageCount()).toBe(total);
});

test("repeater: editing the template text updates every instance; page selector moves to the next page", async ({ page }) => {
  const id = `e2e-rep-${Date.now()}`;
  await createReport(page, id);
  await addStaticDataset(page, "items", rows.slice(0, 30));
  await page.getByRole("button", { name: "요소" }).click();
  await page.getByRole("button", { name: "+ 반복 영역", exact: true }).click();
  await page.getByLabel("소스", { exact: true }).fill("items");

  const canvas = page.getByTestId("canvas");
  const instances = canvas.locator('[data-element-id="text-1"]');
  await expect(instances.first()).toBeVisible();
  await expect.poll(() => instances.count()).toBeGreaterThan(1);              // 80mm 영역에 22mm 항목 3개
  const n = await instances.count();

  // 두 번째 인스턴스를 눌러도 템플릿 자식이 선택되고, 내용을 바꾸면 모든 인스턴스에 반영된다
  await instances.nth(1).click();
  await page.getByLabel("내용", { exact: true }).fill("{{ item.NAME }}");
  await expect(instances.first()).toHaveText(/품목 1/);
  await expect(instances.nth(1)).toHaveText(/품목 2/);
  await expect(canvas.locator('[data-element-id="text-1"]:has-text("품목")')).toHaveCount(n);

  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(canvas.locator(".dp-page")).toHaveAttribute("data-page-index", "1");
  await expect(instances.first()).toHaveText(new RegExp(`품목 ${n + 1}`));
});

test("seeded inspection certificate: copy and page selectors, repeated header on the next page", async ({ page }) => {
  await page.goto("/reports/inspection-cert");
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-element-id="results"][data-role="flowBox"]')).toBeVisible();
  await expect(page.getByTestId("copy-indicator")).toHaveText("1 / 2");
  await expect(page.getByTestId("page-indicator")).toHaveText(/^1 \/ [2-9]$/);
  await page.getByRole("button", { name: "다음 페이지" }).click();
  await expect(canvas.locator('[data-instance="results#h"]').first()).toBeVisible();   // 머리 반복
  await page.getByRole("button", { name: "다음 부" }).click();
  await expect(page.getByTestId("copy-indicator")).toHaveText("2 / 2");
  await expect(page.getByTestId("page-indicator")).toHaveText("1 / 1");
  await expect(canvas.locator('[data-element-id="v2"]')).toHaveText(/L-002/);
});
