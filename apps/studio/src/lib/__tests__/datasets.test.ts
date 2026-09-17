// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseReport } from "@daport/core";
import { runDatasets } from "../datasets";

const report = parseReport({ id: "r", version: 1, page: { width: 10, height: 10 }, datasets: [
  { name: "s", type: "static", rows: [{ A: 1 }] }, { name: "h", type: "http", url: "https://mes.example.com/x" }] });

afterEach(() => vi.unstubAllEnvs());

describe("runDatasets", () => {
  it("runs static datasets and blocks http hosts not in DAPORT_HTTP_ALLOW", async () => {
    vi.stubEnv("DAPORT_HTTP_ALLOW", "");
    const { context, errors } = await runDatasets(report, {});
    expect((context.s as { A: number }).A).toBe(1);
    expect(errors).toEqual([{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: mes.example.com" }]);
  });
  it("prefers request data", async () => {
    const { context, errors } = await runDatasets(report, { data: { h: [{ B: 2 }] } });
    expect(errors).toEqual([]);
    expect((context.h as { B: number }).B).toBe(2);
  });
});
