import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport, type ComponentProp } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { Toolbar } from "../Toolbar";
import { editReportToComponent } from "@/lib/component-edit";

const report = parseReport({ id: "component-hdr", name: "회사 헤더", version: 1, page: { width: 180, height: 24, margin: [0, 0, 0, 0] },
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 100, h: 10, value: "{{ props.title }}" }] });
const props: ComponentProp[] = [{ name: "title", type: "string", default: "기본" }];

type Reply = { version: number; hash: string; created: boolean } | { error: string; status: number };
function setup(opts: { reply?: Reply; usage?: unknown; apply?: unknown; output?: "label" } = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/components/hdr" && method === "PUT") {
      const r = opts.reply ?? { version: 6, hash: "h6", created: true };
      return "error" in r ? Response.json({ error: r.error }, { status: r.status }) : Response.json(r);
    }
    if (url === "/api/components/hdr/usage") return Response.json(opts.usage ?? [{ reportId: "a", versions: [5] }, { reportId: "b", versions: [4] }]);
    if (url === "/api/components/hdr/apply-latest") return Response.json(opts.apply ?? { updated: ["a"], skipped: [{ reportId: "b", error: "size mismatch" }] });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const initial = opts.output === "label" ? { ...report, output: { kind: "label" as const, label: { language: "zpl" as const, dpi: 203 as const } } } : report;
  const store = createEditorStore(parseReport(initial), { componentMode: { componentId: "hdr", version: 5, props, sampleProps: {} } });
  render(<EditorContext.Provider value={store}><Toolbar reportId="component-hdr" zoom={1} setZoom={() => {}} /></EditorContext.Provider>);
  return { store, calls };
}
const text = (id: string) => screen.getByTestId(id).textContent;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Toolbar in component mode", () => {
  it("shows the version to be created and hides PDF and label actions", () => {
    setup({ output: "label" });
    expect(text("component-version")).toBe("v5 (저장하면 v6)");
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    expect(screen.queryByTestId("label-download")).toBeNull();
    expect(screen.queryByLabelText("비트맵")).toBeNull();
    expect(screen.getByTestId("save")).toBeTruthy();
    expect(screen.queryByTestId("component-usage")).toBeNull();
  });

  it("saves a new version from the edited report and props, then shows usage", async () => {
    const { store, calls } = setup();
    act(() => store.getState().setComponentProps([...props, { name: "sub", type: "string", default: "" }]));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(text("component-usage")).toBe("사용하는 레포트 2개"));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/components/hdr");
    expect(put.body).toEqual({ body: editReportToComponent(store.getState().report, store.getState().componentMode!.props) });
    expect(calls.some((c) => c.url.startsWith("/api/reports"))).toBe(false);          // 레포트 저장 경로를 쓰지 않는다
    expect(text("component-status")).toBe("v6 저장됨");
    expect(text("component-version")).toBe("v6 (저장하면 v7)");
    expect(store.getState().componentMode!.version).toBe(6);
    expect(store.getState().dirty).toBe(false);
  });

  it("shows 변경 없음 and keeps the version when the server created nothing", async () => {
    const { store } = setup({ reply: { version: 5, hash: "h5", created: false } });
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(text("component-status")).toBe("변경 없음"));
    expect(text("component-version")).toBe("v5 (저장하면 v6)");
    await waitFor(() => expect(screen.getByTestId("component-usage")).toBeTruthy());
  });

  it("applies the latest version to all reports after confirmation and summarizes the result", async () => {
    const { store, calls } = setup();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    const apply = await screen.findByRole("button", { name: "모든 레포트에 최신 적용" });
    fireEvent.click(apply);
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("2개 레포트"));
    expect(calls.some((c) => c.url.endsWith("/apply-latest"))).toBe(false);          // 취소하면 요청하지 않는다
    fireEvent.click(apply);
    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    const post = calls.find((c) => c.url === "/api/components/hdr/apply-latest")!;
    expect(post.method).toBe("POST");
    expect(alertMock.mock.calls[0][0]).toContain("1개 레포트에 적용했습니다");
    expect(alertMock.mock.calls[0][0]).toContain("건너뜀 b: size mismatch");
  });

  it("disables 모든 레포트에 최신 적용 when no report uses the component", async () => {
    const { store } = setup({ usage: [] });
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(text("component-usage")).toBe("사용하는 레포트 0개"));
    expect((screen.getByRole("button", { name: "모든 레포트에 최신 적용" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports a failed save with the server error and stays dirty", async () => {
    const { store } = setup({ reply: { error: "duplicate element id: t", status: 400 } });
    const alertMock = vi.spyOn(window, "alert").mockImplementation(() => {});
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("duplicate element id: t")));
    expect(store.getState().dirty).toBe(true);
    expect(text("component-version")).toBe("v5 (저장하면 v6)");
    expect(screen.queryByTestId("component-status")).toBeNull();
  });

  it("stays dirty when the props change while the save request is in flight", async () => {
    const { store } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { if (init?.method === "PUT") await gate; return original(url, init); }));
    act(() => store.getState().updatePage({ width: 181 }));
    fireEvent.click(screen.getByTestId("save"));
    act(() => store.getState().setComponentProps([]));
    await act(async () => { release(); });
    await waitFor(() => expect(text("component-status")).toBe("v6 저장됨"));
    expect(store.getState().dirty).toBe(true);
  });
});
