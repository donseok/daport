import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport, type ComponentBody } from "@daport/core";
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

  it("keeps save available while a PDF is rendering", async () => {
    const { store, fetchMock } = setup();
    let respond!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(true));
    const save = screen.getByTestId("save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
    expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(true);   // 저장이 끝나도 PDF는 아직 렌더 중
    await act(async () => { respond(new Response(new Blob(["%PDF-"]), { status: 200 })); });
    await waitFor(() => expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(false));
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

  it("sends sample data with the PDF request unless live data is on, and renders the page selector", async () => {
    const { store, fetchMock } = setup();
    act(() => store.getState().setSample({ params: { lot: "L1", qty: 2 }, data: { s: [{ A: 1 }] }, capturedAt: "2026-09-17T00:00:00.000Z" }));
    fetchMock.mockResolvedValue(new Response(new Blob(["%PDF-"]), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.params).toEqual({ lot: "L1", qty: 2 });
    expect(body.data).toEqual({ s: [{ A: 1 }] });
    fireEvent.click(screen.getByLabelText("실데이터"));
    expect(store.getState().liveData).toBe(true);
    await waitFor(() => expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).data).toBeUndefined();
    expect(screen.getByTestId("page-indicator").textContent).toBe("1 / 1");
  });
});

describe("Toolbar label actions", () => {
  const labelReport = parseReport({ id: "r", name: "R", version: 1, page: { width: 60, height: 40 }, output: { kind: "label", label: { language: "zpl", dpi: 203 } } });

  it("hides label actions for a pdf report and shows download + bitmap toggle for a label report; printers only when listed", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/printers") ? [] : {}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pdfStore = createEditorStore(report);
    const { unmount } = render(<EditorContext.Provider value={pdfStore}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    expect(screen.queryByTestId("label-download")).toBeNull();
    unmount();
    const store = createEditorStore(labelReport);
    render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    expect(screen.getByTestId("label-download")).toBeTruthy();
    expect(screen.getByLabelText("비트맵")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/printers", expect.anything()));
    expect(screen.queryByLabelText("프린터")).toBeNull();
    fireEvent.click(screen.getByLabelText("비트맵"));
    expect(store.getState().bitmapPreview).toBe(true);
  });

  it("downloads the label from the label route with the sample body and sends to a listed printer", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/printers")) return new Response(JSON.stringify([{ name: "라인1" }]), { status: 200 });
      if (url.endsWith("/label")) return new Response("^XA^XZ", { status: 200, headers: { "content-type": "text/plain", "content-disposition": 'attachment; filename="r.zpl"' } });
      if (url.endsWith("/api/print")) return new Response(JSON.stringify({ printer: JSON.parse(String(init?.body)).printer, bytes: 6, pages: 1 }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const store = createEditorStore(labelReport);
    render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    fireEvent.click(screen.getByTestId("label-download"));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const labelCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/label"))!;
    expect(labelCall[0]).toBe("/api/reports/r/label");
    expect(JSON.parse(String(labelCall[1]?.body)).report.id).toBe("r");
    await waitFor(() => expect(screen.getByLabelText("프린터")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("프린터"), { target: { value: "라인1" } });
    fireEvent.click(screen.getByRole("button", { name: "프린터로 보내기" }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("라인1")));
    const printCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/print"))!;
    expect(JSON.parse(String(printCall[1]?.body))).toMatchObject({ printer: "라인1", report: { id: "r" } });
  });
});

describe("Toolbar save warnings", () => {
  const warned = (value: string | null) =>
    new Response("{}", { status: 200, headers: value === null ? {} : { "X-Daport-Warnings": value } });

  it("shows the warnings from the X-Daport-Warnings header after a successful save", async () => {
    const { store, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => warned(JSON.stringify(["component hdr@2 is not in the library", "component std@1 is not in the library"])));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));   // 경고가 있어도 저장은 성공이다
    const box = await screen.findByTestId("save-warnings");
    expect(box.textContent).toContain("component hdr@2 is not in the library");
    expect(box.textContent).toContain("component std@1 is not in the library");
  });

  it("shows nothing without the header, and clears earlier warnings on the next successful save", async () => {
    const { store, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => warned(JSON.stringify(["component hdr@2 is not in the library"])));
    fireEvent.click(screen.getByTestId("save"));
    await screen.findByTestId("save-warnings");
    act(() => store.getState().updatePage({ width: 120 }));   // 다시 저장할 수 있게 편집
    fetchMock.mockImplementationOnce(async () => warned(null));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(screen.queryByTestId("save-warnings")).toBeNull();
  });

  it("ignores a malformed header or a non-string array without breaking the save", async () => {
    const { store, fetchMock } = setup();
    fetchMock.mockImplementationOnce(async () => warned("not json"));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(screen.queryByTestId("save-warnings")).toBeNull();
    act(() => store.getState().updatePage({ width: 130 }));
    fetchMock.mockImplementationOnce(async () => warned(JSON.stringify([1, { a: 1 }, "component x@1 is not in the library"])));
    fireEvent.click(screen.getByTestId("save"));
    const box = await screen.findByTestId("save-warnings");
    expect(box.textContent).toContain("component x@1 is not in the library");
    expect(box.textContent).not.toContain("[object Object]");
  });

  it("does not show warnings when the save fails", async () => {
    const { store, fetchMock } = setup();
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "component hdr@1 differs from the library", code: "COMPONENT_MISMATCH" }),
      { status: 409, headers: { "X-Daport-Warnings": JSON.stringify(["component a@1 is not in the library"]) } }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("component hdr@1 differs from the library"));
    expect(store.getState().dirty).toBe(true);
    expect(screen.queryByTestId("save-warnings")).toBeNull();
  });
});

describe("Toolbar 저장 전 컴포넌트 정리 (스펙 7.2)", () => {
  const hdr: ComponentBody = { name: "H", w: 10, h: 5, props: [], elements: [] };

  it("prunes components no instance uses, in the request body and in the model left after saving", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    act(() => {
      store.getState().insertComponent("hdr", 1, hdr, 0, 0);
      store.getState().deleteSelected();                      // insertComponent가 새 인스턴스를 선택해 둔다
    });
    expect(store.getState().report.components["hdr@1"]).toEqual(hdr);

    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).components).toEqual({});
    expect(store.getState().report.components).toEqual({});
  });

  it("leaves a report whose components are all in use untouched (no extra undo step)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><Toolbar reportId="r" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
    act(() => store.getState().insertComponent("hdr", 1, hdr, 0, 0));
    const past = store.getState().history.past.length;
    const before = store.getState().report;

    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(store.getState().dirty).toBe(false));
    expect(store.getState().report).toBe(before);
    expect(store.getState().history.past).toHaveLength(past);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).components).toEqual({ "hdr@1": hdr });
  });
});
