// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readJsonBody } from "../body";

const req = (body: string | null, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });

describe("readJsonBody", () => {
  it("parses an object, treats empty and null as {}, rejects non-objects and bad JSON with 400", async () => {
    expect(await readJsonBody(req('{"a":1}'), 100)).toEqual({ ok: true, body: { a: 1 } });
    expect(await readJsonBody(req(null), 100)).toEqual({ ok: true, body: {} });
    expect(await readJsonBody(req("null"), 100)).toEqual({ ok: true, body: {} });
    for (const bad of ["5", '"s"', "[1]", "{oops"]) {
      const r = await readJsonBody(req(bad), 100);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(400);
    }
  });
  it("returns 413 from content-length or from bytes actually read", async () => {
    // fetch의 Request는 content-length를 직접 못 넣을 수 있어 헤더만 가진 객체로 선검사를 본다
    const byHeader = await readJsonBody({ headers: new Headers({ "content-length": "999" }), body: null } as unknown as Request, 100);
    if (!byHeader.ok) expect(byHeader.response.status).toBe(413); else throw new Error("expected 413");
    const byBytes = await readJsonBody(req(JSON.stringify({ s: "x".repeat(200) })), 100);
    if (!byBytes.ok) expect(byBytes.response.status).toBe(413); else throw new Error("expected 413");
  });
});
