// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { parseReport } from "@daport/core";

afterEach(() => { vi.unstubAllEnvs(); (globalThis as { __daportLlm?: unknown }).__daportLlm = undefined; });

describe("lib/ai", () => {
  it("getLlmClient: null without a key, fake with AI_FAKE=1", async () => {
    const { getLlmClient } = await import("../ai");
    vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("AI_FAKE", "");
    expect(getLlmClient()).toBeNull();
    vi.stubEnv("AI_FAKE", "1");
    (globalThis as { __daportLlm?: unknown }).__daportLlm = undefined;
    expect(getLlmClient()).not.toBeNull();
  });
  it("getLlmClient: AI_FAKE=1 is ignored in production without a key", async () => {
    const { getLlmClient } = await import("../ai");
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AI_FAKE", "1"); vi.stubEnv("GEMINI_API_KEY", "");
    (globalThis as { __daportLlm?: unknown }).__daportLlm = undefined;
    expect(getLlmClient()).toBeNull();
  });
  it("buildContext collects fields from sample data (names/types only), params and the component library", async () => {
    const { buildContext } = await import("../ai");
    const { getComponentStore } = await import("../component-store");
    await getComponentStore().create(`aihdr${Date.now() % 100000}`, { name: "헤더", w: 190, h: 20, props: [{ name: "title", type: "string", default: "" }], elements: [{ id: "h", type: "text", x: 0, y: 0, w: 190, h: 20, value: "{{ props.title }}" }] } as never);
    const report = parseReport({ id: "r", version: 1, page: { width: 210, height: 297 },
      datasets: [{ name: "items", type: "static", rows: [{ NO: "A", QTY: 1 }] }],
      sample: { params: {}, data: { items: [{ NO: "SECRET-VALUE", QTY: 2 }] }, capturedAt: "2026-09-18T00:00:00.000Z" } });
    const ctx = await buildContext(report, ["x"], [{ role: "user", text: "hi" }]);
    expect(ctx.fields.items.map((f) => `${f.path}:${f.type}`)).toEqual(["NO:string", "QTY:number"]);
    expect(JSON.stringify(ctx.fields)).not.toContain("SECRET-VALUE");
    expect(ctx.library.some((c) => c.name === "헤더" && c.props[0].name === "title")).toBe(true);
    expect(ctx.selection).toEqual(["x"]);
    expect(ctx.history).toHaveLength(1);
  });
});
