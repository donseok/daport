import { describe, it, expect } from "vitest";
import { envSecrets } from "../secrets";

describe("envSecrets", () => {
  it("reads DAPORT_SECRET_<NAME> only for upper-case names", () => {
    const s = envSecrets({ DAPORT_SECRET_MES_TOKEN: "t0k", DAPORT_SECRET_x: "no", OTHER: "o" });
    expect(s("MES_TOKEN")).toBe("t0k");
    expect(s("x")).toBeUndefined();
    expect(s("OTHER")).toBeUndefined();
    expect(s("../etc")).toBeUndefined();
  });
});
