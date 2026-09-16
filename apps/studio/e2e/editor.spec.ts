import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

// Monaco는 보이는 줄만 DOM에 그리므로(가상화) 편집기 내용은 JsonEditor가 window.monaco로 노출한 모델에서 읽고 쓴다
const readModel = (page: Page) => page.evaluate(() => {
  const monaco = (window as any).monaco;
  const m = monaco?.editor.getModels().find((x: any) => x.uri.path.endsWith("report.json"));
  return m ? (m.getValue() as string) : null;
});
const titleX = async (page: Page) => {
  const text = await readModel(page);
  try { return JSON.parse(text ?? "").elements.find((e: { id: string }) => e.id === "title").x as number; } catch { return null; }
};

test("edit quality-cert: drag updates JSON, JSON updates canvas, undo, pdf", async ({ page }) => {
  await page.goto("/reports/quality-cert");
  const canvas = page.getByTestId("canvas");
  await expect(canvas.locator('[data-element-id="title"]')).toBeVisible();
  await expect.poll(() => titleX(page), { timeout: 30_000 }).toBe(15);   // Monaco 로드 완료

  // 캔버스 드래그 → JSON 반영
  const title = canvas.locator('[data-element-id="title"]');
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + 96, box.y + 10, { steps: 5 });   // +25.4mm
  await page.mouse.up();
  await expect.poll(() => readModel(page)).toContain('"x": 40.5');   // 15 + 25.5 (0.5mm 스냅)
  expect(await titleX(page)).toBe(40.5);

  // 되돌리기
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => titleX(page)).toBe(15);
  expect(await readModel(page)).not.toContain('"x": 40.5');

  // JSON 편집 → 캔버스 반영 (title y: 20 → 60)
  await page.evaluate(() => {
    const m = (window as any).monaco.editor.getModels().find((x: any) => x.uri.path.endsWith("report.json"));
    m.setValue(m.getValue().replace('"y": 20,', '"y": 60,'));
  });
  await expect(title).toHaveAttribute("style", /top:\s?60mm/);

  // PDF 응답
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("create A4 landscape and tag reports", async ({ page }) => {
  for (const [id, size, w] of [["land", "297x210", "297mm"], ["tag", "60x40", "60mm"]] as const) {
    await page.goto("/");
    await page.getByLabel("ID").fill(id + Date.now());
    await page.getByLabel("크기").selectOption(size);
    await page.getByRole("button", { name: "새 레포트" }).click();
    await expect(page.getByTestId("canvas").locator(".dp-page")).toHaveCSS("width", /.*/);
    const width = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
    expect(Math.round(parseFloat(width))).toBe(Math.round(parseFloat(w) / 25.4 * 96));
  }
});
