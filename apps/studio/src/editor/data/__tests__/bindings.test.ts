import { describe, it, expect } from "vitest";
import { parseReport } from "@daport/core";
import { resolveDrop, sourceDataset, type DragField } from "../bindings";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, datasets: [{ name: "orders", type: "static", rows: [] }, { name: "lots", type: "static", rows: [] }], elements: [
  { id: "t", type: "table", x: 5, y: 20, w: 60, h: 30, source: "orders", columns: [{ header: "A", value: "{{ row.A }}", w: 30 }] },
  { id: "t2", type: "table", x: 5, y: 60, w: 60, h: 30, source: "record.items", columns: [] },
  { id: "cards", type: "repeater", x: 5, y: 60, w: 90, h: 30, source: "lots", item: { w: 30, h: 20, children: [] } },
]});
const alloc = (base: string) => `${base}-9`;
const f = (over: Partial<DragField>): DragField => ({ dataset: "orders", path: "NO", type: "string", isArray: false, ...over });

describe("sourceDataset", () => {
  it("returns the root identifier of simple and filtered sources, undefined otherwise", () => {
    expect(sourceDataset("orders")).toBe("orders");
    expect(sourceDataset("items[.ORDER_NO == item.ORDER_NO]")).toBe("items");
    expect(sourceDataset("record.items")).toBeUndefined();
    expect(sourceDataset("")).toBeUndefined();
  });
});

describe("resolveDrop", () => {
  it("canvas: a text element bound to dataset.path, or record.path when the report repeats over that dataset", () => {
    const r = resolveDrop(f({}), { kind: "canvas", x: 10, y: 12 }, report, alloc);
    expect(r).toMatchObject({ action: "addElement", element: { id: "text-9", type: "text", x: 10, y: 12, value: "{{ orders.NO }}" } });
    const rep = { ...report, repeat: { source: "orders", as: "record" } };
    expect(resolveDrop(f({}), { kind: "canvas", x: 0, y: 0 }, rep, alloc)).toMatchObject({ element: { value: "{{ record.NO }}" } });
    expect(resolveDrop(f({ dataset: "lots" }), { kind: "canvas", x: 0, y: 0 }, rep, alloc)).toMatchObject({ element: { value: "{{ lots.NO }}" } });
  });
  it("canvas + array node: a table with one column per element field (max 8, equal widths)", () => {
    const children = Array.from({ length: 10 }, (_, i) => ({ name: `F${i}`, path: `items.F${i}`, type: "string" as const }));
    const r = resolveDrop(f({ path: "items", type: "array", isArray: true, children }), { kind: "canvas", x: 10, y: 10 }, report, alloc);
    expect(r.action).toBe("addElement");
    if (r.action !== "addElement") return;
    expect(r.element).toMatchObject({ id: "table-9", type: "table", x: 10, y: 10, w: 80, h: 40, source: "orders.items" });
    const t = r.element as Extract<typeof r.element, { type: "table" }>;
    expect(t.columns).toHaveLength(8);
    expect(t.columns[0]).toMatchObject({ header: "F0", value: "{{ row.F0 }}", w: 10 });
    const rep = { ...report, repeat: { source: "orders", as: "record" } };
    expect((resolveDrop(f({ path: "items", type: "array", isArray: true, children }), { kind: "canvas", x: 0, y: 0 }, rep, alloc) as { element: { source: string } }).element.source).toBe("record.items");
    // 데이터셋 루트 노드(path "")는 데이터셋 전체가 소스다
    const root = resolveDrop(f({ path: "", type: "array", isArray: true, children: children.slice(0, 2) }), { kind: "canvas", x: 0, y: 0 }, report, alloc);
    expect(root).toMatchObject({ element: { type: "table", source: "orders", columns: [{ value: "{{ row.F0 }}" }, { value: "{{ row.F1 }}" }] } });
    expect(resolveDrop(f({ path: "", type: "array", isArray: true, children: [] }), { kind: "canvas", x: 0, y: 0 }, rep, alloc)).toMatchObject({ element: { source: "record" } });
  });
  it("table: a column with a source-relative row path, or a full path with a warning for another dataset", () => {
    const ok = resolveDrop(f({ path: "CUSTOMER.NAME" }), { kind: "table", tableId: "t" }, report, alloc);
    expect(ok).toEqual({ action: "addColumn", tableId: "t", column: { header: "NAME", value: "{{ row.CUSTOMER.NAME }}", w: 30, style: expect.any(Object) } });
    const other = resolveDrop(f({ dataset: "lots", path: "X" }), { kind: "table", tableId: "t" }, report, alloc);
    expect(other).toMatchObject({ action: "addColumn", column: { value: "{{ lots.X }}" }, warning: "표 소스와 다른 데이터셋" });
    expect(resolveDrop(f({}), { kind: "table", tableId: "t2" }, report, alloc)).toMatchObject({ action: "addColumn", column: { value: "{{ row.NO }}" } });   // 상대 소스는 신뢰
    expect(resolveDrop(f({}), { kind: "table", tableId: "nope" }, report, alloc)).toMatchObject({ action: "none" });
  });
  it("repeater item: a text inside the template bound to item.path", () => {
    const r = resolveDrop(f({ dataset: "lots", path: "NAME" }), { kind: "repeaterItem", repeaterId: "cards", x: 3, y: 4 }, report, alloc);
    expect(r).toMatchObject({ action: "addElement", into: { repeaterId: "cards", band: "item" }, element: { id: "text-9", x: 3, y: 4, value: "{{ item.NAME }}" } });
    expect(resolveDrop(f({ path: "NO" }), { kind: "repeaterItem", repeaterId: "cards", x: 0, y: 0 }, report, alloc)).toMatchObject({ element: { value: "{{ orders.NO }}" }, warning: "반복 영역 소스와 다른 데이터셋" });
  });
  it("array node onto a table or repeater item is refused", () => {
    expect(resolveDrop(f({ path: "items", type: "array", isArray: true }), { kind: "table", tableId: "t" }, report, alloc)).toMatchObject({ action: "none", warning: expect.any(String) });
    expect(resolveDrop(f({ path: "items", type: "array", isArray: true }), { kind: "repeaterItem", repeaterId: "cards", x: 0, y: 0 }, report, alloc)).toMatchObject({ action: "none" });
  });
});
