import { describe, it, expect, vi } from "vitest";

const launch = vi.fn();
vi.mock("playwright", () => ({ chromium: { launch } }));

describe("browser pool", () => {
  it("retries the launch after a failed one instead of keeping the rejected promise", async () => {
    const { getBrowser } = await import("../pool");
    const browser = { isConnected: () => true, close: vi.fn() };
    launch.mockRejectedValueOnce(new Error("launch failed")).mockResolvedValueOnce(browser);
    await expect(getBrowser()).rejects.toThrow("launch failed");
    await expect(getBrowser()).resolves.toBe(browser);
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
