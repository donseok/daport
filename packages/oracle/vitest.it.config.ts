import { defineConfig } from "vitest/config";

// ORACLE_IT=1 pnpm --filter @daport/oracle test:it — 컨테이너 Oracle에 실제로 붙는다 (README 참고)
export default defineConfig({ test: { include: ["src/__it__/**/*.it.test.ts"], testTimeout: 120_000, hookTimeout: 600_000, fileParallelism: false } });
