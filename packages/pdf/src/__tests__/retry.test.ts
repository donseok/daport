import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseReport } from "@daport/core";

// vi.mock 팩토리가 호이스팅되어 참조하는 외부 변수이므로 vitest 관례대로 mock 접두사를 붙인다
const mockWithPage = vi.fn();
vi.mock("@daport/browser", async (importOriginal) => ({ ...(await importOriginal<typeof import("@daport/browser")>()), withPage: mockWithPage, closePool: vi.fn() }));
const { renderPdf } = await import("../index");

const report = parseReport({ id: "r", version: 1, page: { width: 60, height: 40 } });
// beforeEach가 mock 함수를 반환하면 vitest가 cleanup으로 호출하므로 블록 본문을 쓴다
beforeEach(() => { mockWithPage.mockReset(); });

describe("renderPdf retry", () => {
  it("retries once after a browser crash and returns the second result", async () => {
    mockWithPage.mockRejectedValueOnce(new Error("page.pdf: Target page, context or browser has been closed")).mockResolvedValueOnce(Buffer.from("%PDF-"));
    expect((await renderPdf(report, { params: {} })).toString()).toBe("%PDF-");
    expect(mockWithPage).toHaveBeenCalledTimes(2);
  });
  it("does not retry a second crash or a non-crash error", async () => {
    mockWithPage.mockRejectedValue(new Error("Target crashed"));
    await expect(renderPdf(report, { params: {} })).rejects.toThrow("Target crashed");
    expect(mockWithPage).toHaveBeenCalledTimes(2);
    mockWithPage.mockReset().mockRejectedValue(new Error("page.setContent: Timeout 20000ms exceeded."));
    await expect(renderPdf(report, { params: {} })).rejects.toThrow("Timeout");
    expect(mockWithPage).toHaveBeenCalledTimes(1);
  });
});
