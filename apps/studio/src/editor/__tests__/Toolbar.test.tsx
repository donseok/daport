import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { Toolbar } from "../Toolbar";
import { sampleParams } from "@/lib/data";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 100, height: 100 },
  params: [{ name: "lot", type: "string" }, { name: "qty", type: "number" }] });

// jsdom에는 URL.createObjectURL/revokeObjectURL이 없다. 테스트마다 가짜를 넣고 끝나면 원래대로 되돌려 전역 URL을 오염시키지 않는다
const originalBlobUrlFns = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
let createObjectURL: Mock<(obj: Blob | MediaSource) => string>;
let revokeObjectURL: Mock<(url: string) => void>;
beforeEach(() => {
  createObjectURL = vi.fn(() => "blob:pdf");
  revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const [k, v] of Object.entries(originalBlobUrlFns)) {
    if (v === undefined) delete (URL as unknown as Record<string, unknown>)[k];
    else (URL as unknown as Record<string, unknown>)[k] = v;
  }
});

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

  it("keeps edits made while the save request is in flight marked unsaved", async () => {
    const { store, fetchMock } = setup();
    let respond!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    const sent = store.getState().report;
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(sent);

    act(() => store.getState().updatePage({ width: 120 }));   // 요청이 진행 중일 때 편집
    await act(async () => { respond(new Response("{}", { status: 200 })); });

    await waitFor(() => expect((screen.getByTestId("save") as HTMLButtonElement).disabled).toBe(false));
    expect(store.getState().dirty).toBe(true);
    expect(screen.getByText(/\*$/)).toBeTruthy();
  });

  it("re-enables save and reports the error when the request fails", async () => {
    const { store, fetchMock } = setup();
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockImplementationOnce(async () => { throw new TypeError("Failed to fetch"); });
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch")));
    await waitFor(() => expect((screen.getByTestId("save") as HTMLButtonElement).disabled).toBe(false));
    expect(store.getState().dirty).toBe(true);
  });

  it("requests the PDF from the opened report's route with the shared sample params", async () => {
    const { fetchMock } = setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reports/r/pdf");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).params).toEqual(sampleParams(report));
  });

  it("disables PDF while rendering and revokes the blob URL only after the download click", async () => {
    const { fetchMock } = setup();
    let respond!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    const revoke = revokeObjectURL;
    // 클릭한 함수의 동기 구간이 끝난 직후(마이크로태스크) 해제 횟수를 본다. 동기 해제면 1, setTimeout으로 미루면 0
    let revokedRightAfterClick = -1;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { queueMicrotask(() => { revokedRightAfterClick = revoke.mock.calls.length; }); });
    const pdfButton = () => screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement;

    fireEvent.click(pdfButton());
    await waitFor(() => expect(pdfButton().disabled).toBe(true));
    fireEvent.click(pdfButton());                                                   // 렌더 중 다시 눌러도 요청이 늘지 않는다
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { respond(new Response(new Blob(["%PDF-"]), { status: 200 })); });
    await waitFor(() => expect(click).toHaveBeenCalled());
    await waitFor(() => expect(revokedRightAfterClick).not.toBe(-1));
    expect(revokedRightAfterClick).toBe(0);                                         // 클릭 직후에는 아직 해제하지 않는다
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:pdf"));
    await waitFor(() => expect(pdfButton().disabled).toBe(false));
  });

  it("reports the HTTP status when a failed PDF response is not JSON and re-enables the button", async () => {
    const { fetchMock } = setup();
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockImplementationOnce(async () => new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("PDF 실패 (HTTP 502)"));
    await waitFor(() => expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows the error message from a JSON PDF error body", async () => {
    const { fetchMock } = setup();
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockImplementationOnce(async () => Response.json({ error: "표현식 오류" }, { status: 422 }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("표현식 오류"));
  });

  it("falls back to the HTTP status when a JSON error body has no string message, for both PDF and save", async () => {
    const { fetchMock } = setup();
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockImplementation(async () => Response.json({ error: { code: "E_RENDER" } }, { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("PDF 실패 (HTTP 500)"));
    await waitFor(() => expect((screen.getByTestId("save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("저장 실패 (HTTP 500)"));
    expect(alertMock).toHaveBeenCalledTimes(2);   // "[object Object]"를 띄우지 않는다
  });
});
