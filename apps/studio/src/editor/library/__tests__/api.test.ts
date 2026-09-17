import { describe, it, expect, vi, afterEach } from "vitest";
import { parseComponentBody } from "@daport/core";
import { COMPONENT_MIME, fetchComponents, fetchComponent, createComponent, saveComponent, fetchUsage, applyLatest, deleteComponent } from "../api";

afterEach(() => { vi.unstubAllGlobals(); });

const body = parseComponentBody({ name: "헤더", w: 40, h: 10, elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 10, value: "H" }] });
const summary = { id: "hdr", name: "헤더", latestVersion: 3, w: 40, h: 10, updatedAt: "2026-09-17T00:00:00.000Z" };

function stub(response: () => Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", fn);
  return fn;
}
const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status });

describe("library api", () => {
  it("uses the component drag mime type", () => {
    expect(COMPONENT_MIME).toBe("application/x-daport-component");
  });
  it("lists and reads components, encoding the id in the path", async () => {
    let fn = stub(json([summary]));
    expect(await fetchComponents()).toEqual([summary]);
    expect(fn.mock.calls[0][0]).toBe("/api/components");
    const detail = { summary, versions: [{ version: 3, hash: "abc", createdAt: "2026-09-17T00:00:00.000Z" }], latest: body };
    fn = stub(json(detail));
    expect(await fetchComponent("a b")).toEqual(detail);
    expect(fn.mock.calls[0][0]).toBe("/api/components/a%20b");
  });
  it("creates with POST {id, body} and saves with PUT {body}", async () => {
    let fn = stub(json({ version: 1, hash: "h1" }, 201));
    expect(await createComponent("hdr", body)).toEqual({ version: 1, hash: "h1" });
    let [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/components");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual({ id: "hdr", body });
    fn = stub(json({ version: 4, hash: "h4", created: true }));
    expect(await saveComponent("hdr", body)).toEqual({ version: 4, hash: "h4", created: true });
    [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/components/hdr");
    expect(init).toMatchObject({ method: "PUT" });
    expect(JSON.parse(init!.body as string)).toEqual({ body });
  });
  it("reads usage, applies the latest version with POST, and deletes with DELETE (204 has no body)", async () => {
    let fn = stub(json([{ reportId: "r", versions: [1, 2] }]));
    expect(await fetchUsage("hdr")).toEqual([{ reportId: "r", versions: [1, 2] }]);
    expect(fn.mock.calls[0][0]).toBe("/api/components/hdr/usage");
    fn = stub(json({ updated: ["r"], skipped: [{ reportId: "x", error: "bad" }] }));
    expect(await applyLatest("hdr")).toEqual({ updated: ["r"], skipped: [{ reportId: "x", error: "bad" }] });
    expect(fn.mock.calls[0]).toEqual(["/api/components/hdr/apply-latest", { method: "POST" }]);
    fn = stub(() => new Response(null, { status: 204 }));
    await expect(deleteComponent("hdr")).resolves.toBeUndefined();
    expect(fn.mock.calls[0]).toEqual(["/api/components/hdr", { method: "DELETE" }]);
  });
  it("throws an Error carrying the server error message, or the HTTP status when the body is not JSON", async () => {
    stub(json({ error: "component in use", reports: ["r"] }, 409));
    await expect(deleteComponent("hdr")).rejects.toThrow("component in use");
    stub(json({ error: "component exists: hdr" }, 409));
    await expect(createComponent("hdr", body)).rejects.toThrow("component exists: hdr");
    stub(json({ error: "not found" }, 404));
    await expect(fetchComponent("nope")).rejects.toThrow("not found");
    stub(() => new Response("<html>oops</html>", { status: 500 }));
    await expect(fetchComponents()).rejects.toThrow("HTTP 500");
  });
});
