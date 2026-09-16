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
});
