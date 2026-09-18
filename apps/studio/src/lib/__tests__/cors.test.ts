// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { corsHeaders, preflight, withCors, parseOrigins } from "../cors";

afterEach(() => { vi.unstubAllEnvs(); });
const req = (origin?: string) => new Request("http://localhost/x", { headers: origin ? { origin } : {} });

describe("cors", () => {
  it("adds headers only for listed origins", () => {
    vi.stubEnv("DAPORT_CORS_ORIGINS", "https://mes.example.com, http://localhost:5173");
    expect(corsHeaders(req("https://mes.example.com"))).toMatchObject({ "access-control-allow-origin": "https://mes.example.com", "access-control-allow-headers": "content-type, x-api-key", "vary": "origin" });
    expect(corsHeaders(req("https://evil.example.com"))).toEqual({});
    expect(corsHeaders(req())).toEqual({});
    expect(parseOrigins(undefined)).toEqual([]);
  });
  it("preflight is 204 and withCors decorates an existing response", async () => {
    vi.stubEnv("DAPORT_CORS_ORIGINS", "https://mes.example.com");
    const p = preflight(req("https://mes.example.com"));
    expect(p.status).toBe(204);
    expect(p.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    const res = withCors(req("https://mes.example.com"), new Response("x", { status: 401 }));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://mes.example.com");
    expect(res.headers.get("access-control-expose-headers")).toBe("x-daport-version, content-disposition, x-daport-pages");
  });
});
