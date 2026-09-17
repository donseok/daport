import { and, asc, eq, sql } from "drizzle-orm";
import { parseReport, reportHash, type Report, type ReportInput } from "@daport/core";
import { db } from "@/db/client";
import { reports, reportVersions } from "@/db/schema";
import qualityCert from "../../../../packages/renderer/src/__tests__/fixtures/quality-cert.report.json";
import inspectionCert from "../../../../packages/renderer/src/__tests__/fixtures/inspection-cert.report.json";
import invoice from "../../../../packages/renderer/src/__tests__/fixtures/invoice.report.json";
import shippingOrder from "../../../../packages/renderer/src/__tests__/fixtures/shipping-order.report.json";
import badgeSheet from "../../../../packages/renderer/src/__tests__/fixtures/badge-sheet.report.json";
import coilTag from "../../../../packages/renderer/src/__tests__/fixtures/coil-tag.report.json";
import productLabel from "../../../../packages/renderer/src/__tests__/fixtures/product-label.report.json";

/** dev 서버·E2E가 여는 예제. 예제 전용 코드는 없고 JSON만 넣는다 */
export const SEED_FIXTURES: unknown[] = [qualityCert, inspectionCert, invoice, shippingOrder, badgeSheet, coilTag, productLabel];

export type ReportSummary = { id: string; name: string; updatedAt: string; publishedVersion: number | null; modified: boolean };
export type VersionSummary = { version: number; createdAt: string; note: string | null; hash: string; published: boolean };
export type VersionList = { versions: VersionSummary[]; publishedVersion: number | null; draftHash: string };
export type PublishedReport = { version: number; report: Report };

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
  addVersion(id: string, model: Report, note?: string): Promise<{ version: number; createdAt: string }>;
  publish(id: string, model: Report, note?: string): Promise<{ version: number; createdAt: string }>;
  setPublished(id: string, version: number): Promise<void>;
  listVersions(id: string): Promise<VersionList | null>;
  getVersion(id: string, version: number): Promise<Report | null>;
  getPublished(id: string): Promise<PublishedReport | null>;
}

type MemVersion = { version: number; model: Report; hash: string; note: string | null; createdAt: string };
type MemEntry = { report: Report; updatedAt: string; draftHash: string; publishedVersion: number | null; versions: MemVersion[] };

export class MemoryReportStore implements ReportStore {
  private map = new Map<string, MemEntry>();
  private entry(id: string): MemEntry { const e = this.map.get(id); if (!e) throw new NotFoundError(id); return e; }
  private summary(e: MemEntry): ReportSummary {
    const published = e.versions.find((v) => v.version === e.publishedVersion);
    return { id: e.report.id, name: e.report.name, updatedAt: e.updatedAt, publishedVersion: e.publishedVersion, modified: !!published && published.hash !== e.draftHash };
  }
  async list() { return [...this.map.values()].map((e) => this.summary(e)); }
  async get(id: string) { return this.map.get(id)?.report ?? null; }
  async create(input: ReportInput) {
    const r = parseReport(input);
    if (this.map.has(r.id)) throw new Error(`report exists: ${r.id}`);
    this.map.set(r.id, { report: r, updatedAt: new Date().toISOString(), draftHash: reportHash(r), publishedVersion: null, versions: [] }); return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const e = this.entry(id);
    this.map.set(id, { ...e, report: r, updatedAt: new Date().toISOString(), draftHash: reportHash(r) }); return r;
  }
  async addVersion(id: string, model: Report, note?: string) {
    const e = this.entry(id);
    const stored = parseReport({ ...structuredClone(model), id });   // 버전은 불변이라 호출자 객체와 끊는다
    const version = (e.versions[e.versions.length - 1]?.version ?? 0) + 1;
    const createdAt = new Date().toISOString();
    e.versions.push({ version, model: stored, hash: reportHash(stored), note: note ?? null, createdAt });
    return { version, createdAt };
  }
  async publish(id: string, model: Report, note?: string) {
    const res = await this.addVersion(id, model, note);
    this.entry(id).publishedVersion = res.version;
    return res;
  }
  async setPublished(id: string, version: number) {
    const e = this.entry(id);
    if (!e.versions.some((v) => v.version === version)) throw new NotFoundError(`${id}@${version}`);
    e.publishedVersion = version;
  }
  async listVersions(id: string) {
    const e = this.map.get(id);
    if (!e) return null;
    return { versions: e.versions.map(({ version, createdAt, note, hash }) => ({ version, createdAt, note, hash, published: version === e.publishedVersion })), publishedVersion: e.publishedVersion, draftHash: e.draftHash };
  }
  async getVersion(id: string, version: number) {
    const v = this.map.get(id)?.versions.find((x) => x.version === version);
    return v ? structuredClone(v.model) : null;
  }
  async getPublished(id: string) {
    const e = this.map.get(id);
    if (!e || e.publishedVersion === null) return null;
    const report = await this.getVersion(id, e.publishedVersion);
    return report ? { version: e.publishedVersion, report } : null;
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
    // 배포 버전의 해시를 함께 읽어 "수정됨"을 판정한다. draft_hash가 null인 옛 행은 수정됨으로 본다
    const rows = await db().select({ id: reports.id, name: reports.name, updatedAt: reports.updatedAt, publishedVersion: reports.publishedVersion, draftHash: reports.draftHash, publishedHash: reportVersions.hash })
      .from(reports).leftJoin(reportVersions, and(eq(reportVersions.reportId, reports.id), eq(reportVersions.version, reports.publishedVersion)));
    return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt.toISOString(), publishedVersion: r.publishedVersion, modified: r.publishedHash !== null && r.publishedHash !== r.draftHash }));
  }
  async get(id: string) {
    const [row] = await db().select().from(reports).where(eq(reports.id, id));
    return row ? parseReport(row.draft) : null;
  }
  async create(input: ReportInput) {
    const r = parseReport(input);
    try {
      await db().insert(reports).values({ id: r.id, name: r.name, draft: r, draftHash: reportHash(r) });
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error(`report exists: ${r.id}`);
      throw e;
    }
    return r;
  }
  async update(id: string, input: ReportInput) {
    const r = parseReport({ ...input, id });
    const res = await db().update(reports).set({ name: r.name, draft: r, draftHash: reportHash(r), updatedAt: new Date() }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new NotFoundError(id);
    return r;
  }
  private async exists(id: string): Promise<boolean> {
    return (await db().select({ id: reports.id }).from(reports).where(eq(reports.id, id))).length > 0;
  }
  async addVersion(id: string, model: Report, note?: string) {
    if (!(await this.exists(id))) throw new NotFoundError(id);
    const stored = parseReport({ ...model, id });
    const hash = reportHash(stored);
    // neon-http는 트랜잭션이 없다. max+1로 넣고 동시 배포로 유일성 위반이 나면 한 번만 다시 센다
    for (let attempt = 0; ; attempt++) {
      const [{ max }] = await db().select({ max: sql<number | null>`max(${reportVersions.version})` }).from(reportVersions).where(eq(reportVersions.reportId, id));
      const version = (max ?? 0) + 1;
      try {
        const [row] = await db().insert(reportVersions).values({ reportId: id, version, model: stored, hash, note: note ?? null }).returning({ createdAt: reportVersions.createdAt });
        return { version, createdAt: row.createdAt.toISOString() };
      } catch (e) {
        if (attempt === 0 && isUniqueViolation(e)) continue;
        throw e;
      }
    }
  }
  async publish(id: string, model: Report, note?: string) {
    const res = await this.addVersion(id, model, note);
    await db().update(reports).set({ publishedVersion: res.version }).where(eq(reports.id, id));
    return res;
  }
  async setPublished(id: string, version: number) {
    if (!(await this.getVersion(id, version))) throw new NotFoundError(`${id}@${version}`);
    const res = await db().update(reports).set({ publishedVersion: version }).where(eq(reports.id, id)).returning({ id: reports.id });
    if (res.length === 0) throw new NotFoundError(id);
  }
  async listVersions(id: string) {
    const [head] = await db().select({ draft: reports.draft, draftHash: reports.draftHash, publishedVersion: reports.publishedVersion }).from(reports).where(eq(reports.id, id));
    if (!head) return null;
    const rows = await db().select({ version: reportVersions.version, createdAt: reportVersions.createdAt, note: reportVersions.note, hash: reportVersions.hash })
      .from(reportVersions).where(eq(reportVersions.reportId, id)).orderBy(asc(reportVersions.version));
    return {
      versions: rows.map((r) => ({ version: r.version, createdAt: r.createdAt.toISOString(), note: r.note, hash: r.hash, published: r.version === head.publishedVersion })),
      publishedVersion: head.publishedVersion,
      draftHash: head.draftHash ?? reportHash(parseReport(head.draft)),
    };
  }
  async getVersion(id: string, version: number) {
    const [row] = await db().select({ model: reportVersions.model }).from(reportVersions).where(and(eq(reportVersions.reportId, id), eq(reportVersions.version, version)));
    return row ? parseReport(row.model) : null;
  }
  async getPublished(id: string) {
    const [head] = await db().select({ publishedVersion: reports.publishedVersion }).from(reports).where(eq(reports.id, id));
    if (!head || head.publishedVersion === null) return null;
    const report = await this.getVersion(id, head.publishedVersion);
    return report ? { version: head.publishedVersion, report } : null;
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
