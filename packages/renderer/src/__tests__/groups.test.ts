import { describe, it, expect } from "vitest";
import { computeGroupRuns, runsByRow, groupContext, sameKey } from "../flow/groups";

describe("groups", () => {
  it("splits consecutive equal keys into runs, inner levels restarting at outer boundaries", () => {
    const keys = [["A", "A", "B", "B", "B", "A"], [1, 1, 1, 2, 2, 1]];   // 바깥, 안쪽
    const runs = computeGroupRuns(keys, 6);
    expect(runs[0].map((r) => [r.start, r.end, r.key, r.index])).toEqual([[0, 2, "A", 0], [2, 5, "B", 1], [5, 6, "A", 2]]);
    expect(runs[1].map((r) => [r.start, r.end, r.key, r.index])).toEqual([[0, 2, 1, 0], [2, 3, 1, 1], [3, 5, 2, 2], [5, 6, 1, 3]]);
    const byRow = runsByRow(runs, 6);
    expect(byRow[1][2]).toBe(runs[1][1]);
    expect(byRow[0][5].index).toBe(2);
  });
  it("returns no runs for zero rows or zero levels", () => {
    expect(computeGroupRuns([], 3)).toEqual([]);
    expect(computeGroupRuns([[]], 0)).toEqual([[]]);
  });
  it("groupContext slices rows once per run and compares object keys by value", () => {
    const run = { level: 0, start: 1, end: 3, key: { k: 1 }, index: 0 };
    const rows = [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }];
    const g = groupContext(run, rows);
    expect(g).toEqual({ key: { k: 1 }, rows: [{ n: 1 }, { n: 2 }], index: 0, level: 0 });
    expect(groupContext(run, rows)).toBe(g);
    expect(sameKey({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameKey(null, undefined)).toBe(false);
    expect(sameKey("1", 1)).toBe(false);
  });
});
