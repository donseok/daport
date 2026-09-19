import { defineConfig } from "vitest/config";
// GEMINI_IT=1 GEMINI_API_KEY=... pnpm --filter @daport/ai test:it — 실제 Gemini API를 호출한다
export default defineConfig({ test: { include: ["src/__it__/**/*.it.test.ts"], testTimeout: 90_000 } });
