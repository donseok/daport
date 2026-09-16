import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseReport } from "@daport/core";

const getBrowser = vi.fn();
vi.mock("../pool", () => ({ getBrowser, closePool: vi.fn() }));
const { isBrowserCrash } = await import("../crash");
const { renderPdf } = await import("../index");

describe("isBrowserCrash", () => {
  it.each([
    "page.pdf: Target page, context or browser has been closed",
    "page.setContent: Target crashed ",
    "page.setContent: Page crashed",
    "Navigation failed because page crashed!",
    "Browser has been closed",
    "browser has disconnected",
  ])("retries %j", (message) => {
    expect(isBrowserCrash(new Error(message))).toBe(true);
  });

  it.each([
    "page.setContent: Timeout 20000ms exceeded.",
    "page.evaluate: ReferenceError: foo is not defined",
    "expression error: a.",
  ])("does not retry %j", (message) => {
    expect(isBrowserCrash(new Error(message))).toBe(false);
  });

  it("reads non-Error values as strings", () => {
    expect(isBrowserCrash("Target page, context or browser has been closed")).toBe(true);
    expect(isBrowserCrash(undefined)).toBe(false);
  });
});

describe("renderPdf retry", () => {
  const report = parseReport({ id: "t", version: 1, page: { width: 60, height: 40 } });
  const page = { setContent: vi.fn(), evaluate: vi.fn(), pdf: vi.fn() };
  const ctx = { route: vi.fn(), newPage: vi.fn(async () => page), close: vi.fn() };
  const browser = { newContext: vi.fn(async () => ctx) };

  beforeEach(() => {
    vi.clearAllMocks();
    page.pdf.mockReset();
    getBrowser.mockResolvedValue(browser);
  });

  it("retries once after a browser crash", async () => {
    page.pdf.mockRejectedValueOnce(new Error("page.pdf: Target page, context or browser has been closed")).mockResolvedValueOnce(Buffer.from("%PDF-"));
    await expect(renderPdf(report, { params: {} })).resolves.toEqual(Buffer.from("%PDF-"));
    expect(browser.newContext).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors such as a timeout", async () => {
    page.pdf.mockRejectedValue(new Error("page.setContent: Timeout 20000ms exceeded."));
    await expect(renderPdf(report, { params: {} })).rejects.toThrow("Timeout");
    expect(browser.newContext).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second crash", async () => {
    page.pdf.mockRejectedValue(new Error("page.pdf: Target crashed "));
    await expect(renderPdf(report, { params: {} })).rejects.toThrow("Target crashed");
    expect(browser.newContext).toHaveBeenCalledTimes(2);
  });

  it("bounds setContent with an explicit timeout so two attempts fit the route's 60s", async () => {
    page.pdf.mockResolvedValue(Buffer.from("%PDF-"));
    await renderPdf(report, { params: {} });
    expect(page.setContent).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 20_000 }));
  });
});
