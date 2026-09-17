import { DbReportStore, SEED_FIXTURES } from "../src/lib/report-store";
import type { ReportInput } from "@daport/core";
const s = new DbReportStore();
Promise.allSettled(SEED_FIXTURES.map((f) => s.create(f as ReportInput).then(() => console.log(`seeded ${(f as { id: string }).id}`))))
  .then((results) => {
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error(`seed failed: ${(SEED_FIXTURES[i] as { id?: string }).id}`, r.reason instanceof Error ? r.reason.message : r.reason);
    });
    // 하나라도 실패하면 종료 코드 1 (CI 게이트용)
    process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
  });
