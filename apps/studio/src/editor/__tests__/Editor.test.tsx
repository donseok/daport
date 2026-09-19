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

describe("Editor 하단 AI 탭", () => {
  const reportWithElement = parseReport({
    id: "r", name: "R", version: 1, page: { width: 100, height: 100 },
    elements: [{ id: "a", type: "text", x: 0, y: 0, w: 30, h: 5, value: "A" }],
  });

  // JSON은 숨겨도 언마운트하지 않는데(Monaco 상태 보존), AI 탭도 같은 취급을 받아야 한다.
  // 그렇지 않으면 JSON 탭으로 갔다 오는 것만으로 대화 기록이 통째로 사라지고 진행 중인 요청도
  // unmount cleanup에 의해 조용히 취소된다(스펙 7.1: 대화 목록 유지)
  it("keeps AI conversation turns after switching to the JSON tab and back", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "바꿨습니다", warnings: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    render(<Editor initial={reportWithElement} />);

    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "값을 B로" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(screen.getAllByTestId("ai-turn").length).toBe(2));
    const before = screen.getAllByTestId("ai-turn").map((t) => t.textContent);

    fireEvent.click(screen.getByRole("tab", { name: "JSON" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(screen.getAllByTestId("ai-turn").map((t) => t.textContent)).toEqual(before);
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

describe("Editor component mode", () => {
  const editReport = parseReport({ id: "component-hdr", name: "회사 헤더", version: 1, page: { width: 180, height: 24, margin: [0, 0, 0, 0] }, elements: [] });
  const componentMode = { componentId: "hdr", version: 2, props: [{ name: "title", type: "string" as const, default: "기본" }], sampleProps: { title: "기본" } };
  const tab = (name: string) => screen.queryByRole("button", { name });

  it("shows 요소·입력값 tabs instead of 데이터·컴포넌트 and the component toolbar", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    render(<Editor initial={editReport} componentMode={componentMode} />);
    expect(tab("요소")).toBeTruthy();
    expect(tab("입력값")).toBeTruthy();
    expect(tab("데이터")).toBeNull();
    expect(tab("컴포넌트")).toBeNull();
    expect(screen.getByTestId("component-version").textContent).toBe("v2 (저장하면 v3)");
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    fireEvent.click(tab("입력값")!);
    expect(screen.getByRole("button", { name: "입력값 추가" })).toBeTruthy();
    expect((screen.getByLabelText("이름") as HTMLInputElement).value).toBe("title");
    fireEvent.click(tab("요소")!);
    expect(screen.getByText("+ 텍스트")).toBeTruthy();
    expect(screen.queryByText(/\+ 컴포넌트|\+ ref/)).toBeNull();                   // 팔레트에 ref 추가 항목이 없다
  });

  it("keeps 데이터·컴포넌트 tabs and no 입력값 tab for a normal report", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    render(<Editor initial={report} />);
    expect(tab("데이터")).toBeTruthy();
    expect(tab("컴포넌트")).toBeTruthy();
    expect(tab("입력값")).toBeNull();
    expect(screen.queryByTestId("component-version")).toBeNull();
  });
});
