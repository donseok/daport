import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";

export type ApiKeyInfo = { kid: string; name: string; allowedReportIds: string[] | null; createdAt: string; revokedAt: string | null };

/** 키 원문 형식 dpk_<kid 8자>_<secret 32자 이상 base64url> (4단계 스펙 4.3) */
export const KEY_RE = /^dpk_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;
const KID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateKey(): { kid: string; rawKey: string; hash: string } {
  const kid = Array.from(randomBytes(8), (b) => KID_ALPHABET[b % KID_ALPHABET.length]).join("");
  const rawKey = `dpk_${kid}_${randomBytes(24).toString("base64url")}`;   // 24바이트 → 32자
  return { kid, rawKey, hash: hashKey(rawKey) };
}

/** 두 hex 해시를 길이까지 상수 시간으로 비교한다 */
function sameHash(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export interface ApiKeyStore {
  /** 원문을 검증해 활성 키 정보를 돌려준다. 형식 오류·없음·해시 불일치·회수됨은 전부 null (어느 경우인지 구분하지 않는다) */
  verify(raw: string): Promise<ApiKeyInfo | null>;
  list(): Promise<ApiKeyInfo[]>;
  create(name: string, allowed?: string[] | null): Promise<{ key: ApiKeyInfo; rawKey: string }>;
  revoke(kid: string): Promise<void>;
}

type MemKey = ApiKeyInfo & { hash: string };
const info = ({ hash: _h, ...k }: MemKey): ApiKeyInfo => k;

/** dev·테스트용. devKey가 있으면 그 원문을 전체 허용 키로 인정한다(DATABASE_URL이 없을 때 DAPORT_DEV_API_KEY) */
export class MemoryApiKeyStore implements ApiKeyStore {
  private keys = new Map<string, MemKey>();
  constructor(private devKey?: string) {}
  async verify(raw: string) {
    if (this.devKey && raw === this.devKey) return { kid: "dev", name: "DAPORT_DEV_API_KEY", allowedReportIds: null, createdAt: new Date(0).toISOString(), revokedAt: null };
    const m = KEY_RE.exec(raw);
    const k = m ? this.keys.get(m[1]) : undefined;
    if (!k || k.revokedAt || !sameHash(hashKey(raw), k.hash)) return null;
    return info(k);
  }
  async list() { return [...this.keys.values()].map(info); }
  async create(name: string, allowed: string[] | null = null) {
    const g = generateKey();
    const key: MemKey = { kid: g.kid, name, allowedReportIds: allowed, createdAt: new Date().toISOString(), revokedAt: null, hash: g.hash };
    this.keys.set(g.kid, key);
    return { key: info(key), rawKey: g.rawKey };
  }
  async revoke(kid: string) {
    const k = this.keys.get(kid);
    if (!k) throw new Error(`api key not found: ${kid}`);
    k.revokedAt = new Date().toISOString();
  }
}

const rowInfo = (r: typeof apiKeys.$inferSelect): ApiKeyInfo =>
  ({ kid: r.id, name: r.name, allowedReportIds: r.allowedReportIds, createdAt: r.createdAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null });

export class DbApiKeyStore implements ApiKeyStore {
  async verify(raw: string) {
    const m = KEY_RE.exec(raw);
    if (!m) return null;
    const [row] = await db().select().from(apiKeys).where(eq(apiKeys.id, m[1]));
    if (!row || row.revokedAt || !sameHash(hashKey(raw), row.keyHash)) return null;
    return rowInfo(row);
  }
  async list() { return (await db().select().from(apiKeys)).map(rowInfo); }
  async create(name: string, allowed: string[] | null = null) {
    const g = generateKey();
    const [row] = await db().insert(apiKeys).values({ id: g.kid, name, keyHash: g.hash, allowedReportIds: allowed }).returning();
    return { key: rowInfo(row), rawKey: g.rawKey };
  }
  async revoke(kid: string) {
    const res = await db().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, kid)).returning({ id: apiKeys.id });
    if (res.length === 0) throw new Error(`api key not found: ${kid}`);
  }
}

// report-store와 같은 이유로 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportApiKeyStore?: ApiKeyStore };
export function getApiKeyStore(): ApiKeyStore {
  if (!holder.__daportApiKeyStore) {
    holder.__daportApiKeyStore = process.env.DATABASE_URL ? new DbApiKeyStore() : new MemoryApiKeyStore(process.env.DAPORT_DEV_API_KEY || undefined);
  }
  return holder.__daportApiKeyStore;
}
