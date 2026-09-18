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
});
