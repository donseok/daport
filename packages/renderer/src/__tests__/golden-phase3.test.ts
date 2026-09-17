import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";
import { fixtureContext } from "./fixtures/context";
import coilTag from "./fixtures/coil-tag.report.json";
import productLabel from "./fixtures/product-label.report.json";

describe("golden: label examples", () => {
  it.each([["coil-tag", coilTag, 3, 2], ["product-label", productLabel, 2, 1]])("%s lays out one label per record with barcodes and matches its snapshot", (_name, fixture, labels, barcodes) => {
    const report = parseReport(fixture);
    expect(report.output.kind).toBe("label");
    const pages = layout(report, fixtureContext(report));
    expect(pages).toHaveLength(labels);
    expect(pages.flatMap((p) => p.items).filter((i) => i.error)).toEqual([]);
    for (const p of pages) expect(p.items.filter((i) => i.kind === "svg")).toHaveLength(barcodes);
    expect(pages.map((p) => [p.copyIndex, p.pageInCopy])).toEqual(Array.from({ length: labels }, (_, i) => [i, 0]));
    expect(pages).toMatchSnapshot();
  });
});
