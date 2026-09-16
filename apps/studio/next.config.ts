import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@daport/core", "@daport/renderer"],
  serverExternalPackages: ["playwright"],
  agentRules: false, // stop `next dev`/`next build` from writing AGENTS.md / CLAUDE.md into apps/studio
};
export default config;
