// dev 서버에 AI_FAKE=1이 있어야 한다 (playwright.config webServer.env가 넣는다). 가짜 응답은 lib/ai.ts의 fakeScript
// 이관 라우트는 이 테스트에서 처음 호출되므로 dev 서버가 그 파일들(scan.ts의 sharp 전처리 포함)을 콜드 컴파일한다.
// 편집·생성보다 느리므로 제안이 뜨는지 보는 단언에만 넉넉한 timeout을 준다
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// studio는 "type": "module"이라 __dirname이 없다 — import.meta.url에서 같은 값을 얻는다
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("이미지 이관: 업로드 → 제안 → 적용 → 되돌리기", async ({ page }) => {
  const id = `e2e-ai-import-${Date.now()}`;
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();

  await page.getByRole("tab", { name: "AI", exact: true }).click();
  // 새 레포트는 210x297(A4 세로)라 기본 이관 용지 선택("a4-portrait")과 이미 같으므로 선택기를 건드리지 않는다
  await page.getByTestId("ai-import-file").setInputFiles(path.join(__dirname, "fixtures/form.png"));

  await expect(page.getByTestId("ai-proposal")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ai-proposal")).toContainText("검사 성적서");
  const canvasPage = page.getByTestId("canvas").locator(".dp-page").first();
  await expect(canvasPage).not.toContainText("검사 성적서");     // 적용 전 불변

  await page.getByTestId("ai-apply").click();
  await expect(canvasPage).toContainText("검사 성적서");
  await expect(page.getByTestId("scan-overlay")).toBeVisible();   // 대조 배경은 적용 후에도 남는다

  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(canvasPage).not.toContainText("검사 성적서");
});
