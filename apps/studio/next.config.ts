import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@daport/core"],
  serverExternalPackages: ["playwright"],
};
export default config;
