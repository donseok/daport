import { eq } from "drizzle-orm";
import { parseReport, type Report, type ReportInput } from "@daport/core";
import { db } from "@/db/client";
import { reports } from "@/db/schema";

export type ReportSummary = { id: string; name: string; updatedAt: string };

export interface ReportStore {
  list(): Promise<ReportSummary[]>;
  get(id: string): Promise<Report | null>;
  create(input: ReportInput): Promise<Report>;
  update(id: string, input: ReportInput): Promise<Report>;
}

export class MemoryReportStore implements ReportStore {
  private map = new Map<string, Report>();
  async list() { return [...this.map.values()].map((r) => ({ id: r.id, name: r.name, updatedAt: new Date().toISOString() })); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async create(input: ReportInput) {
    const r = parseReport(input);
    if (this.map.has(r.id)) throw new Error(`report exists: ${r.id}`);
    this.map.set(r.id, r); return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    if (!this.map.has(id)) throw new Error(`report not found: ${id}`);
    this.map.set(id, r); return r;
  }
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
    await db().insert(reports).values({ id: r.id, name: r.name, draft: r });
    return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const res = await db().update(reports).set({ name: r.name, draft: r, updatedAt: new Date() }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new Error(`report not found: ${id}`);
    return r;
  }
}

let store: ReportStore | null = null;
export function getStore(): ReportStore {
  if (!store) store = process.env.DATABASE_URL ? new DbReportStore() : new MemoryReportStore();
  return store;
}
