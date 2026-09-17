// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { MemoryApiKeyStore, KEY_RE, generateKey, hashKey } from "../api-key-store";

afterEach(() => { vi.unstubAllEnvs(); });

describe("generateKey", () => {
  it("makes dpk_<kid>_<secret> keys whose hash is sha256 hex", () => {
    const k = generateKey();
    expect(k.rawKey).toMatch(KEY_RE);
    expect(k.rawKey.startsWith(`dpk_${k.kid}_`)).toBe(true);
    expect(k.hash).toBe(hashKey(k.rawKey));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateKey().kid).not.toBe(k.kid);
  });
});

describe("MemoryApiKeyStore", () => {
  it("verifies a created key, rejects others, and revokes", async () => {
    const s = new MemoryApiKeyStore();
    const { key, rawKey } = await s.create("MES", ["quality-cert"]);
    expect(key.allowedReportIds).toEqual(["quality-cert"]);
    expect((await s.verify(rawKey))?.kid).toBe(key.kid);
    expect(await s.verify(rawKey.slice(0, -1) + "x")).toBeNull();
    expect(await s.verify("garbage")).toBeNull();
    expect(await s.verify(`dpk_${key.kid}_${"a".repeat(32)}`)).toBeNull();
    await s.revoke(key.kid);
    expect(await s.verify(rawKey)).toBeNull();
    expect((await s.list())[0].revokedAt).not.toBeNull();
    await expect(s.revoke("nope0000")).rejects.toThrow(/not found/);
  });
  it("never returns the raw key from list()", async () => {
    const s = new MemoryApiKeyStore();
    const { rawKey } = await s.create("a");
    expect(JSON.stringify(await s.list())).not.toContain(rawKey);
  });
  it("accepts the dev key as an all-reports key", async () => {
    const s = new MemoryApiKeyStore("e2e-dev-key");
    expect(await s.verify("e2e-dev-key")).toMatchObject({ kid: "dev", allowedReportIds: null });
    expect(await s.verify("other")).toBeNull();
    expect(await new MemoryApiKeyStore().verify("e2e-dev-key")).toBeNull();
  });
});
