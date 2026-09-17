import { describe, it, expect } from "vitest";
import { sizeChangeNotice } from "../sizeNotice";

describe("sizeChangeNotice", () => {
  it("returns null when every instance already has the new size", () => {
    expect(sizeChangeNotice([{ w: 180, h: 24 }, { w: 180, h: 24 }], { w: 180, h: 24 })).toBeNull();
    expect(sizeChangeNotice([], { w: 180, h: 24 })).toBeNull();
  });
  it("lists each distinct old size once and warns about overlap", () => {
    expect(sizeChangeNotice([{ w: 180, h: 24 }, { w: 180, h: 24 }], { w: 180, h: 30 })).toBe("180×24 → 180×30, 아래 요소와 겹칠 수 있습니다");
    expect(sizeChangeNotice([{ w: 180, h: 24 }, { w: 90, h: 12.5 }, { w: 180, h: 30 }], { w: 180, h: 30 })).toBe("180×24, 90×12.5 → 180×30, 아래 요소와 겹칠 수 있습니다");
  });
});
