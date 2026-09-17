import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID").fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}
const mmToPx = (mm: number) => Math.round((mm / 25.4) * 96);

test("seeded product label: barcode renders, ZPL and TSPL downloads, bitmap preview", async ({ page }) => {
  await page.goto("/reports/product-label");
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-element-id="bc"] svg').first()).toBeVisible();
  await expect(page.getByTestId("label-badge")).toHaveText("라벨 · ZPL · 203dpi");

  const [zpl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("label-download").click()]);
  expect(zpl.suggestedFilename()).toBe("product-label.zpl");
  const zplText = readFileSync(await zpl.path(), "latin1");
  expect(zplText.startsWith("^XA")).toBe(true);
  expect(zplText).toContain("^GFA,");
  expect(zplText.match(/\^XA/g)?.length).toBe(2);                              // 샘플 2건 → 라벨 2장

  await page.getByLabel("언어").selectOption("tspl");
  const [prn] = await Promise.all([page.waitForEvent("download"), page.getByTestId("label-download").click()]);
  expect(prn.suggestedFilename()).toBe("product-label.prn");
  expect(readFileSync(await prn.path(), "latin1").startsWith("SIZE 60 mm,40 mm")).toBe(true);

  // 비트맵 미리보기: 이진화 PNG가 미리보기 자리에 뜬다
  await page.getByLabel("비트맵").check();
  await page.getByRole("button", { name: "미리보기" }).click();
  await expect(page.getByTestId("bitmap-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("프린터")).toHaveCount(0);                     // DAPORT_PRINTERS 없음 → 전송 UI 없음
});

test("presets: apply a builtin label preset, save a custom preset, reuse it in a new report", async ({ page }) => {
  const id = `e2e-preset-${Date.now()}`;
  await createReport(page, id);
  await page.getByLabel("프리셋", { exact: true }).selectOption("coil-tag-100x150");
  const width = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
  expect(Math.round(parseFloat(width))).toBe(mmToPx(100));
  await expect(page.getByTestId("label-badge")).toHaveText("라벨 · ZPL · 203dpi");

  await page.getByLabel("너비(mm)").fill("80");
  await page.getByText("현재 설정을 프리셋으로 저장").click();
  const presetId = `p-${Date.now()}`;
  await page.getByLabel("새 프리셋 id").fill(presetId);
  await page.getByLabel("새 프리셋 이름").fill("E2E 80×150");
  await page.getByRole("button", { name: "프리셋으로 저장" }).click();
  await expect(page.getByRole("option", { name: "E2E 80×150" })).toBeAttached();

  const id2 = `e2e-preset2-${Date.now()}`;
  await createReport(page, id2);
  await page.getByLabel("프리셋", { exact: true }).selectOption(presetId);
  await expect(page.getByTestId("label-badge")).toHaveText("라벨 · ZPL · 203dpi");
  const w2 = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
  expect(Math.round(parseFloat(w2))).toBe(mmToPx(80));
  await page.getByRole("button", { name: "프리셋 삭제" }).click();
  await expect(page.getByRole("option", { name: "E2E 80×150" })).toHaveCount(0);
});

test("palette barcode: added element shows an svg and property changes re-render it", async ({ page }) => {
  const id = `e2e-bc-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "+ 바코드", exact: true }).click();
  const bc = page.getByTestId("canvas").locator('[data-element-id="barcode-1"]');
  await expect(bc.locator("svg")).toBeVisible();
  await page.getByLabel("형식").selectOption("qr");
  await expect(bc.locator('svg[preserveAspectRatio="xMidYMid meet"]')).toBeVisible();
  await page.getByLabel("값").fill("");
  await expect(bc).toHaveClass(/dp-err/);                                      // 빈 값은 그 요소만 #ERR
});
