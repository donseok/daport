// dev 서버에 DAPORT_SECRET_E2E_AGENT=e2e-agent-token-0123456789abcdef, 에이전트에 같은 AGENT_TOKEN과 AGENT_FAKE=1이 있어야 한다 (playwright.config webServer가 넣는다)
// 이미 :3000에 dev 서버가 떠 있으면(reuseExistingServer) DAPORT_SECRET_E2E_AGENT가 없어 연결 테스트가 400이 된다 — 실행 전 기존 프로세스를 내려야 한다
import { test, expect, type Page } from "@playwright/test";
import { E2E_AGENT_PORT } from "../playwright.config";

const MIME = "application/x-daport-field";

async function createReport(page: Page, id: string) {
  await page.goto("/");
  await page.getByLabel("ID", { exact: true }).fill(id);
  await page.getByLabel("크기").selectOption("210x297");
  await page.getByRole("button", { name: "새 레포트" }).click();
  await expect(page).toHaveURL(new RegExp(`/reports/${id}$`));
  await expect(page.getByTestId("canvas").locator(".dp-page")).toBeVisible();
}

test("register an agent connection, test it, run a sql dataset through it, bind a field, render PDF; delete is refused while in use", async ({ page }) => {
  const name = `e2e-agent-${Date.now() % 100000}`;
  await page.goto("/settings/connections");
  await page.getByLabel("방식").selectOption("agent");
  // "이름"이 "비밀값 이름"의 부분 문자열이라 strict mode 충돌을 피하려면 exact가 필요하다
  await page.getByLabel("이름", { exact: true }).fill(name);
  await page.getByLabel("URL").fill(`http://localhost:${E2E_AGENT_PORT}`);
  await page.getByLabel("비밀값 이름").fill("E2E_AGENT");
  await page.getByRole("button", { name: "연결 저장" }).click();
  const row = page.getByTestId(`conn-${name}`);
  await expect(row).toContainText("설정됨");
  await row.locator('button[name="test"]').click();
  await expect(page.getByTestId(`test-${name}`)).toContainText("OK");

  const id = `e2e-sql-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "데이터" }).click();
  await page.getByRole("button", { name: "+ sql" }).click();
  await page.getByLabel("이름", { exact: true }).fill("lines");
  await page.getByLabel("연결").selectOption(name);
  await page.getByLabel("쿼리").fill("SELECT NO, QTY, DT FROM LINES WHERE NO = :orderNo");
  await expect(page.getByTestId("binds")).toContainText(":orderNo");
  await page.getByRole("button", { name: "쿼리 확인" }).click();
  await expect(page.getByTestId("guard-result")).toContainText("허용");
  await page.getByTestId("fetch-sample").click();
  const fields = page.getByTestId("fields-lines");
  await expect(fields.locator('[data-path="NO"]')).toBeVisible();
  // FieldTree는 타입을 텍스트("date")가 아니라 기호로 보여준다(MARK: date → "◷"). 컬럼 타입 힌트가 반영됐는지 그 기호로 확인한다
  await expect(fields.locator('[data-path="DT"]')).toContainText("◷");

  // 필드를 캔버스에 드롭 → 값 표시 → PDF. HTML5 DnD는 DataTransfer를 직접 만들어 drop 이벤트로 보낸다 (phase2.spec.ts와 동일한 방식 — dragTo는 실제 DnD를 흉내 내지 못한다)
  const canvas = page.getByTestId("canvas");
  const dt = await page.evaluateHandle((mime) => {
    const dt = new DataTransfer();
    dt.setData(mime, JSON.stringify({ dataset: "lines", path: "NO", type: "string", isArray: false }));
    return dt;
  }, MIME);
  const box = (await canvas.locator(".dp-page").boundingBox())!;
  await canvas.locator(".dp-page").dispatchEvent("drop", { dataTransfer: dt, clientX: box.x + 80, clientY: box.y + 80 });
  await expect(canvas).toContainText("A-1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await page.getByTestId("save").click();

  // 사용 중 삭제 거부
  await page.goto("/settings/connections");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId(`conn-${name}`).locator('button[name="delete"]').click();
  await expect(page.getByTestId(`conn-${name}`)).toContainText(id);
});

test("guard rejects a write query in the editor", async ({ page }) => {
  const id = `e2e-guard-${Date.now()}`;
  await createReport(page, id);
  await page.getByRole("button", { name: "데이터" }).click();
  await page.getByRole("button", { name: "+ sql" }).click();
  await page.getByLabel("쿼리").fill("DELETE FROM T");
  await page.getByRole("button", { name: "쿼리 확인" }).click();
  await expect(page.getByTestId("guard-result")).toContainText("SELECT 또는 WITH");
});
