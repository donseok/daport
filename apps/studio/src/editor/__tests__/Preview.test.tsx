import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { Preview } from "../Preview";
import { sampleParams } from "@/lib/data";

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, params: [{ name: "qty", type: "number" }] });

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Preview", () => {
  it("debounces requests by 150ms, posts to the opened report's route and aborts a stale request", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => { signals.push(init!.signal!); return new Promise<Response>(() => {}); });
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(report);
    act(() => store.setState({ report: { ...report, id: "quality-cert" } }));
    const { container } = render(<EditorContext.Provider value={store}><Preview reportId="r" /></EditorContext.Provider>);
    expect(container.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-same-origin");

    await act(async () => { vi.advanceTimersByTime(149); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/preview");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).params).toEqual(sampleParams(report));

    // 빠르게 연달아 바뀌면 진행 중인 요청을 끊고 마지막 모델만 한 번 요청한다
    act(() => store.getState().updatePage({ width: 90 }));
    expect(signals[0].aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(100); });
    act(() => store.getState().updatePage({ width: 80 }));
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).report.page.width).toBe(80);
  });

  it("shows the returned HTML and ignores the abort of a superseded request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      setTimeout(() => resolve(new Response("<p>ok</p>", { status: 200 })), 50);
    })));
    const store = createEditorStore(report);
    const { container } = render(<EditorContext.Provider value={store}><Preview reportId="r" /></EditorContext.Provider>);
    await act(async () => { vi.advanceTimersByTime(150); });
    act(() => store.getState().updatePage({ width: 90 }));                           // 첫 요청 중단
    await act(async () => { vi.advanceTimersByTime(150); });
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(container.textContent).not.toContain("aborted");
    expect(container.querySelector("iframe")!.getAttribute("srcdoc")).toBe("<p>ok</p>");
  });

  it("posts sample data and lists dataset errors from a 400 response", async () => {
    // 실제 타이머로 디바운스(150ms)와 응답 처리를 기다린다
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: "데이터셋 실행 실패", datasetErrors: [{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: x" }] }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(parseReport({ ...report, sample: { params: {}, data: { h: [{ A: 1 }] }, capturedAt: "2026-09-17T00:00:00.000Z" } }));
    const { container } = render(<EditorContext.Provider value={store}><Preview reportId="r" /></EditorContext.Provider>);
    await waitFor(() => expect(container.textContent).toContain("h: HOST_NOT_ALLOWED"), { timeout: 3000 });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).data).toEqual({ h: [{ A: 1 }] });
  });

  it("shows the bitmap PNG instead of the iframe when bitmap preview is on for a label report", async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes("preview=png")
      ? new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } })
      : new Response("<p>html</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:png", revokeObjectURL: () => {} }));
    const store = createEditorStore(parseReport({ ...report, output: { kind: "label", label: { language: "zpl", dpi: 203 } } }));
    store.getState().setBitmapPreview(true);
    const { container, findByTestId } = render(<EditorContext.Provider value={store}><Preview reportId="r" /></EditorContext.Provider>);
    const img = await findByTestId("bitmap-preview");
    expect(img.getAttribute("src")).toBe("blob:png");
    expect(container.querySelector("iframe")).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/reports/r/label?preview=png");
  });

  it("sends the sample props in component mode and none otherwise", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("<p>ok</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const cm = createEditorStore(report, { componentMode: { componentId: "hdr", version: 1,
      props: [{ name: "title", type: "string", default: "기본" }, { name: "n", type: "number", default: 1 }], sampleProps: { title: "샘플", junk: 1 } } });
    const { unmount } = render(<EditorContext.Provider value={cm}><Preview reportId="component-hdr" /></EditorContext.Provider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).props).toEqual({ title: "샘플", n: 1 });
    act(() => cm.getState().setSampleProps({ title: "다시" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).props).toEqual({ title: "다시", n: 1 });
    unmount();
    render(<EditorContext.Provider value={createEditorStore(report)}><Preview reportId="r" /></EditorContext.Provider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect("props" in JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toBe(false);
  });
});
