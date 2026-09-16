import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  esbuild: { jsx: "automatic" },   // tsconfig의 jsx:"preserve"를 그대로 쓰면 React.createElement 런타임이 되어 TSX 테스트가 깨진다
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
