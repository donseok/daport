import { describe, it, expect } from "vitest";
import { parseConnection, assertAgentUrl } from "../connection";

describe("ConnectionSchema", () => {
  it("parses direct with default port and agent", () => {
    expect(parseConnection({ name: "mes", via: "direct", host: "db.local", service: "ORCL", user: "rpt", secretRef: "MES_DB" })).toMatchObject({ port: 1521 });
    expect(parseConnection({ name: "factory", via: "agent", url: "https://agent.local:8433", secretRef: "AGENT" }).via).toBe("agent");
  });
  it("rejects bad names, secret refs, missing fields and bad agent urls", () => {
    expect(() => parseConnection({ name: "Mes", via: "direct", host: "h", service: "s", user: "u", secretRef: "A" })).toThrow();
    expect(() => parseConnection({ name: "mes", via: "direct", host: "h", service: "s", user: "u", secretRef: "lower" })).toThrow();
    expect(() => parseConnection({ name: "mes", via: "direct", host: "h", user: "u", secretRef: "A" })).toThrow();
    expect(() => parseConnection({ name: "mes", via: "agent", url: "http://agent.local", secretRef: "A" })).toThrow(/https/);
    expect(() => parseConnection({ name: "mes", via: "agent", url: "http://localhost:8433", secretRef: "A" })).not.toThrow();
    expect(() => assertAgentUrl("ftp://x")).toThrow();
  });
});
