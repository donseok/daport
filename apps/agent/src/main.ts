import { readFileSync } from "node:fs";
import { createDirectConnector, type ManagedConnector } from "@daport/oracle";
import { FakeSqlConnector } from "@daport/oracle/testing";
import { createAgentServer } from "./server";
import { AGENT_VERSION } from "./index";

const env = process.env;
const need = (name: string) => { const v = env[name]; if (!v) { console.error(`${name} 환경변수가 필요합니다`); process.exit(1); } return v; };

const token = need("AGENT_TOKEN");
if (token.length < 32) { console.error("AGENT_TOKEN은 32자 이상이어야 합니다"); process.exit(1); }
const connector: ManagedConnector = env.AGENT_FAKE === "1"
  ? new FakeSqlConnector()   // 테스트·E2E: 고정 결과
  : createDirectConnector({ name: "agent", via: "direct", host: need("ORACLE_HOST"), port: Number(env.ORACLE_PORT ?? 1521), service: need("ORACLE_SERVICE"), user: need("ORACLE_USER"), secretRef: "ORACLE_PASSWORD" }, need("ORACLE_PASSWORD"));
const tls = env.AGENT_TLS_CERT && env.AGENT_TLS_KEY ? { cert: readFileSync(env.AGENT_TLS_CERT, "utf8"), key: readFileSync(env.AGENT_TLS_KEY, "utf8") } : undefined;
const server = createAgentServer({ connector, token, version: AGENT_VERSION, maxConcurrency: Number(env.AGENT_MAX_CONCURRENCY ?? 8), tls });
const port = Number(env.AGENT_PORT ?? 8433);
server.listen(port, () => console.log(`daport agent ${AGENT_VERSION} listening on ${tls ? "https" : "http"}://0.0.0.0:${port} (${env.AGENT_FAKE === "1" ? "fake" : "oracle"})`));
const shutdown = () => { server.close(() => { connector.close().finally(() => process.exit(0)); }); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
