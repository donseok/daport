import { defineConfig } from "vitest/config";

// 기본 실행은 실제 Gemini 호출 없이 돈다. __it__는 vitest.it.config.ts로만 수집한다
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["src/__it__/**"] } });
