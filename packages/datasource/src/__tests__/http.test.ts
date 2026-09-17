import { describe, it, expect, vi } from "vitest";
import { parseReport, type HttpDataset } from "@daport/core";
import { executeDatasets, parseAllowList, createFetchHttpConnector, buildHttpRequest, pickRows, maskSecrets, DatasetFailure, DEFAULT_LIMITS } from "../index";

const ds = (extra: Partial<HttpDataset> = {}): HttpDataset => ({ name: "orders", type: "http", method: "GET", url: "https://mes.example.com/api/orders/{{ params.no }}", headers: {}, ...extra });
const secrets = (name: string) => ({ MES_TOKEN: "s3cr3t" } as Record<string, string>)[name];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeFetch = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => vi.fn((url: URL | RequestInfo, init?: RequestInit) => impl(String(url), init ?? {})) as unknown as typeof fetch;
const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };

describe("parseAllowList", () => {
  it("splits, trims, lower-cases and drops empties", () => {
    expect(parseAllowList(" MES.example.com, api.local:8080 ,,")).toEqual(["mes.example.com", "api.local:8080"]);
    expect(parseAllowList(undefined)).toEqual([]);
  });
});

describe("buildHttpRequest", () => {
  it("encodes url template values, leaves header/body values raw, and reports used secrets", () => {
    const { request, usedSecrets } = buildHttpRequest(ds({ method: "POST", url: "https://h/{{ params.no }}?q={{ params.q }}", headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}" }, body: "{\"lot\": \"{{ params.q }}\"}" }),
      { no: "A/1", q: "a b&c" }, secrets);
    expect(request).toEqual({ method: "POST", url: "https://h/A%2F1?q=a%20b%26c", headers: { Authorization: "Bearer s3cr3t" }, body: "{\"lot\": \"a b&c\"}" });
    expect(usedSecrets).toEqual(["s3cr3t"]);
  });
  it("omits the body for GET and resolves a missing secret to an empty string", () => {
    const { request, usedSecrets } = buildHttpRequest(ds({ headers: { X: "{{ secrets.NOPE }}" }, body: "ignored" }), { no: 1 }, secrets);
    expect(request.body).toBeUndefined();
    expect(request.headers.X).toBe("");
    expect(usedSecrets).toEqual([]);
  });
});

describe("pickRows", () => {
  it("follows a dot path, wraps an object, rejects non-object rows and missing paths", () => {
    expect(pickRows({ data: { items: [{ a: 1 }] } }, "data.items")).toEqual([{ a: 1 }]);
    expect(pickRows({ a: 1 }, undefined)).toEqual([{ a: 1 }]);
    expect(pickRows([{ a: 1 }], "")).toEqual([{ a: 1 }]);
    for (const [j, p] of [[{ data: 1 }, "data.items"], [[1, 2], undefined], ["x", undefined], [null, "a"]] as const) {
      expect(() => pickRows(j, p)).toThrow(DatasetFailure);
      try { pickRows(j, p); } catch (e) { expect((e as DatasetFailure).code).toBe("ROWS_PATH"); }
    }
  });
});

describe("maskSecrets", () => {
  it("replaces every used secret value with ***", () => {
    expect(maskSecrets("HTTP 401 for Bearer s3cr3t (s3cr3t)", ["s3cr3t", ""])).toBe("HTTP 401 for Bearer *** (***)");
  });
});

describe("createFetchHttpConnector", () => {
  it("rejects hosts outside the allow list without calling fetch, and non-http schemes", async () => {
    const f = fakeFetch(() => json([]));
    const c = createFetchHttpConnector({ allow: ["mes.example.com"], fetch: f });
    await expect(c.request({ method: "GET", url: "https://other.example.com/x", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(c.request({ method: "GET", url: "ftp://mes.example.com/x", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    await expect(c.request({ method: "GET", url: "not a url", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    expect(f).not.toHaveBeenCalled();
    const empty = createFetchHttpConnector({ allow: [], fetch: f });
    await expect(empty.request({ method: "GET", url: "https://mes.example.com/x", headers: {} }, limits)).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
  });
  it("matches host:port entries and passes method, headers, body, redirect manual and a timeout signal", async () => {
    const f = fakeFetch(() => json({ ok: 1 }));
    const c = createFetchHttpConnector({ allow: ["api.local:8080"], fetch: f });
    await expect(c.request({ method: "POST", url: "http://API.local:8080/q", headers: { A: "1" }, body: "{}" }, limits)).resolves.toEqual({ ok: 1 });
    const init = (f as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0][1];
    expect(init).toMatchObject({ method: "POST", headers: { A: "1" }, body: "{}", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("reports HTTP_STATUS for non-2xx including redirects, BAD_JSON for invalid bodies", async () => {
    const c = (r: Response) => createFetchHttpConnector({ allow: ["h"], fetch: fakeFetch(() => r) });
    await expect(c(json({}, 500)).request({ method: "GET", url: "https://h/", headers: {} }, limits)).rejects.toMatchObject({ code: "HTTP_STATUS", message: "HTTP 500" });
    await expect(c(new Response(null, { status: 302, headers: { location: "https://x" } })).request({ method: "GET", url: "https://h/", headers: {} }, limits)).rejects.toMatchObject({ code: "HTTP_STATUS", message: "HTTP 302" });
    await expect(c(new Response("<html>", { status: 200 })).request({ method: "GET", url: "https://h/", headers: {} }, limits)).rejects.toMatchObject({ code: "BAD_JSON" });
  });
  it("stops reading past maxBytes with TOO_LARGE and reports TIMEOUT when the signal fires", async () => {
    const big = createFetchHttpConnector({ allow: ["h"], fetch: fakeFetch(() => new Response("x".repeat(2000), { status: 200 })) });
    await expect(big.request({ method: "GET", url: "https://h/", headers: {} }, { ...limits, maxBytes: 1000 })).rejects.toMatchObject({ code: "TOO_LARGE" });
    const slow = createFetchHttpConnector({ allow: ["h"], fetch: fakeFetch((_u, init) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) });
    await expect(slow.request({ method: "GET", url: "https://h/", headers: {} }, { ...limits, timeoutMs: 20 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("executeDatasets http", () => {
  const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, params: [{ name: "no" }],
    datasets: [{ name: "orders", type: "http", url: "https://mes.example.com/o/{{ params.no }}", headers: { Authorization: "Bearer {{ secrets.MES_TOKEN }}" }, rowsPath: "data" }] });
  it("runs the request through the connector and applies rowsPath and maxRows", async () => {
    const f = fakeFetch((url) => json({ data: [{ NO: url }, { NO: "2" }] }));
    const connectors = { http: createFetchHttpConnector({ allow: ["mes.example.com"], fetch: f }) };
    const ok = await executeDatasets(report, { params: { no: "A" }, connectors, secrets });
    expect(ok.errors).toEqual([]);
    expect((ok.context.orders as { NO: string }).NO).toBe("https://mes.example.com/o/A");
    const capped = await executeDatasets(report, { params: { no: "A" }, connectors, secrets, limits: { maxRows: 1 } });
    expect(capped.errors[0].code).toBe("TOO_MANY_ROWS");
  });
  it("masks secret values in error messages and never puts secrets in the context", async () => {
    const f = fakeFetch(() => { throw new Error("connect failed for Bearer s3cr3t"); });
    const { context, errors } = await executeDatasets(report, { params: { no: "A" }, connectors: { http: createFetchHttpConnector({ allow: ["mes.example.com"], fetch: f }) }, secrets });
    expect(errors[0].message).toContain("***");
    expect(errors[0].message).not.toContain("s3cr3t");
    expect(JSON.stringify(context)).not.toContain("s3cr3t");
    expect(context.secrets).toBeUndefined();
  });
});
