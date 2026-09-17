import { describe, it, expect, beforeEach, vi } from "vitest";

const getBrowser = vi.fn();
vi.mock("../pool", () => ({ getBrowser, closePool: vi.fn() }));
const serveFonts = vi.fn();
vi.mock("../fonts", () => ({ serveFonts, fontBaseUrl: "http://fonts.daport.local" }));
const { withPage } = await import("../page");

describe("withPage", () => {
  let page: { setContent: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> };
  let ctx: { newPage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let browser: { newContext: ReturnType<typeof vi.fn> };

  // mock 함수를 반환하면 vitest가 cleanup 훅으로 오인하므로 블록 본문을 쓴다
  beforeEach(() => {
    page = { setContent: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue(undefined) };
    ctx = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
    browser = { newContext: vi.fn().mockResolvedValue(ctx) };
    getBrowser.mockReset().mockResolvedValue(browser);
    serveFonts.mockReset().mockResolvedValue(undefined);
  });

  it("bounds setContent with timeout: 20_000 by default so two retry attempts fit the route's 60s", async () => {
    await withPage("<html></html>", { fontsDir: "/fonts" }, async () => "ok");
    expect(page.setContent).toHaveBeenCalledWith("<html></html>", expect.objectContaining({ timeout: 20_000 }));
  });

  it("honors an explicit setContentTimeoutMs override", async () => {
    await withPage("<html></html>", { fontsDir: "/fonts", setContentTimeoutMs: 5_000 }, async () => "ok");
    expect(page.setContent).toHaveBeenCalledWith("<html></html>", expect.objectContaining({ timeout: 5_000 }));
  });

  it("closes the context when fn rejects, and the rejection propagates", async () => {
    const err = new Error("boom");
    await expect(withPage("<html></html>", { fontsDir: "/fonts" }, async () => { throw err; })).rejects.toThrow("boom");
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("passes deviceScaleFactor to newContext only when set", async () => {
    await withPage("<html></html>", { fontsDir: "/fonts" }, async () => "ok");
    expect(browser.newContext).toHaveBeenLastCalledWith({});

    await withPage("<html></html>", { fontsDir: "/fonts", deviceScaleFactor: 2 }, async () => "ok");
    expect(browser.newContext).toHaveBeenLastCalledWith({ deviceScaleFactor: 2 });
  });
});
