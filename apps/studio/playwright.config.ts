import { defineConfig } from "@playwright/test";

const E2E_AGENT_TOKEN = "e2e-agent-token-0123456789abcdef";   // 32자 이상

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", headless: true },
  webServer: [
    { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000, env: { ...process.env, DAPORT_DEV_API_KEY: "e2e-dev-key", DAPORT_SECRET_E2E_AGENT: E2E_AGENT_TOKEN } },
    // 가짜 에이전트. /health는 토큰 없이 401을 돌려주며 Playwright는 401도 "떠 있음"으로 본다
    { command: "pnpm --filter agent dev", url: "http://localhost:8433/health", reuseExistingServer: !process.env.CI, timeout: 60_000, env: { ...process.env, AGENT_FAKE: "1", AGENT_TOKEN: E2E_AGENT_TOKEN, AGENT_PORT: "8433" } },
  ],
});
