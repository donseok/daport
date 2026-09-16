import { describe, it, expect } from "vitest";
import { StyleSchema } from "../schema/style";

describe("StyleSchema", () => {
  it("applies defaults", () => {
    const s = StyleSchema.parse({});
    expect(s.fontSize).toBe(10);
    expect(s.align).toBe("left");
    expect(s.wrap).toBe(true);
  });
  it("rejects unknown align", () => {
    expect(() => StyleSchema.parse({ align: "middle" })).toThrow();
  });
});
