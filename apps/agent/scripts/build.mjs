import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
// 단일 파일 번들. oracledb는 external — 배포물은 dist/ + dist/package.json (pnpm install --prod 후 node dist/agent.mjs)
await build({ entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node20", outfile: "dist/agent.mjs", external: ["oracledb"], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
mkdirSync("dist", { recursive: true });
writeFileSync("dist/package.json", JSON.stringify({ name: "daport-agent", private: true, type: "module", dependencies: { oracledb: "^6.5.0" } }, null, 2));
console.log("built dist/agent.mjs");
