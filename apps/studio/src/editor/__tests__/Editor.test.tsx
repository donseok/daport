import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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

afterEach(() => { cleanup(); canvasBroken = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 탭 닫기·새로고침·다른 주소 이동 때 브라우저가 보내는 이벤트를 흉내 내고, 이탈 확인을 요청했는지 돌려준다 */
function leavePage(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

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

  it("asks before leaving only while there are unsaved changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { unmount } = render(<Editor initial={report} />);
    expect(leavePage()).toBe(false);

    fireEvent.click(screen.getByText("+ 텍스트"));
    expect(screen.getByText("R *")).toBeTruthy();
    expect(leavePage()).toBe(true);

    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(screen.getByText("R")).toBeTruthy());           // 저장되면 dirty가 풀린다
    expect(leavePage()).toBe(false);

    fireEvent.click(screen.getByText("+ 텍스트"));
    expect(leavePage()).toBe(true);
    unmount();
    expect(leavePage()).toBe(false);                                             // 에디터를 떠나면 리스너도 사라진다
  });
});

describe("Editor 컴포넌트 탭", () => {
  const summary = { id: "hdr", name: "회사 헤더", latestVersion: 2, w: 180, h: 24, updatedAt: "2026-09-17T00:00:00.000Z" };
  const stubFetch = () => vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(JSON.stringify(url === "/api/components" ? [summary] : []), { status: 200 })));

  it("shows the component library in a third left tab", async () => {
    stubFetch();
    render(<Editor initial={report} />);
    expect(screen.getByRole("button", { name: "요소" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "데이터" })).toBeTruthy();
    expect(screen.queryByText("회사 헤더")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "컴포넌트" }));
    expect(await screen.findByText("회사 헤더")).toBeTruthy();
    expect(screen.queryByText("+ 텍스트")).toBeNull();               // 팔레트 대신 라이브러리
  });

  it("hides the component tab in component mode (no nested components)", () => {
    stubFetch();
    render(<Editor initial={report} componentMode={{ componentId: "hdr", version: 2, props: [], sampleProps: {} }} />);
    expect(screen.getByRole("button", { name: "요소" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "컴포넌트" })).toBeNull();
  });
});
