import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditorErrorBoundary } from "../EditorErrorBoundary";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("EditorErrorBoundary", () => {
  it("shows a fallback for a throwing child, keeps the sibling UI, and retries on demand", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});   // React가 잡힌 렌더 오류를 콘솔에 남긴다
    let broken = true;
    function Body() {
      if (broken) throw new TypeError("renderer boom");
      return <div>canvas ok</div>;
    }
    render(
      <div>
        <textarea data-testid="sibling" defaultValue="unsaved" />
        <EditorErrorBoundary><Body /></EditorErrorBoundary>
      </div>,
    );

    expect(screen.getByRole("alert").textContent).toContain("renderer boom");
    expect((screen.getByTestId("sibling") as HTMLTextAreaElement).value).toBe("unsaved");   // 형제 UI는 언마운트되지 않는다

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));   // 아직 고장 → 다시 폴백
    expect(screen.getByRole("alert")).toBeTruthy();

    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("canvas ok")).toBeTruthy();
    expect((screen.getByTestId("sibling") as HTMLTextAreaElement).value).toBe("unsaved");
  });

  it("clears the fallback on its own when the reset key changes (the report is fixed or the mode switches)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Body({ value }: { value: string }) {
      if (value === "broken") throw new TypeError("renderer boom");
      return <div>{value}</div>;
    }
    const { rerender } = render(<EditorErrorBoundary resetKey="broken"><Body value="broken" /></EditorErrorBoundary>);
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(<EditorErrorBoundary resetKey="broken"><Body value="broken" /></EditorErrorBoundary>);   // 키가 같으면 그대로
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(<EditorErrorBoundary resetKey="fixed"><Body value="fixed" /></EditorErrorBoundary>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("fixed")).toBeTruthy();

    // 키가 바뀌는 바로 그 렌더에서 오류가 나도 폴백을 보이고 무한히 다시 그리지 않는다
    rerender(<EditorErrorBoundary resetKey="broken"><Body value="broken" /></EditorErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toContain("renderer boom");
  });
});
