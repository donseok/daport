// @vitest-environment node
import { describe, it, expect } from "vitest";
import { POST } from "../[id]/sample/route";
import { SAMPLE_ROWS } from "@/lib/datasets";

const report = { id: "qc", version: 1, page: { width: 100, height: 100 }, params: [{ name: "no", required: true }], datasets: [
  { name: "items", type: "static", rows: Array.from({ length: 250 }, (_, i) => ({ N: i, DT: "2026-09-17" })) },
  { name: "h", type: "http", url: "https://nope.example.com/x" },
]};
const call = (body: unknown) => POST(new Request("http://localhost/api/reports/qc/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "qc" }) });

describe("POST /api/reports/[id]/sample", () => {
  it("returns the first 200 rows per dataset, inferred fields, dataset errors and capturedAt", async () => {
    const res = await call({ report, params: { no: "A" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(SAMPLE_ROWS);
    expect(json.fields.items).toEqual([{ name: "N", path: "N", type: "number" }, { name: "DT", path: "DT", type: "date" }]);
    expect(json.data.h).toBeUndefined();
    expect(json.errors).toEqual([{ dataset: "h", code: "HOST_NOT_ALLOWED", message: expect.any(String) }]);
    expect(typeof json.capturedAt).toBe("string");
  });
  it("returns 400 for a missing required param and 404 for an unknown stored report", async () => {
    expect((await call({ report, params: {} })).status).toBe(400);
    expect((await call({ params: {} })).status).toBe(404);
  });
});
