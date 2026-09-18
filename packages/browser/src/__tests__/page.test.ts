import { describe, it, expect, beforeEach, vi } from "vitest";

const getBrowser = vi.fn();
vi.mock("../pool", () => ({ getBrowser, closePool: vi.fn() }));
const serveFonts = vi.fn();
vi.mock("../fonts", () => ({ serveFonts, fontBaseUrl: "http://fonts.daport.local" }));
const { withPage, isAllowedUrl } = await import("../page");

// ctx가 describe 바깥(withPage allowHosts 등)에서도 보이도록 모듈 스코프로 올린다
let ctx: { newPage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; route: ReturnType<typeof vi.fn> };

describe("withPage", () => {
  let page: { setContent: ReturnType<typeof vi.fn>; evaluate: ReturnType<typeof vi.fn> };
  let browser: { newContext: ReturnType<typeof vi.fn> };

  // mock 함수를 반환하면 vitest가 cleanup 훅으로 오인하므로 블록 본문을 쓴다
  beforeEach(() => {
    page = { setContent: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue(undefined) };
    ctx = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn(), route: vi.fn().mockResolvedValue(undefined) };
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

describe("withPage allowHosts", () => {
  function fakeRoute(url: string) {
    return { request: () => ({ url: () => url }), fallback: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  }
  it("does not intercept when allowHosts is not given", async () => {
    await withPage("<html></html>", { fontsDir: "/fonts" }, async () => "ok");
    expect(ctx.route).not.toHaveBeenCalled();
  });
  it("lets allowed hosts, the font origin and data: URLs through and aborts the rest with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withPage("<html></html>", { fontsDir: "/fonts", allowHosts: ["studio.local:3000", "cdn.example.com"] }, async () => "ok");
    expect(ctx.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    const handler = ctx.route.mock.calls[0][1] as (r: ReturnType<typeof fakeRoute>) => Promise<void>;
    const ok = [fakeRoute("http://studio.local:3000/api/assets/1"), fakeRoute("https://cdn.example.com/logo.png"), fakeRoute("http://fonts.daport.local/Pretendard-Regular.otf"), fakeRoute("data:image/png;base64,AAAA")];
    for (const r of ok) { await handler(r); expect(r.fallback).toHaveBeenCalledTimes(1); expect(r.abort).not.toHaveBeenCalled(); }
    const blocked = fakeRoute("https://evil.example.org/x.png");
    await handler(blocked);
    expect(blocked.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(blocked.fallback).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("evil.example.org"));
    warn.mockRestore();
  });
});

describe("isAllowedUrl", () => {
  it("compares host including a non-default port", () => {
    expect(isAllowedUrl("http://a.local:8080/x", ["a.local:8080"])).toBe(true);
    expect(isAllowedUrl("http://a.local:8081/x", ["a.local:8080"])).toBe(false);
    expect(isAllowedUrl("https://a.local/x", ["a.local"])).toBe(true);
    expect(isAllowedUrl("not a url", ["a.local"])).toBe(false);
    expect(isAllowedUrl("blob:http://x/1", [])).toBe(true);
  });
});
