import { describe, it, expect } from "vitest";
import { commit, undo, redo, createHistory } from "../history";

describe("history", () => {
  it("commits a patch and undoes/redoes it", () => {
    const h0 = createHistory({ a: 1, list: [{ id: "x" }] });
    const h1 = commit(h0, (d) => { d.a = 2; d.list.push({ id: "y" }); });
    expect(h1.present).toEqual({ a: 2, list: [{ id: "x" }, { id: "y" }] });
    expect(h1.past).toHaveLength(1);
    const h2 = undo(h1);
    expect(h2.present).toEqual({ a: 1, list: [{ id: "x" }] });
    const h3 = redo(h2);
    expect(h3.present).toEqual(h1.present);
  });
  it("undo on empty past is a no-op; commit clears future", () => {
    const h0 = createHistory({ a: 1 });
    expect(undo(h0)).toBe(h0);
    const h1 = undo(commit(h0, (d) => { d.a = 2; }));
    expect(h1.future).toHaveLength(1);
    const h2 = commit(h1, (d) => { d.a = 3; });
    expect(h2.future).toHaveLength(0);
  });
  it("skips no-op commits", () => {
    const h0 = createHistory({ a: 1 });
    expect(commit(h0, () => {})).toBe(h0);
  });
});
