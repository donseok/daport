// dev 서버에 AI_FAKE=1이 있어야 한다 (playwright.config webServer.env가 넣는다). 가짜 응답은 lib/ai.ts의 fakeScript
// 이미 떠 있는 dev 서버를 재사용하면 AI_FAKE가 없어 503이 난다
import { test, expect, type Page } from "@playwright/test";

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

test("edit: instruction → proposal overlay → apply → undo restores", async ({ page }) => {
  const id = `e2e-ai-edit-${Date.now()}`;
  await createReport(page, id);
  // 빈 레포트라 "+ 텍스트"로 추가한 요소가 /elements/0이 된다. 가짜 편집 응답은 /elements/0/value를 바꾼다
  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await page.getByLabel("AI 지시").fill("제목을 '검사 성적서'로 바꿔");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await expect(page.getByTestId("ai-proposal")).toContainText("검사 성적서");
  const canvasPage = page.getByTestId("canvas").locator(".dp-page").first();
  await expect(canvasPage).not.toContainText("검사 성적서");        // 적용 전 불변
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("ai-proposal")).toHaveCount(0);
  await expect(canvasPage).toContainText("검사 성적서");
  await page.getByRole("button", { name: "되돌리기" }).click();
  await expect(canvasPage).not.toContainText("검사 성적서");
});

test("generate: empty report → brief → proposal → apply → save → reload keeps it", async ({ page }) => {
  const id = `e2e-ai-gen-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await expect(page.getByTestId("ai-generate-mode")).toBeChecked();
  await page.getByLabel("AI 지시").fill("품질보증서: 제목과 본문 영역");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await page.getByTestId("ai-apply").click();
  await expect(page.getByTestId("canvas")).toContainText("품질보증서");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save")).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("canvas")).toContainText("품질보증서");
});

test("forbidden paths in the answer are dropped with a warning", async ({ page }) => {
  const id = `e2e-ai-forbid-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "+ 텍스트", exact: true }).click();
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await page.getByLabel("AI 지시").fill("금지 경로 테스트");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-turn").last()).toContainText("/output");
  // 가짜 응답은 op 2개(/output/kind, /name)를 내지만 /output/kind는 금지 경로라 걸러지고 1개만 남는다
  await expect(page.getByTestId("ai-proposal-bar")).toContainText("op 1");
});
