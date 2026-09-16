import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { Toolbar } from "../Toolbar";
import { sampleParams } from "@/lib/data";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 100, height: 100 },
  params: [{ name: "lot", type: "string" }, { name: "qty", type: "number" }] });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const store = createEditorStore(report);
  // 편집 모델의 id가 어떤 경로로든 바뀌어도 요청 경로는 열린 레포트에 고정돼야 한다
  act(() => store.setState({ report: { ...report, id: "quality-cert" }, dirty: true }));
  render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
  return { store, fetchMock };
}

describe("Toolbar", () => {
  it("saves to the route of the opened report, not the id in the edited model", async () => {
    const { store, fetchMock } = setup();
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
  });

  it("requests the PDF from the opened report's route with the shared sample params", async () => {
    const { fetchMock } = setup();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/pdf");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).params).toEqual(sampleParams(report));
  });
});
