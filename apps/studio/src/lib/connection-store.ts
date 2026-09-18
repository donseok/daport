import { asc, eq } from "drizzle-orm";
import { parseConnection, type Connection } from "@daport/datasource";
import { db } from "@/db/client";
import { connections } from "@/db/schema";

export interface ConnectionStore {
  list(): Promise<Connection[]>;
  get(name: string): Promise<Connection | null>;
  upsert(conn: Connection): Promise<void>;     // 스키마 검증 후 저장
  delete(name: string): Promise<boolean>;      // 없으면 false
}

export class MemoryConnectionStore implements ConnectionStore {
  private map = new Map<string, Connection>();
  async list() { return [...this.map.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  async get(name: string) { return this.map.get(name) ?? null; }
  async upsert(conn: Connection) { const c = parseConnection(conn); this.map.set(c.name, c); }
  async delete(name: string) { return this.map.delete(name); }
}

export class DbConnectionStore implements ConnectionStore {
  async list() { return (await db().select().from(connections).orderBy(asc(connections.name))).map((r) => parseConnection(r.body)); }
  async get(name: string) { const [row] = await db().select().from(connections).where(eq(connections.name, name)); return row ? parseConnection(row.body) : null; }
  async upsert(conn: Connection) {
    const c = parseConnection(conn);
    await db().insert(connections).values({ name: c.name, body: c }).onConflictDoUpdate({ target: connections.name, set: { body: c, updatedAt: new Date() } });
  }
  async delete(name: string) { return (await db().delete(connections).where(eq(connections.name, name)).returning({ name: connections.name })).length > 0; }
}

const holder = globalThis as typeof globalThis & { __daportConnectionStore?: ConnectionStore };
export function getConnectionStore(): ConnectionStore {
  return (holder.__daportConnectionStore ??= process.env.DATABASE_URL ? new DbConnectionStore() : new MemoryConnectionStore());
}
