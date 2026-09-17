import { DbApiKeyStore } from "../src/lib/api-key-store";
import { runKeys } from "../src/lib/keys-cli";

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL이 필요합니다"); process.exit(1); }
runKeys(process.argv.slice(2), new DbApiKeyStore(), console.log).then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
