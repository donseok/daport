import { describe, it, expect, vi } from "vitest";
import { parseReport, type HttpDataset } from "@daport/core";
import { executeDatasets, createFetchHttpConnector, buildHttpRequest, parseAllowList, DatasetFailure, DEFAULT_LIMITS } from "../index";

const SECRET = "tok-9f3a";
const secrets = (n: string) => ({ MES_TOKEN: SECRET, OTHER: "zz-other" } as Record<string, string>)[n];
const ok = () => new Response(JSON.stringify([{ a: 1 }]), { status: 200 });
type Call = { url: string; init: RequestInit };
function fetchSpy(respond: (url: string) => Response = ok) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return respond(String(url)); }) as unknown as typeof fetch;
  return { f, calls };
}
const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };
const ds = (extra: Partial<HttpDataset>): HttpDataset => ({ name: "d", type: "http", method: "GET", url: "https://mes.example.com/x", headers: {}, ...extra });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DatasetFailure).code; } return "none"; };

async function run(extra: object, opts: { allow?: string[]; params?: Record<string, unknown>; respond?: (url: string) => Response } = {}) {
  const report = parseReport({ id: "p", version: 1, page: { width: 10, height: 10 }, params: [{ name: "no" }, { name: "lot" }],
    datasets: [{ name: "d", type: "http", url: "https://mes.example.com/x", ...extra }] });
  const spy = fetchSpy(opts.respond);
  const http = createFetchHttpConnector({ allow: opts.allow ?? ["mes.example.com=MES_TOKEN"], fetch: spy.f });
  const r = await executeDatasets(report, { params: opts.params ?? {}, connectors: { http }, secrets });
  return { ...r, calls: spy.calls };
}

describe("secrets never enter expressions", () => {
  it("rejects any secrets reference in the url without calling fetch", async () => {
    const { errors, calls } = await run({ url: "https://mes.example.com/log?t={{ secrets.MES_TOKEN }}" });
    expect(errors.map((e) => e.code)).toEqual(["BAD_PARAM"]);
    expect(calls).toHaveLength(0);
  });
  it("cannot branch on secret characters (no oracle)", async () => {
    for (const guess of ["t", "x"]) {
      const { errors, calls } = await run({ headers: { X: `{{ secrets.MES_TOKEN[0] == '${guess}' ? 'a' : 'b' }}` } });
      expect(errors.map((e) => e.code)).toEqual(["BAD_PARAM"]);
      expect(calls).toHaveLength(0);
    }
  });
  it("substitutes an exact token in headers after evaluation, and params cannot inject a token", () => {
    const { request } = buildHttpRequest(ds({ headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}", Echo: "{{ params.lot }}" } }), { lot: "{{ secrets.MES_TOKEN }}" }, secrets);
    expect(request.headers).toEqual({ Authorization: `Bearer ${SECRET}`, Echo: "{{ secrets.MES_TOKEN }}" });
    expect(request.secretNames).toEqual(["MES_TOKEN"]);
  });
});

describe("secret bindings in the allow list", () => {
  it("parses host[:port]=NAME|NAME, lower-casing only the host", () => {
    expect(parseAllowList(" MES.example.com=MES_TOKEN|Other , api.local:8080 ,, [::1]:9000=A")).toEqual(["mes.example.com=MES_TOKEN|Other", "api.local:8080", "[::1]:9000=A"]);
  });
  it("sends a secret only to a host bound to that name", async () => {
    const bound = await run({ headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}" } });
    expect(bound.errors).toEqual([]);
    expect((bound.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    const unbound = await run({ headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}" } }, { allow: ["mes.example.com"] });
    expect(unbound.errors.map((e) => e.code)).toEqual(["HOST_NOT_ALLOWED"]);
    expect(unbound.calls).toHaveLength(0);
    const other = await run({ headers: { Authorization: "Bearer {{ secrets.OTHER }}" } });
    expect(other.errors.map((e) => e.code)).toEqual(["HOST_NOT_ALLOWED"]);
    expect(JSON.stringify(other.errors)).not.toContain("zz-other");
  });
});

describe("host matching", () => {
  const req = (url: string) => ({ method: "GET" as const, url, headers: {} });
  it("normalizes default ports, trailing dots, case, IPv6, and rejects userinfo", async () => {
    const { f } = fetchSpy();
    const c = createFetchHttpConnector({ allow: ["mes.example.com:443", "api.local", "[::1]:9000"], fetch: f });
    await expect(c.request(req("https://MES.example.com./a"), limits)).resolves.toBeDefined();
    await expect(c.request(req("https://mes.example.com:443/a"), limits)).resolves.toBeDefined();
    await expect(c.request(req("http://mes.example.com/a"), limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(c.request(req("http://api.local:1234/a"), limits)).resolves.toBeDefined();
    await expect(c.request(req("http://[::1]:9000/a"), limits)).resolves.toBeDefined();
    await expect(c.request(req("http://[::1]:9001/a"), limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(c.request(req("https://u:p@mes.example.com/a"), limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
});

describe("url templates", () => {
  it("rejects dot path segments produced by params", async () => {
    const { errors, calls } = await run({ url: "https://mes.example.com/api/orders/{{ params.no }}/detail" }, { params: { no: ".." } });
    expect(errors.map((e) => e.code)).toEqual(["BAD_PARAM"]);
    expect(calls).toHaveLength(0);
    expect(code(() => buildHttpRequest(ds({ url: "https://mes.example.com/a/{{ params.no }}" }), { no: "." }, secrets))).toBe("BAD_PARAM");
    expect(buildHttpRequest(ds({ url: "https://mes.example.com/a/{{ params.no }}" }), { no: "../b" }, secrets).request.url).toBe("https://mes.example.com/a/..%2Fb");
  });
  it("requires a literal scheme and host before the first template", () => {
    expect(code(() => buildHttpRequest(ds({ url: "https://{{ params.no }}/a" }), { no: "evil.com" }, secrets))).toBe("BAD_PARAM");
    expect(code(() => buildHttpRequest(ds({ url: "{{ params.no }}" }), { no: "https://evil.com" }, secrets))).toBe("BAD_PARAM");
  });
  it("rejects CR or LF in header values", () => {
    expect(code(() => buildHttpRequest(ds({ headers: { X: "{{ params.no }}" } }), { no: "a\r\nInjected: 1" }, secrets))).toBe("BAD_PARAM");
  });
});

describe("JSON body", () => {
  it("evaluates templates inside string values, so params cannot break out of a string", () => {
    const { request } = buildHttpRequest(ds({ method: "POST", body: '{"lot":"{{ params.lot }}","qty":1,"no":"{{ params.no }}","tag":"L-{{ params.no }}"}' }), { lot: 'x","qty":999,"z":"', no: 7 }, secrets);
    expect(JSON.parse(request.body!)).toEqual({ lot: 'x","qty":999,"z":"', qty: 1, no: 7, tag: "L-7" });
    expect(request.headers["content-type"]).toBe("application/json");
  });
  it("puts a secret token only into string values, and rejects a body that is not JSON", () => {
    const { request } = buildHttpRequest(ds({ method: "POST", body: '{"auth":"{{ secrets.MES_TOKEN }}"}' }), {}, secrets);
    expect(JSON.parse(request.body!)).toEqual({ auth: SECRET });
    expect(code(() => buildHttpRequest(ds({ method: "POST", body: '{"qty": {{ params.no }}}' }), { no: 1 }, secrets))).toBe("BAD_PARAM");
  });
});

describe("rowsPath", () => {
  it("follows only own properties", async () => {
    const { pickRows } = await import("../index");
    expect(code(() => pickRows({ data: {} }, "data.__proto__"))).toBe("ROWS_PATH");
    expect(code(() => pickRows({ data: [] }, "data.constructor"))).toBe("ROWS_PATH");
    expect(pickRows({ data: { items: [{ a: 1 }] } }, "data.items")).toEqual([{ a: 1 }]);
  });
});
