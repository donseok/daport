import { describe, it, expect } from "vitest";
import { isBrowserCrash } from "../crash";

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
