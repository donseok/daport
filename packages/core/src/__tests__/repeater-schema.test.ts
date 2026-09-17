import { describe, it, expect } from "vitest";
import { ElementSchema } from "../schema/elements";

const text = (id: string) => ({ id, type: "text", x: 1, y: 1, w: 20, h: 5, value: "{{ item.NAME }}" });
const rep = { id: "cards", type: "repeater", x: 10, y: 40, w: 190, h: 240, source: "lots", item: { w: 60, h: 35, children: [text("nm")] } };

describe("repeater schema", () => {
  it("parses with defaults list/gap/groups/overflow and template children", () => {
    const el = ElementSchema.parse(rep);
    expect(el.type).toBe("repeater");
    if (el.type !== "repeater") return;
    expect(el.layout).toBe("list");
    expect(el.gap).toEqual([0, 0]);
    expect(el.groups).toEqual([]);
    expect(el.overflow).toBe("continue");
    expect(el.item.children[0]).toMatchObject({ id: "nm", type: "text", style: { fontSize: 10 } });
  });
  it("parses grid layout with groups whose bands have h and children", () => {
    const el = ElementSchema.parse({ ...rep, layout: "grid", gap: [2, 3], groups: [{ by: "item.LINE", header: { h: 8, children: [text("gh")] } }] });
    if (el.type !== "repeater") return;
    expect(el.gap).toEqual([2, 3]);
    expect(el.groups[0].header?.children[0].id).toBe("gh");
    expect(el.groups[0].footer).toBeUndefined();
  });
  it("rejects missing item, non-positive item size and negative gap", () => {
    expect(ElementSchema.safeParse({ ...rep, item: undefined }).success).toBe(false);
    expect(ElementSchema.safeParse({ ...rep, item: { w: 0, h: 10, children: [] } }).success).toBe(false);
    expect(ElementSchema.safeParse({ ...rep, gap: [-1, 0] }).success).toBe(false);
  });
});
