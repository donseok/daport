import { describe, it, expect } from "vitest";
import { FakeLlmClient } from "../testing";

describe("FakeLlmClient", () => {
  it("returns scripted values in order, records calls and supports a function script", async () => {
    const f = new FakeLlmClient([{ a: 1 }, { b: 2 }]);
    expect(await f.complete({ system: "s", messages: [{ role: "user", text: "u" }], schema: {} })).toEqual({ a: 1 });
    expect(await f.complete({ system: "s", messages: [], schema: {} })).toEqual({ b: 2 });
    await expect(f.complete({ system: "s", messages: [], schema: {} })).rejects.toThrow(/스크립트/);
    expect(f.calls).toHaveLength(3);
    const g = new FakeLlmClient((i) => ({ echo: i.messages.at(-1)?.text }));
    expect(await g.complete({ system: "", messages: [{ role: "user", text: "hi" }], schema: {} })).toEqual({ echo: "hi" });
  });
  it("throws what the script throws", async () => {
    const boom = new Error("boom");
    await expect(new FakeLlmClient(() => { throw boom; }).complete({ system: "", messages: [], schema: {} })).rejects.toBe(boom);
  });
});
