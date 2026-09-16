import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { Editor } from "../Editor";

// Monaco는 jsdom에서 돌지 않는다. 마운트하지 않는 자리표시로 둔다
vi.mock("@monaco-editor/react", () => ({ default: () => <div data-testid="monaco" /> }));
// 렌더러가 예기치 않게 던지는 상황을 흉내 낸다
let canvasBroken = false;
vi.mock("../canvas/Canvas", () => ({
  Canvas: () => { if (canvasBroken) throw new TypeError("canvas boom"); return <div data-testid="canvas-ok" />; },
}));

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 100, height: 100 }, elements: [] });

afterEach(() => { cleanup(); canvasBroken = false; vi.restoreAllMocks(); });

describe("Editor", () => {
  it("confines a renderer error to the canvas area and redraws once the report changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});   // React가 잡힌 렌더 오류를 콘솔에 남긴다
    canvasBroken = true;
    render(<Editor initial={report} />);

    expect(screen.getByRole("alert").textContent).toContain("canvas boom");
    expect(screen.getByTestId("monaco")).toBeTruthy();          // JSON 편집기·팔레트·툴바는 그대로 남는다
    expect(screen.getByText("+ 텍스트")).toBeTruthy();
    expect(screen.getByTestId("save")).toBeTruthy();

    canvasBroken = false;
    fireEvent.click(screen.getByText("+ 텍스트"));               // 레포트가 바뀌면 다시 시도를 누르지 않아도 다시 그린다
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("canvas-ok")).toBeTruthy();
    expect(screen.getByText("R *")).toBeTruthy();                // 편집은 스토어에 남아 있다
  });
});
