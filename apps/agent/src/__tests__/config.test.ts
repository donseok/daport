import { describe, it, expect, vi, afterEach } from "vitest";
import type { ManagedConnector } from "@daport/oracle";
import { int, shutdown } from "../config";

afterEach(() => { vi.unstubAllEnvs(); });

describe("int", () => {
  it("parses positive integers and falls back on anything else", () => {
    vi.stubEnv("X", "12");
    expect(int("X", 8)).toBe(12);
    vi.stubEnv("X", "abc");
    expect(int("X", 8)).toBe(8);
    vi.stubEnv("X", "");
    expect(int("X", 8)).toBe(8);
    vi.stubEnv("X", "0");
    expect(int("X", 8)).toBe(8);
    vi.stubEnv("X", undefined);
    expect(int("X", 8)).toBe(8);
  });
});

describe("shutdown", () => {
  it("closes all connections, closes the connector and exits once the server finishes closing", async () => {
    const connectorClose = vi.fn().mockResolvedValue(undefined);
    const connector = { query: vi.fn(), ping: vi.fn(), close: connectorClose } as unknown as ManagedConnector;
    let closeCb: (() => void) | undefined;
    const closeAllConnections = vi.fn();
    const server = {
      close: vi.fn((cb: () => void) => { closeCb = cb; }),
      closeAllConnections,
    } as unknown as Parameters<typeof shutdown>[0];
    const exit = vi.fn();

    shutdown(server, connector, exit);
    expect(closeAllConnections).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);

    closeCb?.();
    await Promise.resolve(); await Promise.resolve();
    expect(connectorClose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
