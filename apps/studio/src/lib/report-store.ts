import { eq } from "drizzle-orm";
import { parseReport, type Report, type ReportInput } from "@daport/core";
import { db } from "@/db/client";
import { reports } from "@/db/schema";

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

let store: ReportStore | null = null;
export function getStore(): ReportStore {
  if (!store) store = process.env.DATABASE_URL ? new DbReportStore() : new MemoryReportStore();
  return store;
}
