import { describe, it, expect, afterEach, vi, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReportList } from "../ReportList";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const reports = [
  { id: "a", name: "A", updatedAt: "", publishedVersion: 3, modified: false },
  { id: "b", name: "B", updatedAt: "", publishedVersion: 1, modified: true },
  { id: "c", name: "", updatedAt: "", publishedVersion: null, modified: false },
];
const originalBlobUrlFns = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.assign(URL, originalBlobUrlFns); });

describe("ReportList", () => {
  it("shows publish status per report", () => {
    render(<ReportList reports={reports} />);
    expect(screen.getByTestId("status-a").textContent).toBe("v3");
    expect(screen.getByTestId("status-b").textContent).toBe("v1 · 수정됨");
    expect(screen.getByTestId("status-c").textContent).toBe("미배포");
  });
  it("exports the checked reports as a zip download", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new Blob([new Uint8Array([80, 75])]), { status: 200, headers: { "content-disposition": 'attachment; filename="daport-export-2026-09-18.zip"' } }));
    vi.stubGlobal("fetch", fetchMock);
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:zip") as Mock, revokeObjectURL: vi.fn() as Mock });
    render(<ReportList reports={reports} />);
    expect((screen.getByRole("button", { name: "내보내기" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("선택 a"));
    fireEvent.click(screen.getByLabelText("선택 c"));
    fireEvent.click(screen.getByRole("button", { name: "내보내기" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/export");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ reports: [{ id: "a" }, { id: "c" }] });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });
  it("imports a bundle and shows the result summary", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ imported: [{ id: "x", action: "created" }, { id: "a", action: { version: 4 } }], skipped: [{ id: "bad", reason: "COMPONENT_MISMATCH" }], warnings: ["w"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportList reports={reports} />);
    const input = screen.getByLabelText("번들 파일") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([80, 75])], "b.zip", { type: "application/zip" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/import");
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeInstanceOf(FormData);
    const result = await screen.findByTestId("import-result");
    expect(result.textContent).toContain("x: 새 레포트");
    expect(result.textContent).toContain("a: v4 추가");
    expect(result.textContent).toContain("bad: COMPONENT_MISMATCH");
    expect(result.textContent).toContain("w");
  });
});
