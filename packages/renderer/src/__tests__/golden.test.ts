import { describe, it, expect } from "vitest";
import { parseReport, resolveData } from "@daport/core";
import { layout } from "../layout/layout";
import fixture from "./fixtures/quality-cert.report.json";

describe("golden: quality-cert", () => {
  it("layout matches snapshot", async () => {
    const report = parseReport(fixture);
    const data = await resolveData(report, { lotNo: "L2609-0142" });
    const pages = layout(report, data);
    expect(pages).toHaveLength(1);
    expect(pages[0].items.every((i) => !i.error)).toBe(true);
    expect(pages).toMatchSnapshot();
  });
});
