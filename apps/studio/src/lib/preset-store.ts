import { eq } from "drizzle-orm";
import { PresetSchema, type Preset, type PresetInput } from "@daport/core";
import { db } from "@/db/client";
import { presets } from "@/db/schema";
import { BUILTIN_PRESETS, isBuiltinPresetId } from "./presets";
import { NotFoundError } from "./report-store";

export class ConflictError extends Error { constructor(id: string) { super(`preset exists: ${id}`); this.name = "ConflictError"; } }
export class ForbiddenError extends Error { constructor(id: string) { super(`builtin preset cannot be deleted: ${id}`); this.name = "ForbiddenError"; } }

export interface PresetStore {
  list(): Promise<Preset[]>;            // 내장 + 사용자 정의
  get(id: string): Promise<Preset | null>;
  create(input: PresetInput): Promise<Preset>;   // builtin은 항상 false로 저장
  delete(id: string): Promise<void>;
}

const parseUser = (input: PresetInput): Preset => {
  const p = PresetSchema.parse({ ...input, builtin: false });
  if (isBuiltinPresetId(p.id)) throw new ConflictError(p.id);
  return p;
};

export class MemoryPresetStore implements PresetStore {
  private map = new Map<string, Preset>();
  async list() { return [...BUILTIN_PRESETS, ...this.map.values()]; }
  async get(id: string) { return BUILTIN_PRESETS.find((p) => p.id === id) ?? this.map.get(id) ?? null; }
  async create(input: PresetInput) {
    const p = parseUser(input);
    if (this.map.has(p.id)) throw new ConflictError(p.id);
    this.map.set(p.id, p); return p;
  }
  async delete(id: string) {
    if (isBuiltinPresetId(id)) throw new ForbiddenError(id);
    if (!this.map.delete(id)) throw new NotFoundError(id);
  }
}

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur instanceof Error; cur = cur.cause) if ((cur as { code?: unknown }).code === "23505") return true;
  return false;
}

export class DbPresetStore implements PresetStore {
  async list() {
    const rows = await db().select().from(presets).orderBy(presets.createdAt);
    return [...BUILTIN_PRESETS, ...rows.map((r) => PresetSchema.parse(r.body))];
  }
  async get(id: string) {
    const b = BUILTIN_PRESETS.find((p) => p.id === id); if (b) return b;
    const [row] = await db().select().from(presets).where(eq(presets.id, id));
    return row ? PresetSchema.parse(row.body) : null;
  }
  async create(input: PresetInput) {
    const p = parseUser(input);
    try { await db().insert(presets).values({ id: p.id, name: p.name, body: p }); }
    catch (e) { if (isUniqueViolation(e)) throw new ConflictError(p.id); throw e; }
    return p;
  }
  async delete(id: string) {
    if (isBuiltinPresetId(id)) throw new ForbiddenError(id);
    const res = await db().delete(presets).where(eq(presets.id, id)).returning({ id: presets.id });
    if (res.length === 0) throw new NotFoundError(id);
  }
}

// 레포트 저장소와 같은 이유로 globalThis에 한 번만 둔다
const holder = globalThis as typeof globalThis & { __daportPresetStore?: PresetStore };
export function getPresetStore(): PresetStore {
  if (!holder.__daportPresetStore) holder.__daportPresetStore = process.env.DATABASE_URL ? new DbPresetStore() : new MemoryPresetStore();
  return holder.__daportPresetStore;
}
