// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { GET as listReports, POST as createReport } from "../route";
import { GET as getReport, PUT as updateReport } from "../[id]/route";

// The handlers share one module-level store (getStore()), so the tests below run in
// order: the first POST creates "r1" and the later cases rely on it.
const base = "http://localhost/api/reports";
const input = { id: "r1", name: "R1", version: 1, page: { width: 100, height: 100 } };
const rect = (id: string) => ({ id, type: "rect", x: 0, y: 0, w: 10, h: 10 });

const headers = { "content-type": "application/json" };
const post = (body: string) => new Request(base, { method: "POST", headers, body });
const put = (id: string, body: string) => new Request(`${base}/${id}`, { method: "PUT", headers, body });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(() => { delete process.env.DATABASE_URL; }); // force the in-memory store

describe("reports API (memory store)", () => {
  it("POST creates with 201, then the report is listed and fetchable", async () => {
    const res = await createReport(post(JSON.stringify(input)));
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("r1");

    const list = await (await listReports()).json();
    expect(list.map((r: { id: string }) => r.id)).toContain("r1");

    const one = await getReport(new Request(`${base}/r1`), ctx("r1"));
    expect(one.status).toBe(200);
    expect((await one.json()).name).toBe("R1");
  });

  it("POST returns 400 for an invalid report, a duplicate id and a non-JSON body", async () => {
    expect((await createReport(post(JSON.stringify({ id: "x" })))).status).toBe(400);
    expect((await createReport(post(JSON.stringify(input)))).status).toBe(400);
    expect((await createReport(post("not json"))).status).toBe(400);
  });

  it("GET returns 404 for a missing id", async () => {
    const res = await getReport(new Request(`${base}/nope`), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("PUT returns 404 for a missing id", async () => {
    const res = await updateReport(put("nope", JSON.stringify(input)), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("PUT uses the URL id over the body id", async () => {
    const res = await updateReport(put("r1", JSON.stringify({ ...input, id: "other", name: "R1b" })), ctx("r1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("r1");
    expect(body.name).toBe("R1b");
    expect((await getReport(new Request(`${base}/other`), ctx("other"))).status).toBe(404);
  });

  it("PUT returns 400, not 404, when a validation message merely contains 'not found'", async () => {
    const body = { ...input, elements: [rect("not found"), rect("not found")] };
    const res = await updateReport(put("r1", JSON.stringify(body)), ctx("r1"));
    expect(res.status).toBe(400);
    expect((await getReport(new Request(`${base}/r1`), ctx("r1"))).status).toBe(200); // untouched
  });

  it("returns 413 for a 21MB body on POST and PUT, and 400 for a null or non-object body (Finding 4: sample.data가 커진 이후 두 라우트에도 20MB 한도)", async () => {
    const big = `{"pad":"${"x".repeat(21 * 1024 * 1024)}"}`;
    expect((await createReport(post(big))).status).toBe(413);
    expect((await updateReport(put("r1", big), ctx("r1"))).status).toBe(413);
    expect((await createReport(post("null"))).status).toBe(400);
    expect((await createReport(post("5"))).status).toBe(400);
    expect((await updateReport(put("r1", "null"), ctx("r1"))).status).toBe(400);
    expect((await updateReport(put("r1", "5"), ctx("r1"))).status).toBe(400);
  });
});
