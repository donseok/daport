// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MemoryApiKeyStore } from "../api-key-store";
import { authorize } from "../auth";

const req = (key?: string) => new Request("http://localhost/x", { headers: key ? { "x-api-key": key } : {} });

describe("authorize", () => {
  it("401 without a key or with a bad key, 403 for a report outside the allow-list, ok otherwise", async () => {
    const s = new MemoryApiKeyStore();
    const { rawKey } = await s.create("MES", ["a"]);
    const missing = await authorize(req(), "a", s);
    expect(missing.ok).toBe(false);
    if (!missing.ok) { expect(missing.response.status).toBe(401); expect(await missing.response.json()).toEqual({ error: "인증 실패", code: "UNAUTHORIZED" }); }
    const bad = await authorize(req("dpk_bad"), "a", s);
    expect(!bad.ok && bad.response.status).toBe(401);
    const forbidden = await authorize(req(rawKey), "b", s);
    expect(!forbidden.ok && forbidden.response.status).toBe(403);
    if (!forbidden.ok) expect((await forbidden.response.json()).code).toBe("FORBIDDEN");
    const ok = await authorize(req(rawKey), "a", s);
    expect(ok.ok && ok.key.name).toBe("MES");
  });
  it("a null allow-list allows every report", async () => {
    const s = new MemoryApiKeyStore();
    const { rawKey } = await s.create("all");
    expect((await authorize(req(rawKey), "anything", s)).ok).toBe(true);
  });
});
