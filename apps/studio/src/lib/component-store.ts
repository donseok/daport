import { and, asc, eq } from "drizzle-orm";
import { COMPONENT_ID_RE, ComponentBodySchema, componentHash, parseComponentBody, type ComponentBody } from "@daport/core";
import { db } from "@/db/client";
import { components, componentVersions } from "@/db/schema";
import { ConflictError } from "./preset-store";
import { NotFoundError } from "./report-store";

export type ComponentSummary = { id: string; name: string; latestVersion: number; w: number; h: number; updatedAt: string };
export type ComponentDetail = { summary: ComponentSummary; versions: { version: number; hash: string; createdAt: string }[]; latest: ComponentBody };

export interface ComponentStore {
  list(): Promise<ComponentSummary[]>;
  get(id: string): Promise<ComponentDetail | null>;
  getVersion(id: string, version: number): Promise<{ body: ComponentBody; hash: string } | null>;
  /** 버전 1을 만든다. id 중복이면 ConflictError, id 형식·내용 스키마 오류는 Error */
  create(id: string, body: ComponentBody): Promise<{ version: 1; hash: string }>;
  /** 해시가 최신 버전과 같으면 created=false로 버전을 그대로 두고, 다르면 다음 버전을 만든다. 없는 id는 NotFoundError */
  save(id: string, body: ComponentBody): Promise<{ version: number; hash: string; created: boolean }>;
  /** 컴포넌트와 모든 버전을 지운다. 없는 id는 NotFoundError. 사용 중 검사는 라우트가 한다 */
  delete(id: string): Promise<void>;
}

/** 입력을 검증해 기본값이 채워진 내용과 그 해시를 만든다. 저장·비교는 늘 이 파싱 결과로 한다 */
function prepareBody(input: unknown): { body: ComponentBody; hash: string } {
  const body = parseComponentBody(input);
  return { body, hash: componentHash(body) };
}

function checkId(id: string): void {
  if (!COMPONENT_ID_RE.test(id)) throw new Error(`invalid component id: ${id} (영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다)`);
}

type MemVersion = { version: number; body: ComponentBody; hash: string; createdAt: string };
type MemEntry = { id: string; name: string; updatedAt: string; versions: MemVersion[] };

const latestOf = (e: MemEntry): MemVersion => e.versions[e.versions.length - 1];
const summaryOf = (e: MemEntry): ComponentSummary => {
  const latest = latestOf(e);
  return { id: e.id, name: e.name, latestVersion: latest.version, w: latest.body.w, h: latest.body.h, updatedAt: e.updatedAt };
};

export class MemoryComponentStore implements ComponentStore {
  private map = new Map<string, MemEntry>();

  async list() { return [...this.map.values()].map(summaryOf); }

  async get(id: string) {
    const e = this.map.get(id);
    if (!e) return null;
    return {
      summary: summaryOf(e),
      versions: e.versions.map(({ version, hash, createdAt }) => ({ version, hash, createdAt })),
      // 버전 내용은 불변이다. 호출자가 고쳐도 저장된 내용이 바뀌지 않게 복제해서 돌려준다
      latest: structuredClone(latestOf(e).body),
    };
  }

  async getVersion(id: string, version: number) {
    const v = this.map.get(id)?.versions.find((x) => x.version === version);
    return v ? { body: structuredClone(v.body), hash: v.hash } : null;
  }

  async create(id: string, input: ComponentBody) {
    checkId(id);
    const { body, hash } = prepareBody(input);
    if (this.map.has(id)) throw new ConflictError(id);
    const now = new Date().toISOString();
    this.map.set(id, { id, name: body.name, updatedAt: now, versions: [{ version: 1, body, hash, createdAt: now }] });
    return { version: 1 as const, hash };
  }

  async save(id: string, input: ComponentBody) {
    const e = this.map.get(id);
    if (!e) throw new NotFoundError(id);
    const { body, hash } = prepareBody(input);
    const latest = latestOf(e);
    if (latest.hash === hash) return { version: latest.version, hash, created: false };
    const now = new Date().toISOString();
    const version = latest.version + 1;
    e.versions.push({ version, body, hash, createdAt: now });
    e.name = body.name;
    e.updatedAt = now;
    return { version, hash, created: true };
  }

  async delete(id: string) {
    if (!this.map.delete(id)) throw new NotFoundError(id);
  }
}

/** Postgres unique_violation. drizzle가 드라이버 오류를 cause로 감싸므로 사슬을 따라간다(report-store와 같은 규칙) */
function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) if ((cur as { code?: unknown }).code === "23505") return true;
  return false;
}

type ComponentRow = typeof components.$inferSelect;
const rowSummary = (c: ComponentRow, body: ComponentBody): ComponentSummary =>
  ({ id: c.id, name: c.name, latestVersion: c.latestVersion, w: body.w, h: body.h, updatedAt: c.updatedAt.toISOString() });
/** components와 그 최신 버전 행을 잇는 조건 */
const latestJoin = and(eq(componentVersions.componentId, components.id), eq(componentVersions.version, components.latestVersion));

export class DbComponentStore implements ComponentStore {
  async list() {
    const rows = await db().select({ c: components, body: componentVersions.body })
      .from(components).innerJoin(componentVersions, latestJoin).orderBy(asc(components.createdAt));
    // 저장된 행 하나가 스키마에 안 맞아도 GET /api/components 전체가 죽지 않도록 그 행만 건너뛴다 (DbPresetStore와 같은 규칙)
    const out: ComponentSummary[] = [];
    for (const r of rows) {
      const parsed = ComponentBodySchema.safeParse(r.body);
      if (parsed.success) out.push(rowSummary(r.c, parsed.data));
      else console.warn(`잘못된 컴포넌트 행을 건너뜁니다: ${r.c.id}`, parsed.error);
    }
    return out;
  }

  async get(id: string) {
    const d = db();
    const [row] = await d.select({ c: components, body: componentVersions.body })
      .from(components).innerJoin(componentVersions, latestJoin).where(eq(components.id, id));
    if (!row) return null;
    const latest = parseComponentBody(row.body);
    const versions = await d.select({ version: componentVersions.version, hash: componentVersions.hash, createdAt: componentVersions.createdAt })
      .from(componentVersions).where(eq(componentVersions.componentId, id)).orderBy(asc(componentVersions.version));
    return {
      summary: rowSummary(row.c, latest),
      versions: versions.map((v) => ({ version: v.version, hash: v.hash, createdAt: v.createdAt.toISOString() })),
      latest,
    };
  }

  async getVersion(id: string, version: number) {
    const [row] = await db().select({ body: componentVersions.body, hash: componentVersions.hash }).from(componentVersions)
      .where(and(eq(componentVersions.componentId, id), eq(componentVersions.version, version)));
    return row ? { body: parseComponentBody(row.body), hash: row.hash } : null;
  }

  async create(id: string, input: ComponentBody) {
    checkId(id);
    const { body, hash } = prepareBody(input);
    const d = db();
    try {
      // neon-http는 transaction()을 지원하지 않는다. batch는 한 HTTP 트랜잭션으로 실행되어 둘 다 들어가거나 둘 다 안 들어간다
      await d.batch([
        d.insert(components).values({ id, name: body.name, latestVersion: 1 }),
        d.insert(componentVersions).values({ componentId: id, version: 1, body, hash }),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(id);
      throw e;
    }
    return { version: 1 as const, hash };
  }

  async save(id: string, input: ComponentBody) {
    const d = db();
    const [cur] = await d.select({ latestVersion: components.latestVersion, hash: componentVersions.hash })
      .from(components).innerJoin(componentVersions, latestJoin).where(eq(components.id, id));
    if (!cur) throw new NotFoundError(id);
    const { body, hash } = prepareBody(input);
    if (cur.hash === hash) return { version: cur.latestVersion, hash, created: false };
    const version = cur.latestVersion + 1;
    try {
      // 두 요청이 같은 최신 버전을 읽고 동시에 저장하면 뒤쪽의 (component_id, version) 삽입이 PK 위반으로 실패하고
      // batch 전체가 되돌려진다. update의 latest_version 조건은 그 사이 번호가 앞질러 가지 않게 하는 이중 안전장치다
      await d.batch([
        d.insert(componentVersions).values({ componentId: id, version, body, hash }),
        d.update(components).set({ name: body.name, latestVersion: version, updatedAt: new Date() })
          .where(and(eq(components.id, id), eq(components.latestVersion, cur.latestVersion))),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(id);
      throw e;
    }
    return { version, hash, created: true };
  }

  async delete(id: string) {
    // component_versions는 on delete cascade로 함께 지워진다(한 문장이라 원자적)
    const res = await db().delete(components).where(eq(components.id, id)).returning({ id: components.id });
    if (res.length === 0) throw new NotFoundError(id);
  }
}

// 레포트·프리셋 저장소와 같은 이유(Next가 페이지와 라우트 핸들러를 따로 번들)로 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportComponentStore?: ComponentStore };
export function getComponentStore(): ComponentStore {
  if (!holder.__daportComponentStore) holder.__daportComponentStore = process.env.DATABASE_URL ? new DbComponentStore() : new MemoryComponentStore();
  return holder.__daportComponentStore;
}
