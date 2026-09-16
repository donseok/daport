import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "../../packages/renderer/fonts";
if (!existsSync(src)) process.exit(0);
mkdirSync("public/fonts", { recursive: true });
cpSync(src, "public/fonts", { recursive: true });
