import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
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
});
