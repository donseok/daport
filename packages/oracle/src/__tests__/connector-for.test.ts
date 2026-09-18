import { describe, it, expect, vi } from "vitest";
vi.mock("oracledb", () => ({ default: { createPool: vi.fn(), OUT_FORMAT_OBJECT: 4002, STRING: 2001 } }));
const { connectorFor } = await import("../index");

describe("connectorFor", () => {
  const secrets = (name: string) => ({ MES_DB: "pw", AGENT: "tok" }[name]);
  it("picks the connector by via and fails with SQL_NOT_CONFIGURED when the secret is missing", () => {
    expect(typeof connectorFor({ name: "a", via: "direct", host: "h", port: 1521, service: "s", user: "u", secretRef: "MES_DB" }, secrets).query).toBe("function");
    expect(typeof connectorFor({ name: "b", via: "agent", url: "https://x", secretRef: "AGENT" }, secrets).ping).toBe("function");
    expect(() => connectorFor({ name: "c", via: "agent", url: "https://x", secretRef: "NOPE" }, secrets)).toThrow(expect.objectContaining({ code: "SQL_NOT_CONFIGURED" }));
  });
});
