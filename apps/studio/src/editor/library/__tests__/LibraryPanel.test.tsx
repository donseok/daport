import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { parseReport, parseComponentBody, type ComponentBody, type Element } from "@daport/core";
import { createEditorStore, EditorContext, type EditorStore } from "../../store";
import { LibraryPanel } from "../LibraryPanel";
import { COMPONENT_MIME } from "../api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const v1 = parseComponentBody({ name: "헤더", w: 40, h: 10, props: [{ name: "title", type: "string", default: "제목" }, { name: "old", type: "string", default: "" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w: 40, h: 10, value: "{{ props.title }}" }] });
const body = (w: number, h: number): ComponentBody => parseComponentBody({ name: "헤더", w, h, props: [{ name: "title", type: "string", default: "제목" }],
  elements: [{ id: "t", type: "text", x: 0, y: 0, w, h, value: "{{ props.title }}" }] });
const ref = (id: string, y: number) => ({ id, type: "ref", ref: "hdr", version: 1, x: 10, y, w: 40, h: 10, props: { title: "A", old: "x" } });
const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, components: { "hdr@1": v1 }, elements: [ref("hdr-1", 10), ref("hdr-2", 40)] });

const summaries = [
  { id: "hdr", name: "헤더", latestVersion: 3, w: 40, h: 12, updatedAt: "2026-09-17T00:00:00.000Z" },
  { id: "sig", name: "서명란", latestVersion: 1, w: 60, h: 20, updatedAt: "2026-09-17T00:00:00.000Z" },
];
const detail = (b: ComponentBody, latestVersion = 3) => ({ summary: { ...summaries[0], latestVersion, w: b.w, h: b.h }, versions: [], latest: b });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

/** "METHOD url" → 응답. 등록하지 않은 요청은 500으로 실패시켜 테스트가 알아채게 한다 */
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    return routes[key] ? routes[key](init) : json({ error: `unexpected ${key}` }, 500);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const called = (fn: ReturnType<typeof stubFetch>, key: string) => fn.mock.calls.some(([url, init]) => `${init?.method ?? "GET"} ${url}` === key);

function setup(routes: Record<string, (init?: RequestInit) => Response>, store: EditorStore = createEditorStore(report)) {
  const fetchMock = stubFetch({ "GET /api/components": () => json(summaries), ...routes });
  const utils = render(<EditorContext.Provider value={store}><LibraryPanel /></EditorContext.Provider>);
  const openMenu = async (name: string) => {
    fireEvent.click(utils.getByRole("button", { name: `${name} 메뉴` }));
    return utils.findByRole("menu");
  };
  const refs = () => store.getState().report.elements.filter((e): e is Extract<Element, { type: "ref" }> => e.type === "ref");
  return { store, fetchMock, openMenu, refs, ...utils };
}

describe("LibraryPanel", () => {
  it("lists name, latest version and size, and puts the component id on dragstart", async () => {
    const { findByText, getByText, getByTestId } = setup({});
    expect(await findByText("헤더")).toBeTruthy();
    expect(getByText("v3")).toBeTruthy();
    expect(getByText("hdr · 40×12mm")).toBeTruthy();
    expect(getByText("서명란")).toBeTruthy();
    expect(getByText("sig · 60×20mm")).toBeTruthy();
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: "" };
    fireEvent.dragStart(getByTestId("component-sig"), { dataTransfer });
    expect(data[COMPONENT_MIME]).toBe("sig");
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(getByTestId("component-sig").getAttribute("draggable")).toBe("true");
  });
  it("shows the server error when the list request fails, and an empty hint for an empty library", async () => {
    const failed = setup({ "GET /api/components": () => json({ error: "db down" }, 500) });
    expect(await failed.findByText(/db down/)).toBeTruthy();
    cleanup();
    const empty = setup({ "GET /api/components": () => json([]) });
    expect(await empty.findByText("등록된 컴포넌트가 없습니다")).toBeTruthy();
  });
  it("편집 opens the component editor in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { findByText, openMenu, getByRole } = setup({ "GET /api/components/hdr/usage": () => json([]) });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "편집" }));
    expect(open).toHaveBeenCalledWith("/components/hdr", "_blank", "noopener");
  });
  it("이 레포트의 인스턴스 모두 최신으로: confirms a size change, then updates every instance as one undo step", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByText, openMenu, getByRole, store, refs } = setup({
      "GET /api/components/hdr/usage": () => json([]),
      "GET /api/components/hdr": () => json(detail(body(40, 12))),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    await waitFor(() => expect(refs().map((r) => r.version)).toEqual([3, 3]));
    expect(confirm).toHaveBeenCalledWith("40×10 → 40×12, 아래 요소와 겹칠 수 있습니다");
    expect(refs().map((r) => [r.id, r.w, r.h, r.props])).toEqual([["hdr-1", 40, 12, { title: "A" }], ["hdr-2", 40, 12, { title: "A" }]]);
    expect(Object.keys(store.getState().report.components)).toEqual(["hdr@3"]);
    expect(store.getState().history.past).toHaveLength(1);
    expect(await findByText("인스턴스 2개를 v3(으)로 올렸습니다")).toBeTruthy();
  });
  it("keeps the instances when the size-change confirm is cancelled, and skips the confirm when the size is unchanged", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let latest = body(40, 12);
    const { findByText, openMenu, getByRole, store, refs } = setup({
      "GET /api/components/hdr/usage": () => json([]),
      "GET /api/components/hdr": () => json(detail(latest)),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(refs().map((r) => r.version)).toEqual([1, 1]);
    expect(store.getState().history.past).toHaveLength(0);

    latest = body(40, 10);
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    await waitFor(() => expect(refs().map((r) => r.version)).toEqual([3, 3]));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it("tells when the report has no instance of the component or they are already latest, without changing the report", async () => {
    const { findByText, openMenu, getByRole, store, fetchMock } = setup({
      "GET /api/components/sig/usage": () => json([]),
      "GET /api/components/hdr/usage": () => json([]),
      "GET /api/components/hdr": () => json(detail(body(40, 10), 1)),
    });
    await findByText("서명란");
    await openMenu("서명란");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    expect(await findByText("이 레포트에 이 컴포넌트의 인스턴스가 없습니다")).toBeTruthy();
    expect(called(fetchMock, "GET /api/components/sig")).toBe(false);
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "이 레포트의 인스턴스 모두 최신으로" }));
    expect(await findByText("이미 최신 버전(v1)입니다")).toBeTruthy();
    expect(store.getState().history.past).toHaveLength(0);
  });
  it("모든 레포트에 최신 적용: confirms with the usage count, applies, summarizes and asks to reload when this report changed", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByText, findByRole, openMenu, getByRole, fetchMock } = setup({
      "GET /api/components/hdr/usage": () => json([{ reportId: "r", versions: [1] }, { reportId: "other", versions: [2] }]),
      "POST /api/components/hdr/apply-latest": () => json({ updated: ["r"], skipped: [{ reportId: "other", error: "schema: overlap" }] }),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "모든 레포트에 최신 적용" }));
    await waitFor(() => expect(called(fetchMock, "POST /api/components/hdr/apply-latest")).toBe(true));
    expect(confirm).toHaveBeenCalledWith("이 컴포넌트를 쓰는 레포트 2개에 최신 버전(v3)을 적용할까요? 저장된 레포트가 바뀝니다.");
    const status = await findByText(/적용 1개, 건너뜀 1개/);
    expect(status.textContent).toContain("other: schema: overlap");
    expect((await findByRole("alert")).textContent).toBe("저장된 레포트가 바뀌었습니다. 새로 불러오세요");
  });
  it("sends nothing when the apply confirm is cancelled, and shows no reload notice when this report was not updated", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { findByText, openMenu, getByRole, queryByRole, fetchMock } = setup({
      "GET /api/components/hdr/usage": () => json([{ reportId: "other", versions: [1] }]),
      "POST /api/components/hdr/apply-latest": () => json({ updated: ["other"], skipped: [] }),
    });
    await findByText("헤더");
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "모든 레포트에 최신 적용" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(called(fetchMock, "POST /api/components/hdr/apply-latest")).toBe(false);
    confirm.mockReturnValue(true);
    await openMenu("헤더");
    fireEvent.click(getByRole("menuitem", { name: "모든 레포트에 최신 적용" }));
    expect(await findByText(/적용 1개, 건너뜀 0개/)).toBeTruthy();
    expect(queryByRole("alert")).toBeNull();
  });
  it("disables 삭제 with the using report ids while in use, and deletes an unused component after confirming", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    let list = summaries;
    const { findByText, queryByText, openMenu, getByRole, fetchMock } = setup({
      "GET /api/components": () => json(list),
      "GET /api/components/hdr/usage": () => json([{ reportId: "r", versions: [1] }, { reportId: "q", versions: [2] }]),
      "GET /api/components/sig/usage": () => json([]),
      "DELETE /api/components/sig": () => { list = [summaries[0]]; return new Response(null, { status: 204 }); },
    });
    await findByText("헤더");
    await openMenu("헤더");
    await waitFor(() => expect(getByRole("menuitem", { name: "삭제" }).getAttribute("title")).toBe("사용 중: r, q"));
    expect((getByRole("menuitem", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(true);

    await openMenu("서명란");
    await waitFor(() => expect((getByRole("menuitem", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole("menuitem", { name: "삭제" }));
    await waitFor(() => expect(queryByText("서명란")).toBeNull());
    expect(confirm).toHaveBeenCalledWith('컴포넌트 "서명란"(sig)을(를) 삭제할까요? 되돌릴 수 없습니다.');
    expect(called(fetchMock, "DELETE /api/components/sig")).toBe(true);
  });
  it("shows the server error when delete fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { findByText, openMenu, getByRole } = setup({
      "GET /api/components/sig/usage": () => json([]),
      "DELETE /api/components/sig": () => json({ error: "component in use", reports: ["z"] }, 409),
    });
    await findByText("서명란");
    await openMenu("서명란");
    await waitFor(() => expect((getByRole("menuitem", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(getByRole("menuitem", { name: "삭제" }));
    expect(await findByText("component in use")).toBeTruthy();
  });
});
