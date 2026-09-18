import { defineConfig } from "vitest/config";
// 기본 실행은 실제 Oracle 없이 돈다. 통합 테스트(src/__it__)는 vitest.it.config.ts로만 수집한다
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["src/__it__/**"] } });
