// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { GET } from "../route";
afterEach(() => vi.unstubAllEnvs());
describe("GET /api/printers", () => {
  it("returns names only, never hosts, and [] without the env", async () => {
    vi.stubEnv("DAPORT_PRINTERS", "라인1=10.0.0.1:9100,포장=10.0.0.2");
    expect(await (await GET()).json()).toEqual([{ name: "라인1" }, { name: "포장" }]);
    vi.stubEnv("DAPORT_PRINTERS", "");
    expect(await (await GET()).json()).toEqual([]);
  });
});
