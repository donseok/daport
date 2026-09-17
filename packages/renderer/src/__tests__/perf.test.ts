import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { layout } from "../layout/layout";

describe("performance", () => {
  it("lays out a 10k-row table with groups and a page footer in under 1s (3s on CI)", () => {
    const report = parseReport({ id: "perf", version: 1, page: { width: 210, height: 297 }, elements: [
      { id: "t", type: "table", x: 10, y: 20, w: 190, h: 250, source: "items", rowHeight: 5,
        columns: [{ header: "번호", value: "{{ row.N }}", w: 30 }, { header: "품명", value: "{{ row.NAME }}", w: 100 }, { header: "수량", value: "{{ formatNumber(row.QTY) }}", w: 30, align: "right" }, { header: "분류", value: "{{ row.CAT }}", w: 30 }],
        groups: [{ by: "row.CAT", header: [{ value: "{{ group.key }}", span: "all" }], footer: [{ value: "소계 {{ sum(group.rows, 'QTY') }}", span: "all" }] }],
        pageFooter: [{ value: "{{ page }}/{{ total }} · {{ count(pageRows) }}건", span: "all" }] },
      { id: "pn", type: "pageNumber", x: 10, y: 285, w: 190, h: 5, flow: "every" },
    ]});
    const items = Array.from({ length: 10_000 }, (_, i) => ({ N: i + 1, NAME: `냉연강판 SPCC ${(i % 9) + 1}.0t 규격품 ${i}`, QTY: (i * 7) % 500, CAT: `C${Math.floor(i / 400)}` }));
    const t0 = performance.now();
    const pages = layout(report, { params: {}, items });
    const ms = performance.now() - t0;
    expect(pages.length).toBeGreaterThan(150);   // 실측 198장(10,000행 ÷ 페이지당 약 50행). 여유를 두어 임계치로 고정
    expect(ms).toBeLessThan(process.env.CI ? 3000 : 1000);
  });
});
