import { StrictMode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { AiPanel } from "../AiPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, elements: [{ id: "a", type: "text", x: 0, y: 0, w: 30, h: 5, value: "A" }] });
const mount = (r = report) => { const store = createEditorStore(r); render(<EditorContext.Provider value={store}><AiPanel reportId="r" /></EditorContext.Provider>); return store; };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("AiPanel", () => {
  it("sends instruction, selection and history to ai/edit and turns the answer into a proposal", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "바꿨습니다", warnings: ["경고"] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount();
    act(() => store.getState().select(["a"]));
    expect(screen.getByTestId("ai-selection").textContent).toContain("a");
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "값을 B로" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(store.getState().proposal).not.toBeNull());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/reports/r/ai/edit");
    expect((init!.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ instruction: "값을 B로", selection: ["a"], history: [] });
    expect(body.report.id).toBe("r");
    const turns = screen.getAllByTestId("ai-turn").map((t) => t.textContent);
    expect(turns[0]).toContain("값을 B로"); expect(turns[1]).toContain("바꿨습니다"); expect(turns[1]).toContain("경고");
    expect(store.getState().report.elements[0]).toMatchObject({ value: "A" });   // 적용 전 불변
  });
  it("uses generate mode on an empty report and shows the not-configured notice on 503", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ elements: [{ id: "t", type: "text", x: 0, y: 0, w: 10, h: 5, value: "생성" }], components: {}, explanation: "생성함", warnings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } }));
    expect((screen.getByTestId("ai-generate-mode") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "품질보증서" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(store.getState().proposal?.kind).toBe("generate"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/ai/generate");
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ brief: "품질보증서" });
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "키 없음", code: "AI_NOT_CONFIGURED" }, 503)));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(screen.getByTestId("ai-not-configured").textContent).toContain("GEMINI_API_KEY"));
  });
  it("shows an error turn and drops the proposal when the report changed while the request was in flight", async () => {
    let resolveFetch: ((v: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "값을 B로" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    act(() => { store.getState().updateElement("a", { x: 5 }); });   // 응답을 기다리는 동안 다른 편집
    act(() => { resolveFetch!(json({ patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "바꿨습니다", warnings: [] })); });
    await waitFor(() => expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("편집 중 레포트가 바뀌어"));
    expect(store.getState().proposal).toBeNull();
  });
  it("shows errors as a turn and supports cancel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "요청 한도", code: "AI_RATE_LIMIT" }, 429)));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("요청 한도"));
    cleanup();
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => new Promise((_r, reject) => { init!.signal!.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("a"), { name: "AbortError" })); }); })));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    await waitFor(() => expect(aborted).toBe(true));
  });
  it("keeps a cancelled turn quiet and out of the history sent on the next message", async () => {
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => new Promise((_r, reject) => { init!.signal!.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("a"), { name: "AbortError" })); }); })));
    mount();
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "첫 지시" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    await waitFor(() => expect(aborted).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("취소됨"));

    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ patch: [], explanation: "됐습니다", warnings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "두번째 지시" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.history).toEqual([{ role: "user", text: "첫 지시" }]);
  });
  /**
   * 회귀 테스트: React StrictMode(개발 모드 next dev의 실제 동작)는 마운트 → 클린업 → 재마운트를
   * 같은 컴포넌트 인스턴스에서 한 번 더 돌린다. mountedRef 초기화 effect가 클린업에서만 false를 내리고
   * 본문에서 true로 되돌리지 않으면, 이 재마운트 이후 mountedRef.current가 영영 false로 굳어
   * handleResult·send의 finally가 응답을 전부 무시한다(제안도, 턴도, busy 해제도 없음).
   * 이 테스트는 고치기 전에는 실패하고 고친 뒤에는 통과해야 한다
   */
  it("still shows the proposal and the assistant turn after StrictMode's dev-only double mount", async () => {
    const fetchMock = vi.fn(async () => json({ patch: [{ op: "replace", path: "/elements/0/value", value: "B" }], explanation: "바꿨습니다", warnings: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(report);
    render(
      <StrictMode>
        <EditorContext.Provider value={store}><AiPanel reportId="r" /></EditorContext.Provider>
      </StrictMode>,
    );
    fireEvent.change(screen.getByLabelText("AI 지시"), { target: { value: "값을 B로" } });
    fireEvent.click(screen.getByTestId("ai-send"));
    await waitFor(() => expect(store.getState().proposal).not.toBeNull());
    const turns = screen.getAllByTestId("ai-turn").map((t) => t.textContent);
    expect(turns.some((t) => t?.includes("바꿨습니다"))).toBe(true);
    // busy도 풀려야 "취소" 버튼이 "보내기"로 돌아온다(mountedRef가 굳으면 이 버튼이 영영 "취소"로 남는다)
    await waitFor(() => expect(screen.queryByTestId("ai-send")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  });
  it("빈 레포트에서 이미지를 올리면 이관을 호출하고 제안과 대조 배경을 세운다", async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({
      elements: [{ id: "t1", type: "text", x: 10, y: 10, w: 50, h: 8, value: "검사 성적서" }],
      params: [], datasets: [], page: { width: 210, height: 297, margin: [10, 10, 10, 10], unit: "mm" },
      explanation: "옮겼습니다", warnings: [], scan: { src: "asset://abc123", angle: 3 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } }));
    const file = new File([new Uint8Array([1, 2, 3])], "form.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("ai-import-file"), { target: { files: [file] } });
    await waitFor(() => expect(store.getState().proposal?.kind).toBe("import"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/ai/import");
    expect(store.getState().scanOverlay).toBe("asset://abc123");   // 응답의 scan.src를 그대로 쓴다
    expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("옮겼습니다");
  });
  it("이관 프리셋: 레포트 크기가 알려진 프리셋과 같으면 그것을, 아니면 A4를 기본으로 고르고, 고른 프리셋 크기 그대로 보내며, 응답의 page를 문서에 반영한다(스펙 9, I1)", async () => {
    // 알려진 프리셋(60×40 라벨)과 크기가 같은 레포트 — 초기 선택이 그 프리셋이어야 한다
    mount(parseReport({ id: "r", version: 1, page: { width: 60, height: 40 } }));
    expect((screen.getByTestId("ai-import-preset") as HTMLSelectElement).value).toBe("product-label-60x40");
    cleanup();

    // 어떤 내장 프리셋과도 크기가 다른 레포트 — 초기 선택은 A4다
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({
      elements: [], params: [], datasets: [], page: { width: 297, height: 420, margin: [10, 10, 10, 10], unit: "mm" },
      explanation: "옮겼습니다", warnings: [], scan: { src: null, angle: 0 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount(parseReport({ id: "r", version: 1, page: { width: 123, height: 77 } }));
    const select = screen.getByTestId("ai-import-preset") as HTMLSelectElement;
    expect(select.value).toBe("a4-portrait");

    // A4가 아닌 다른 프리셋을 고르면, report.page(123×77)가 아니라 고른 프리셋의 크기를 보낸다
    fireEvent.change(select, { target: { value: "a3-portrait" } });
    const file = new File([new Uint8Array([1, 2, 3])], "form.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("ai-import-file"), { target: { files: [file] } });
    await waitFor(() => expect(store.getState().proposal?.kind).toBe("import"));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.preset).toEqual({ width: 297, height: 420 });
    // 서버가 실제로 검증에 쓴 page(응답의 page)가 문서에 반영돼야 한다 — report.page(123×77)에
    // 그대로 남아 요소가 페이지 밖으로 밀려나 보이던 예전 동작(I1)을 여기서 고쳤다고 기록해둔다
    expect(store.getState().proposal?.next.page).toMatchObject({ width: 297, height: 420 });
  });
  it("업로드 중 레포트가 바뀌면 이관 제안과 대조 배경을 모두 버린다", async () => {
    let resolveFetch: ((v: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const store = mount(parseReport({ id: "r", version: 1, page: { width: 100, height: 100 } }));
    const file = new File([new Uint8Array([1, 2, 3])], "form.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("ai-import-file"), { target: { files: [file] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    act(() => { store.getState().updatePage({ width: 150 }); });   // 업로드 응답을 기다리는 동안 다른 편집
    act(() => { resolveFetch!(json({
      elements: [{ id: "t1", type: "text", x: 1, y: 1, w: 10, h: 5, value: "A" }],
      params: [], datasets: [], page: { width: 100, height: 100, margin: [10, 10, 10, 10], unit: "mm" },
      explanation: "옮겼습니다", warnings: [], scan: { src: "asset://xyz", angle: 0 },
    })); });
    await waitFor(() => expect(screen.getAllByTestId("ai-turn").at(-1)!.textContent).toContain("편집 중 레포트가 바뀌어"));
    expect(store.getState().proposal).toBeNull();
    expect(store.getState().scanOverlay).toBeNull();   // 제안이 거절됐으니 대조 배경도 세우지 않는다
  });
});
