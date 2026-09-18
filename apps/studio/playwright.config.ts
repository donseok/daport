import { defineConfig } from "@playwright/test";

const E2E_AGENT_TOKEN = "e2e-agent-token-0123456789abcdef";   // 32자 이상
export const E2E_AGENT_PORT = process.env.E2E_AGENT_PORT ?? "8433";   // 스펙과 무관한 로컬 포트 충돌을 피할 수 있도록 오버라이드 가능

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", headless: true },
  webServer: [
    // AI_FAKE=1: E2E는 실제 Gemini를 부르지 않고 lib/ai.ts의 fakeScript로 고정 응답을 낸다
    { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000, env: { ...process.env, DAPORT_DEV_API_KEY: "e2e-dev-key", DAPORT_SECRET_E2E_AGENT: E2E_AGENT_TOKEN, AI_FAKE: "1" } },
    // 가짜 에이전트. /health는 토큰 없이 401을 돌려주며 Playwright는 401도 "떠 있음"으로 본다
    { command: "pnpm --filter agent dev", url: `http://localhost:${E2E_AGENT_PORT}/health`, reuseExistingServer: !process.env.CI, timeout: 60_000, env: { ...process.env, AGENT_FAKE: "1", AGENT_TOKEN: E2E_AGENT_TOKEN, AGENT_PORT: E2E_AGENT_PORT } },
  ],
});
