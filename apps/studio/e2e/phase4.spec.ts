// dev 서버에 DAPORT_DEV_API_KEY=e2e-dev-key가 있어야 한다 (playwright.config webServer.env가 넣는다. 서버를 직접 띄웠다면 같은 값을 준다)
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const KEY = { "x-api-key": "e2e-dev-key" };

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID").fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

test("publish → edit → 수정됨 → republish → roll back; the render API follows the pointer and never the draft", async ({ page, request }) => {
  const id = `e2e-pub-${Date.now()}`;
  await createReport(page, id);
  await expect(page.getByTestId("publish-badge")).toHaveText("미배포");
  // 미배포 상태의 렌더 API
  const np = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html" } });
  expect(np.status()).toBe(404);
  expect((await np.json()).code).toBe("NOT_PUBLISHED");
  expect((await request.post(`/api/reports/${id}/render`, { data: { format: "html" } })).status()).toBe(401);

  page.once("dialog", (d) => d.accept("첫 배포"));
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨");

  // 편집·저장 → 수정됨
  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  await page.getByTestId("save").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨 · 수정됨");
  const v1Html = await (await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html" } })).text();
  expect(v1Html).not.toContain('data-element-id="text-1"');          // draft의 새 요소는 배포본에 없다

  page.once("dialog", (d) => d.accept(""));
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v2 배포됨");
  const v2 = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "pdf", params: {} } });
  expect(v2.status()).toBe(200);
  expect(v2.headers()["x-daport-version"]).toBe("2");
  expect((await v2.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // 되돌리기
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "버전" }).click();
  await page.getByTestId("versions-panel").locator('[data-version="1"] button[name="republish"]').click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨 · 수정됨");
  const back = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html" } });
  expect(back.headers()["x-daport-version"]).toBe("1");
  expect(await back.text()).not.toContain('data-element-id="text-1"');
  // 지정 버전
  const pinned = await request.post(`/api/reports/${id}/render`, { headers: KEY, data: { format: "html", version: 2 } });
  expect(await pinned.text()).toContain('data-element-id="text-1"');
  // 임베드용 모델
  const model = await request.get(`/api/reports/${id}/published`, { headers: KEY });
  expect(model.status()).toBe(200);
  expect((await model.json()).id).toBe(id);
});

test("seeded label renders as ZPL through the render API; pdf report rejects zpl", async ({ request }) => {
  await request.post("/api/reports/product-label/publish", { data: {} });
  const zpl = await request.post("/api/reports/product-label/render", { headers: KEY, data: { format: "zpl" } });
  expect(zpl.status()).toBe(200);
  expect((await zpl.text()).startsWith("^XA")).toBe(true);
  await request.post("/api/reports/quality-cert/publish", { data: {} });
  const mm = await request.post("/api/reports/quality-cert/render", { headers: KEY, data: { format: "zpl" } });
  expect(mm.status()).toBe(400);
  expect((await mm.json()).code).toBe("FORMAT_MISMATCH");
});

test("export a report, import it back: same id becomes a new unpublished version", async ({ page, request }) => {
  const id = `e2e-bundle-${Date.now()}`;
  await createReport(page, id);
  page.once("dialog", (d) => d.accept(""));
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("publish-badge")).toHaveText("v1 배포됨");

  await page.goto("/");
  await expect(page.getByTestId(`status-${id}`)).toHaveText("v1");
  await page.getByLabel(`선택 ${id}`).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "내보내기" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^daport-export-\d{4}-\d{2}-\d{2}\.zip$/);
  const zipPath = await download.path();
  expect(readFileSync(zipPath).subarray(0, 2).toString()).toBe("PK");

  await page.getByLabel("번들 파일").setInputFiles(zipPath);
  const result = page.getByTestId("import-result");
  await expect(result).toContainText(`${id}: v2 추가`);
  const list = await (await request.get(`/api/reports/${id}/versions`)).json();
  expect(list.publishedVersion).toBe(1);
  expect(list.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
});
