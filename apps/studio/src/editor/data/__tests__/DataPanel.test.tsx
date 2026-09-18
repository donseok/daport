import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { parseReport } from "@daport/core";
import { createEditorStore, EditorContext } from "../../store";
import { DataPanel } from "../DataPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const report = parseReport({ id: "r", version: 1, page: { width: 100, height: 100 }, params: [{ name: "no", type: "string" }],
  datasets: [{ name: "items", type: "static", rows: [{ N: 1, DT: "2026-09-17" }] }] });

function setup() {
  const store = createEditorStore(report);
  const utils = render(<EditorContext.Provider value={store}><DataPanel reportId="r" /></EditorContext.Provider>);
  return { store, ...utils };
}

describe("DataPanel", () => {
  beforeEach(() => { vi.spyOn(globalThis, "fetch"); });

  it("lists params with sample values, datasets, and a field tree from static rows", () => {
    const { getByLabelText, getByText, store } = setup();
    fireEvent.change(getByLabelText("no"), { target: { value: "A-1" } });
    expect(store.getState().report.sample?.params).toEqual({ no: "A-1" });
    expect(getByText("items")).toBeTruthy();
    expect(getByText("DT")).toBeTruthy();
  });
  it("adds and removes datasets through the store", () => {
    const { getByRole, getAllByRole, store } = setup();
    fireEvent.click(getByRole("button", { name: "+ static" }));
    expect(store.getState().report.datasets.map((d) => [d.name, d.type])).toEqual([["items", "static"], ["dataset-1", "static"]]);
    fireEvent.click(getByRole("button", { name: "+ http" }));
    expect(store.getState().report.datasets[2]).toMatchObject({ type: "http", name: "dataset-2", method: "GET" });
    fireEvent.click(getAllByRole("button", { name: "삭제" })[0]);
    expect(store.getState().report.datasets.map((d) => d.name)).toEqual(["dataset-1", "dataset-2"]);
  });
  it("fetches a sample, stores data/params as one undoable edit, and shows dataset errors", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({
      data: { items: [{ N: 9, DT: "2026-01-01" }] }, fields: { items: [{ name: "N", path: "N", type: "number" }] },
      errors: [{ dataset: "h", code: "HOST_NOT_ALLOWED", message: "host not allowed: x" }], capturedAt: "2026-09-17T00:00:00.000Z" }), { status: 200 }));
    const { getByRole, getByText, store } = setup();
    // 컴포넌트 밖에서 스토어를 직접 바꾼 뒤 바로 클릭하므로, act() 밖의 갱신이 클릭 시점 클로저에 반영되도록 act()로 감싼다
    // (react-dom act 환경에서는 act() 밖의 리렌더가 다음 act() 호출이 "끝난 뒤"에야 반영되어, 그 안의 동기 코드는 갱신 전 클로저를 본다)
    act(() => { store.getState().setSample({ params: { no: "Z" }, data: {}, capturedAt: "2026-01-01T00:00:00.000Z" }); });
    const before = store.getState().history.past.length;
    fireEvent.click(getByRole("button", { name: "샘플 가져오기" }));
    await waitFor(() => expect(store.getState().report.sample?.data).toEqual({ items: [{ N: 9, DT: "2026-01-01" }] }));
    expect(store.getState().report.sample?.params).toEqual({ no: "Z" });
    expect(store.getState().history.past.length).toBe(before + 1);
    expect(getByText(/HOST_NOT_ALLOWED/)).toBeTruthy();
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/reports/r/sample");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ params: { no: "Z" }, report: { id: "r" } });
  });
  it("prunes stale columnTypes hints on rename, so a later dataset reusing the name is not stuck with the old hint", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({
      data: { items: [{ N: 1 }] }, fields: { items: [{ name: "N", path: "N", type: "string" }] },
      columns: { items: [{ name: "N", type: "string" }] },
      errors: [], capturedAt: "2026-09-17T00:00:00.000Z" }), { status: 200 }));
    const { getByRole, getByTestId, getAllByLabelText } = setup();
    fireEvent.click(getByRole("button", { name: "샘플 가져오기" }));
    await waitFor(() => expect(getByTestId("fields-items").querySelector('[data-path="N"]')?.textContent).toContain("T"));   // 서버 힌트대로 string

    // "items"를 다른 이름으로 바꾼다 — 옛 이름에 대한 힌트가 남으면 안 된다
    fireEvent.change(getAllByLabelText("이름")[0], { target: { value: "renamed" } });
    // 이름 "items"를 재사용하는 새 정적 데이터셋을 추가하고 숫자 값을 넣는다
    fireEvent.click(getByRole("button", { name: "+ static" }));
    fireEvent.change(getAllByLabelText("이름")[1], { target: { value: "items" } });
    fireEvent.change(getAllByLabelText("행(JSON)")[1], { target: { value: JSON.stringify([{ N: 2 }]) } });

    // 옛 "items" 힌트가 정리되지 않았다면 새 데이터셋의 N도 string(T)으로 보였을 것 — 실제로는 자연 추론된 number(#)
    await waitFor(() => expect(getByTestId("fields-items").querySelector('[data-path="N"]')?.textContent).toContain("#"));
  });
  it("shows the HTTP error message when the sample request fails", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ error: "missing required param: no" }), { status: 400 }));
    const { getByRole, findByText } = setup();
    fireEvent.click(getByRole("button", { name: "샘플 가져오기" }));
    expect(await findByText(/missing required param/)).toBeTruthy();
  });
});
