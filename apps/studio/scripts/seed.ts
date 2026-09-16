import { DbReportStore } from "../src/lib/report-store";
import fixture from "../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json";
const s = new DbReportStore();
s.create(fixture as any).then(() => console.log("seeded quality-cert")).catch((e) => { console.error(e.message); process.exit(1); });
