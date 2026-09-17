import { eq } from "drizzle-orm";
import { parseReport, type Report, type ReportInput } from "@daport/core";
import { db } from "@/db/client";
import { reports } from "@/db/schema";
import qualityCert from "../../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json";
import inspectionCert from "../../../../packages/renderer/src/__tests__/fixtures/inspection-cert.report.json";
import invoice from "../../../../packages/renderer/src/__tests__/fixtures/invoice.report.json";
import shippingOrder from "../../../../packages/renderer/src/__tests__/fixtures/shipping-order.report.json";
import badgeSheet from "../../../../packages/renderer/src/__tests__/fixtures/badge-sheet.report.json";

/** dev 서버·E2E가 여는 예제. 예제 전용 코드는 없고 JSON만 넣는다 */
export const SEED_FIXTURES: unknown[] = [qualityCert, inspectionCert, invoice, shippingOrder, badgeSheet];

export type ReportSummary = { id: string; name: string; updatedAt: string };

/** Thrown by update() when no report has the given id. Handlers map it to 404. */
export class NotFoundError extends Error {
  constructor(id: string) {
    super(`report not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export interface ReportStore {
  list(): Promise<ReportSummary[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  update(id: string, input: ReportInput): Promise<Report>;
}

export class MemoryReportStore implements ReportStore {
  private map = new Map<string, { report: Report; updatedAt: string }>();
  async list() { return [...this.map.values()].map(({ report: r, updatedAt }) => ({ id: r.id, name: r.name, updatedAt })); }
  async get(id: string) { return this.map.get(id)?.report ?? null; }
  async create(input: ReportInput) {
    const r = parseReport(input);
    if (this.map.has(r.id)) throw new Error(`report exists: ${r.id}`);
    this.map.set(r.id, { report: r, updatedAt: new Date().toISOString() }); return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    if (!this.map.has(id)) throw new NotFoundError(id);
    this.map.set(id, { report: r, updatedAt: new Date().toISOString() }); return r;
  }
}

/** Postgres unique_violation. drizzle wraps the driver error in DrizzleQueryError, whose `cause` is the NeonDbError carrying `code`. */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) {
    if ((cur as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

export class DbReportStore implements ReportStore {
  async list() {
    const rows = await db().select({ id: reports.id, name: reports.name, updatedAt: reports.updatedAt }).from(reports);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }
  async get(id: string) {
    const [row] = await db().select().from(reports).where(eq(reports.id, id));
    return row ? parseReport(row.draft) : null;
  }
  async create(input: ReportInput) {
    const r = parseReport(input);
    try {
      await db().insert(reports).values({ id: r.id, name: r.name, draft: r });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error(`report exists: ${r.id}`);
      throw e;
    }
    return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const res = await db().update(reports).set({ name: r.name, draft: r, updatedAt: new Date() }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new NotFoundError(id);
    return r;
  }
}

// Next는 페이지와 라우트 핸들러를 따로 번들해 모듈 인스턴스가 갈리므로, 메모리 저장소와 시드 약속은 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportReportStore?: ReportStore; __daportSeeded?: Promise<void> };
export function getStore(): ReportStore {
  if (!holder.__daportReportStore) {
    const store = process.env.DATABASE_URL ? new DbReportStore() : new MemoryReportStore();
    holder.__daportReportStore = store;
    // 메모리 저장소는 프로세스마다 비므로 dev 서버 부팅 시 예제 픽스처를 넣는다 (DB는 scripts/seed.ts)
    // 픽스처 하나가 깨져도 그 실패를 __daportSeeded에 담아두면 이후 모든 ready() 호출이 dev 서버 수명 내내 reject된다 —
    // allSettled로 개별 실패를 로그만 남기고 삼켜서 나머지 라우트가 항상 열리게 한다
    if (!process.env.DATABASE_URL)
      holder.__daportSeeded = Promise.allSettled(SEED_FIXTURES.map((f) => store.create(f as ReportInput))).then((rs) => {
        rs.forEach((r, i) => {
          if (r.status === "rejected") console.error(`seed failed: ${(SEED_FIXTURES[i] as { id?: string }).id}`, r.reason instanceof Error ? r.reason.message : r.reason);
        });
      });
  }
  return holder.__daportReportStore;
}
/** 시드가 끝나면 풀린다. 호출 순서가 getStore()보다 앞서도 되도록 저장소를 먼저 만든다. */
export function ready(): Promise<void> { getStore(); return holder.__daportSeeded ?? Promise.resolve(); }
