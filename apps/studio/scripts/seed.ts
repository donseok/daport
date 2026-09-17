import { DbReportStore, SEED_FIXTURES } from "../src/lib/report-store";
import type { ReportInput } from "@daport/core";
const s = new DbReportStore();
Promise.all(SEED_FIXTURES.map((f) => s.create(f as ReportInput).then(() => console.log(`seeded ${(f as { id: string }).id}`)).catch((e) => console.error(e.message))))
  .then(() => process.exit(0));
