import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import qualityCert from "../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json" with { type: "json" };

// Monaco는 보이는 줄만 DOM에 그리므로(가상화) 편집기 내용은 JsonEditor가 window.monaco로 노출한 모델에서 읽고 쓴다
const readModel = (page: Page) => page.evaluate(() => {
  const monaco = (window as any).monaco;
  const m = monaco?.editor.getModels().find((x: any) => x.uri.path.endsWith("report.json"));
  return m ? (m.getValue() as string) : null;
});
/** 편집기 JSON에서 최상위 요소의 x (편집기가 아직 없거나 JSON이 깨졌으면 null) */
const elementX = async (page: Page, id: string) => {
  const text = await readModel(page);
  try { return JSON.parse(text ?? "").elements.find((e: { id: string }) => e.id === id).x as number; } catch { return null; }
};
const titleX = (page: Page) => elementX(page, "title");

/** 홈 화면 폼으로 빈 레포트를 만들고 에디터 캔버스가 뜰 때까지 기다린다 */
async function createReport(page: Page, id: string, size: string) {
  await page.goto("/");
  await page.getByLabel("ID").fill(id);
  await page.getByLabel("크기").selectOption(size);
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

const ptToMm = (pt: number) => pt / 72 * 25.4;

test("edit quality-cert: drag updates JSON, JSON updates canvas, undo, pdf", async ({ page }) => {
  // 재사용한 dev 서버에는 이전 실행이 옮겨 저장한 품질보증서가 남아 있을 수 있다. 제목이 원위치가 아니면 픽스처로 되돌린다
  const stored = await page.request.get("/api/reports/quality-cert");
  expect(stored.ok()).toBe(true);
  const storedTitle = (await stored.json()).elements.find((e: { id: string }) => e.id === "title");
  if (storedTitle?.x !== 15 || storedTitle?.y !== 20) {
    const reset = await page.request.put("/api/reports/quality-cert", { data: qualityCert });
    expect(reset.ok(), `reset quality-cert HTTP ${reset.status()}`).toBe(true);
  }

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

// 완료 기준 1: 캔버스 편집을 저장하면 새로고침 후에도 남는다. 실행마다 새 레포트를 만들어 서버를 재사용해도 결과가 같다
test("new report: drag a text element, save, reload keeps position", async ({ page }) => {
  const id = `e2e-save-${Date.now()}`;
  await createReport(page, id, "210x297");
  await expect.poll(() => readModel(page), { timeout: 30_000 }).not.toBeNull();   // Monaco 로드 완료

  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  const text = page.getByTestId("canvas").locator('[data-element-id="text-1"]');
  await expect(text).toBeVisible();
  await expect.poll(() => elementX(page, "text-1")).toBe(10);

  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + 96, box.y + 10, { steps: 5 });   // +25.4mm
  await page.mouse.up();
  await expect.poll(() => elementX(page, "text-1")).toBe(35.5);   // 10 + 25.5 (0.5mm 스냅)
  await expect(text).toHaveAttribute("style", /left:\s?35\.5mm/);

  // 저장: PUT 응답을 받고 버튼이 다시 비활성(저장됨)이 될 때까지 기다린 뒤 새로고침한다
  const save = page.getByTestId("save");
  await expect(save).toBeEnabled();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PUT" && new URL(r.url()).pathname === `/api/reports/${id}`),
    save.click(),
  ]);
  expect(res.ok()).toBe(true);
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(text).toHaveAttribute("style", /left:\s?35\.5mm/);
  await expect.poll(() => elementX(page, "text-1"), { timeout: 30_000 }).toBe(35.5);
});

// 완료 기준 5: 빈 A4 세로·A4 가로·60×40 Tag 레포트가 캔버스와 PDF에서 그 크기로 나온다
test("create empty A4 portrait, A4 landscape and tag reports: canvas and PDF sizes", async ({ page }) => {
  for (const [name, size, w, h] of [["portrait", "210x297", 210, 297], ["land", "297x210", 297, 210], ["tag", "60x40", 60, 40]] as const) {
    const id = `e2e-${name}-${Date.now()}`;
    await createReport(page, id, size);
    const width = await page.getByTestId("canvas").locator(".dp-page").evaluate((el) => getComputedStyle(el).width);
    expect(Math.round(parseFloat(width))).toBe(Math.round(w / 25.4 * 96));

    const res = await page.request.post(`/api/reports/${id}/pdf`, { data: {} });
    expect(res.ok(), `${id} PDF HTTP ${res.status()}`).toBe(true);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    const pdf = await PDFDocument.load(await res.body());
    expect(pdf.getPageCount(), `${id} PDF pages`).toBe(1);
    const { width: pw, height: ph } = pdf.getPage(0).getSize();
    expect(Math.abs(ptToMm(pw) - w), `${id} PDF width ${ptToMm(pw)}mm`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(ptToMm(ph) - h), `${id} PDF height ${ptToMm(ph)}mm`).toBeLessThanOrEqual(0.5);
  }
});
