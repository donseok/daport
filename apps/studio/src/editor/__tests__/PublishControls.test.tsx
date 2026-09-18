import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../store";
import { PublishControls } from "../PublishControls";

const report = parseReport({ id: "r", name: "R", version: 1, page: { width: 100, height: 100 } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type Versions = { versions: { version: number; createdAt: string; note: string | null; hash: string; published: boolean }[]; publishedVersion: number | null; draftHash: string };
function setup(initial: Versions) {
  let state = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/versions")) return new Response(JSON.stringify(state), { status: 200 });
    if (url.endsWith("/publish")) {
      const v = (state.versions.at(-1)?.version ?? 0) + 1;
      state = { ...state, versions: [...state.versions.map((x) => ({ ...x, published: false })), { version: v, createdAt: "2026-09-18T00:00:00.000Z", note: JSON.parse(String(init?.body)).note ?? null, hash: state.draftHash, published: true }], publishedVersion: v };
      return new Response(JSON.stringify({ version: v, createdAt: "2026-09-18T00:00:00.000Z" }), { status: 201 });
    }
    if (url.endsWith("/published")) {
      const v = JSON.parse(String(init?.body)).version as number;
      state = { ...state, versions: state.versions.map((x) => ({ ...x, published: x.version === v })), publishedVersion: v };
      return new Response(JSON.stringify({ publishedVersion: v }), { status: 200 });
    }
    if (url.endsWith("/preview")) return new Response("<html><body>v-html</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const store = createEditorStore(report);
  render(<EditorContext.Provider value={store}><PublishControls reportId="r" /></EditorContext.Provider>);
  return { store, fetchMock };
}

describe("PublishControls", () => {
  it("shows 미배포, publishes with a note, then shows vN 배포됨", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("첫 배포");
    const { fetchMock } = setup({ versions: [], publishedVersion: null, draftHash: "h1" });
    await waitFor(() => expect(screen.getByTestId("publish-badge").textContent).toContain("미배포"));
    fireEvent.click(screen.getByTestId("publish"));
    await waitFor(() => expect(screen.getByTestId("publish-badge").textContent).toContain("v1 배포됨"));
    const publishCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/publish"))!;
    expect(publishCall[0]).toBe("/api/reports/r/publish");
    expect(JSON.parse(String(publishCall[1]?.body))).toEqual({ note: "첫 배포" });
  });
  it("marks 수정됨 when the draft hash differs and disables 배포 while dirty", async () => {
    const { store } = setup({ versions: [{ version: 1, createdAt: "", note: null, hash: "old", published: true }], publishedVersion: 1, draftHash: "new" });
    await waitFor(() => expect(screen.getByTestId("publish-badge").textContent).toContain("v1 배포됨 · 수정됨"));
    expect((screen.getByTestId("publish") as HTMLButtonElement).disabled).toBe(false);
    act(() => store.setState({ dirty: true }));
    expect((screen.getByTestId("publish") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("publish").title).toContain("저장");
  });
  it("lists versions, republishes an old one after confirm, and previews a version", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fetchMock } = setup({ versions: [{ version: 1, createdAt: "2026-09-17T00:00:00.000Z", note: "첫", hash: "a", published: false }, { version: 2, createdAt: "2026-09-18T00:00:00.000Z", note: null, hash: "b", published: true }], publishedVersion: 2, draftHash: "b" });
    fireEvent.click(await screen.findByRole("button", { name: "버전" }));
    const panel = screen.getByTestId("versions-panel");
    expect(panel.textContent).toContain("v1");
    expect(panel.textContent).toContain("첫");
    expect(panel.textContent).toContain("v2");
    const rows = panel.querySelectorAll("[data-version]");
    fireEvent.click(rows[0].querySelector('button[name="republish"]')!);
    await waitFor(() => expect(screen.getByTestId("publish-badge").textContent).toContain("v1 배포됨"));
    const put = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/published") && i?.method === "PUT")!;
    expect(JSON.parse(String(put[1]?.body))).toEqual({ version: 1 });
    fireEvent.click(rows[0].querySelector('button[name="view"]')!);
    await waitFor(() => expect(screen.queryByTestId("version-preview")).not.toBeNull());
    const previewCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/preview"))!;
    expect(JSON.parse(String(previewCall[1]?.body))).toMatchObject({ version: 1 });
  });
  it("shows the integration snippet with the report id and no key", async () => {
    setup({ versions: [], publishedVersion: null, draftHash: "h" });
    fireEvent.click(await screen.findByRole("button", { name: "버전" }));
    fireEvent.click(screen.getByText("연동"));
    const snippet = screen.getByTestId("integration-snippet").textContent ?? "";
    expect(snippet).toContain("/api/reports/r/render");
    expect(snippet).toContain("<API_KEY>");
    expect(snippet).toContain("/api/reports/r/published");
  });
  it("re-fetches versions and shows 수정됨 once dirty returns to false after a save", async () => {
    let draftHash = "a";   // v1의 hash와 같다 (아직 수정 없음)
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/versions")) {
        return new Response(JSON.stringify({ versions: [{ version: 1, createdAt: "", note: null, hash: "a", published: true }], publishedVersion: 1, draftHash }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = createEditorStore(report);
    render(<EditorContext.Provider value={store}><PublishControls reportId="r" /></EditorContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("publish-badge").textContent).toContain("v1 배포됨"));
    expect(screen.getByTestId("publish-badge").textContent).not.toContain("수정됨");
    const versionsCallsBefore = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/versions")).length;

    draftHash = "b";   // 저장으로 draft가 바뀐 상황을 흉내낸다
    act(() => store.setState({ dirty: true }));
    act(() => store.setState({ dirty: false }));   // Toolbar의 저장 완료

    await waitFor(() => expect(screen.getByTestId("publish-badge").textContent).toContain("v1 배포됨 · 수정됨"));
    const versionsCallsAfter = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/versions")).length;
    expect(versionsCallsAfter).toBeGreaterThan(versionsCallsBefore);
  });
});
