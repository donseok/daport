import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../store";
import { MakeComponentDialog, makeComponentCheck, suggestComponentId, COMPONENT_MODE_REASON, EMPTY_SELECTION_REASON } from "../library/MakeComponentDialog";
import { Toolbar } from "../Toolbar";

// b는 오른쪽→왼쪽으로 그린 선이다. 경계 상자는 두 끝점 기준(x 30~40, y 12~20)
const report = parseReport({ id: "r", version: 1, page: { width: 200, height: 100 }, elements: [
  { id: "a", type: "text", x: 10, y: 10, w: 20, h: 5, value: "A" },
  { id: "b", type: "line", x: 40, y: 20, w: 10, h: 8, x2: 30, y2: 12 },
  { id: "g", type: "group", x: 50, y: 50, w: 20, h: 20, children: [
    { id: "c", type: "rect", x: 5, y: 5, w: 5, h: 5 },
    { id: "d", type: "rect", x: 10, y: 10, w: 5, h: 5 },
  ] },
  { id: "cards", type: "repeater", x: 100, y: 10, w: 80, h: 60, source: "items", item: { w: 40, h: 10, children: [
    { id: "it", type: "text", x: 0, y: 0, w: 10, h: 5, value: "x" },
  ] } },
  { id: "hdr", type: "ref", ref: "hdr-comp", version: 1, x: 0, y: 80, w: 10, h: 5 },
], components: { "hdr-comp@1": { name: "H", w: 10, h: 5, props: [], elements: [] } } });

const componentMode = { componentId: "x", version: 1, props: [], sampleProps: {} };

function mount(store: EditorStore, ui: React.ReactNode) {
  return render(<EditorContext.Provider value={store}>{ui}</EditorContext.Provider>);
}
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const makeButton = () => screen.getByRole("button", { name: "만들기" }) as HTMLButtonElement;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("suggestComponentId", () => {
  it("slugifies the name to the component id rule", () => {
    expect(suggestComponentId("Company Header 2")).toBe("company-header-2");
    expect(suggestComponentId("  --ABC__def--  ")).toBe("abc-def");
    expect(suggestComponentId("회사 Header")).toBe("header");
    expect(suggestComponentId("Café Sign")).toBe("cafe-sign");
  });
  it("suggests nothing when no usable slug remains (사용자가 직접 입력한다)", () => {
    expect(suggestComponentId("회사 헤더")).toBe("");
    expect(suggestComponentId("")).toBe("");
    expect(suggestComponentId("---")).toBe("");
  });
});

describe("makeComponentCheck", () => {
  it("accepts siblings at the top level, a single group and siblings inside the same group", () => {
    expect(makeComponentCheck(report, ["a", "b"], false)).toEqual({ ok: true });
    expect(makeComponentCheck(report, ["g"], false)).toEqual({ ok: true });
    expect(makeComponentCheck(report, ["c", "d"], false)).toEqual({ ok: true });
  });
  it("rejects an empty selection, mixed parents, repeater templates and refs with a reason", () => {
    expect(makeComponentCheck(report, [], false)).toEqual({ ok: false, reason: EMPTY_SELECTION_REASON });
    for (const ids of [["a", "c"], ["it"], ["hdr"], ["a", "hdr"]]) {
      const res = makeComponentCheck(report, ids, false);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
    }
  });
  it("is unavailable in component mode even for a valid selection", () => {
    expect(makeComponentCheck(report, ["a", "b"], true)).toEqual({ ok: false, reason: COMPONENT_MODE_REASON });
  });
});

describe("MakeComponentDialog", () => {
  function open(selection: string[]) {
    const store = createEditorStore(report);
    act(() => store.getState().select(selection));
    const onClose = vi.fn();
    mount(store, <MakeComponentDialog onClose={onClose} />);
    return { store, onClose };
  }

  it("suggests the id from the name until the id is edited by hand", () => {
    open(["a", "b"]);
    expect(screen.getByRole("dialog", { name: "컴포넌트 만들기" })).toBeTruthy();
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    expect(input("id").value).toBe("company-header");
    fireEvent.change(input("이름"), { target: { value: "회사 헤더" } });
    expect(input("id").value).toBe("");
    fireEvent.change(input("id"), { target: { value: "my-hdr" } });
    fireEvent.change(input("이름"), { target: { value: "Other" } });
    expect(input("id").value).toBe("my-hdr");
  });

  it("shows validation messages and disables 만들기 until name and id are valid", () => {
    open(["a", "b"]);
    expect(screen.getByText("이름을 입력하세요")).toBeTruthy();
    expect(makeButton().disabled).toBe(true);
    fireEvent.change(input("이름"), { target: { value: "   " } });
    expect(screen.getByText("이름을 입력하세요")).toBeTruthy();
    fireEvent.change(input("이름"), { target: { value: "헤더" } });
    fireEvent.change(input("id"), { target: { value: "Bad Id" } });
    expect(screen.getByText("id는 영문 소문자·숫자로 시작하고 영문 소문자·숫자·-만 쓸 수 있습니다")).toBeTruthy();
    expect(makeButton().disabled).toBe(true);
    fireEvent.change(input("id"), { target: { value: "-hdr" } });
    expect(makeButton().disabled).toBe(true);
    fireEvent.change(input("id"), { target: { value: "hdr-1" } });
    expect(screen.queryByText(/이름을 입력하세요|id는 영문/)).toBeNull();
    expect(makeButton().disabled).toBe(false);
  });

  it("leaves the id empty for a name with no usable slug and blocks 만들기 until one is typed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    open(["a", "b"]);
    fireEvent.change(input("이름"), { target: { value: "회사 헤더" } });
    expect(input("id").value).toBe("");
    expect(screen.getByText("id를 입력하세요")).toBeTruthy();
    expect(makeButton().disabled).toBe(true);
    fireEvent.click(makeButton());
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input("id"), { target: { value: "hoesa-header" } });
    expect(screen.queryByText("id를 입력하세요")).toBeNull();
    expect(makeButton().disabled).toBe(false);
  });

  it("closes on 취소 without any request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { onClose, store } = open(["a", "b"]);
    const before = store.getState().report;
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getState().report).toBe(before);
  });

  it("creates version 1 in the library, then replaces the selection with one ref as a single undo step", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ version: 1, hash: "h1" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { store, onClose } = open(["a", "b"]);
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    fireEvent.click(makeButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/components");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.id).toBe("company-header");
    expect(sent.body).toMatchObject({ name: "Company Header", w: 30, h: 10, props: [] });
    expect(sent.body.elements.map((e: { id: string }) => e.id)).toEqual(["a", "b"]);
    expect(sent.body.elements[0]).toMatchObject({ x: 0, y: 0 });                       // 상자 기준 상대좌표
    expect(sent.body.elements[1]).toMatchObject({ x: 30, y: 10, x2: 20, y2: 2 });      // 선은 두 끝점 모두 상자 원점(10,10) 기준으로 옮긴다

    const s = store.getState();
    const top = s.report.elements;
    expect(top.some((e) => e.id === "a" || e.id === "b")).toBe(false);
    const ref = top.find((e) => e.type === "ref");
    expect(ref && ref.type === "ref" && ref.ref === "company-header" ? ref : undefined).toMatchObject({ version: 1, x: 10, y: 10, w: 30, h: 10 });
    expect(top.indexOf(ref!)).toBe(0);                                                  // 첫 선택 요소 자리
    expect(s.report.components["company-header@1"]).toEqual(sent.body);
    expect(s.history.past).toHaveLength(1);

    act(() => store.getState().undo());
    expect(store.getState().report.elements.map((e) => e.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(store.getState().report.components["company-header@1"]).toBeUndefined();
  });

  it("shows the server error in the dialog and leaves the canvas unchanged when creation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "component exists: company-header" }, { status: 409 })));
    const { store, onClose } = open(["a", "b"]);
    const before = store.getState().report;
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("component exists: company-header"));
    expect(onClose).not.toHaveBeenCalled();
    expect(store.getState().report).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
    expect(store.getState().selection).toEqual(["a", "b"]);
    await waitFor(() => expect(makeButton().disabled).toBe(false));                    // 고쳐서 다시 시도할 수 있다
  });

  it("re-checks the selection on submit and does not call the server when it became invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { store } = open(["a", "b"]);
    fireEvent.change(input("이름"), { target: { value: "X" } });
    act(() => store.getState().select(["a", "c"]));
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent!.length).toBeGreaterThan(0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when the canvas replacement fails after registration", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return Response.json({ version: 1, hash: "h1" }); }));
    const { store, onClose } = open(["a", "b"]);
    fireEvent.change(input("이름"), { target: { value: "Company Header" } });
    fireEvent.click(makeButton());
    // 등록 요청이 도는 사이 선택 요소가 사라지면 캔버스 치환이 실패한다 (라이브러리에는 이미 등록되어 있다)
    act(() => { store.getState().select(["a"]); store.getState().deleteSelected(); });
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole("alert").textContent!.length).toBeGreaterThan(0));
    expect(onClose).not.toHaveBeenCalled();
    expect(store.getState().findElement("company-header-1")).toBeUndefined();
  });
});

describe("Toolbar 컴포넌트로 만들기", () => {
  const toolbarButton = () => screen.getByRole("button", { name: "컴포넌트로 만들기" }) as HTMLButtonElement;
  function mountToolbar(store: EditorStore) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ version: 1, hash: "h1" }, { status: 201 })));
    mount(store, <Toolbar reportId="r" zoom={1} setZoom={() => {}} />);
  }

  it("is disabled with the reason as tooltip until a valid selection exists", () => {
    const store = createEditorStore(report);
    mountToolbar(store);
    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().title).toBe(EMPTY_SELECTION_REASON);
    act(() => store.getState().select(["a", "hdr"]));
    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().title.length).toBeGreaterThan(0);
    act(() => store.getState().select(["a", "b"]));
    expect(toolbarButton().disabled).toBe(false);
    expect(toolbarButton().title).toBe("");
  });

  it("opens the dialog, creates the component and closes it", async () => {
    const store = createEditorStore(report);
    mountToolbar(store);
    act(() => store.getState().select(["c", "d"]));
    fireEvent.click(toolbarButton());
    fireEvent.change(input("이름"), { target: { value: "Boxes" } });
    fireEvent.click(makeButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const group = store.getState().findElement("g");
    expect(group?.type === "group" ? group.children.map((e) => e.type) : []).toEqual(["ref"]);   // 그룹 안 선택은 그룹 안에서 바뀐다
    expect(store.getState().report.components["boxes@1"]).toMatchObject({ w: 10, h: 10 });
  });

  it("is disabled in component mode", () => {
    const store = createEditorStore(report, { componentMode });
    mountToolbar(store);
    act(() => store.getState().select(["a", "b"]));
    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().title).toBe(COMPONENT_MODE_REASON);
  });
});
