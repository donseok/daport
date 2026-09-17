// @vitest-environment node
import { describe, it, expect } from "vitest";
import { MemoryApiKeyStore, KEY_RE } from "../api-key-store";
import { runKeys } from "../keys-cli";

describe("keys CLI", () => {
  it("create prints the raw key once, list hides it, revoke disables it", async () => {
    const s = new MemoryApiKeyStore();
    const out: string[] = [];
    expect(await runKeys(["create", "--name", "MES", "--reports", "a,b"], s, (l) => out.push(l))).toBe(0);
    const raw = out.find((l) => KEY_RE.test(l.trim()))?.trim();
    expect(raw).toBeDefined();
    expect((await s.verify(raw!))?.allowedReportIds).toEqual(["a", "b"]);
    out.length = 0;
    expect(await runKeys(["list"], s, (l) => out.push(l))).toBe(0);
    expect(out.join("\n")).toContain("MES");
    expect(out.join("\n")).not.toContain(raw!);
    const kid = (await s.list())[0].kid;
    expect(await runKeys(["revoke", kid], s, (l) => out.push(l))).toBe(0);
    expect(await s.verify(raw!)).toBeNull();
  });
  it("returns 1 with usage for an unknown command or a missing --name", async () => {
    const s = new MemoryApiKeyStore();
    const out: string[] = [];
    expect(await runKeys(["frobnicate"], s, (l) => out.push(l))).toBe(1);
    expect(await runKeys(["create"], s, (l) => out.push(l))).toBe(1);
    expect(out.join("\n")).toContain("keys create --name");
  });
});
